// Validate every redirect and pin the approved DNS address through the actual TCP/TLS connection.
const { lookup } = require('node:dns/promises')
const { isIP } = require('node:net')
const ipaddr = require('ipaddr.js')
const { Agent, ProxyAgent, request } = require('undici')
const { proxyMapping, createPublicResolver } = require('./public-dns.cjs')
const SEARCH_HOSTS = new Set(require('../ops/search-engines.json').flatMap(engine =>
  [new URL(engine.webOrigin).hostname, new URL(engine.imageOrigin).hostname]))

function publicAddress(address) {
  try { return ipaddr.parse(address).range() === 'unicast' } catch { return false }
}

function publicImageUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('图片网址无效')
  let url
  try { url = new URL(value, base) } catch { throw new Error('图片网址无效') }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port)) || /[\0\r\n]/.test(value)
    || (!isIP(host) && (!host.includes('.') || /(?:^|\.)(localhost|local|lan|internal|home|test)$/.test(host)))
    || (isIP(host) && !publicAddress(host))) throw new Error('搜图和下载只访问公开 HTTP/HTTPS 图片网址')
  url.hash = ''
  return url
}

function pinnedDispatcher(url, address, proxy = '') {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (proxy) {
    const target = new URL(url.href)
    target.hostname = address.family === 6 ? `[${address.address}]` : address.address
    return { url: target.href, dispatcher: new ProxyAgent({ uri: proxy, proxyTunnel: true,
      connectTimeout: 10000, requestTls: { servername: hostname, rejectUnauthorized: true } }) }
  }
  const dispatcher = new Agent({ connect: { timeout: 10000, rejectUnauthorized: true,
    ...(url.protocol === 'https:' ? { servername: hostname } : {}),
    lookup(name, options, callback) {
      if (name.toLowerCase() !== hostname.toLowerCase()) return callback(new Error('图片连接的目标域名已变化'))
      if (options.all) callback(null, [{ address: address.address, family: address.family }])
      else callback(null, address.address, address.family)
    },
  }, connections: 1 })
  return { url: url.href, dispatcher }
}

function systemProxy(value) {
  const entry = String(value || '').split(';')[0].trim()
  const match = /^(PROXY|HTTPS|SOCKS5)\s+([^\s/]+)$/i.exec(entry)
  if (!match) return ''
  return `${{ PROXY: 'http', HTTPS: 'https', SOCKS5: 'socks5' }[match[1].toUpperCase()]}://${match[2]}`
}

function abortable(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {})
    return Promise.reject(signal.reason)
  }
  let abort
  const stopped = new Promise((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  return Promise.race([promise, stopped]).finally(() => signal.removeEventListener('abort', abort))
}

async function dispose(response, dispatcher) {
  if (response?.body) {
    response.body.once('error', () => {})
    response.body.destroy()
  }
  let timer
  try {
    await Promise.race([Promise.resolve().then(() => dispatcher.destroy()).catch(() => {}),
      new Promise(resolve => { timer = setTimeout(resolve, 1000) })])
  } finally { clearTimeout(timer) }
}

function createImageNetwork({ resolver = lookup, requester = request, getProxy = async () => '',
  publicResolver = createPublicResolver(), connectionFactory = pinnedDispatcher } = {}) {
  async function fetchBytes(value, { maxBytes = 8 * 1024 * 1024, signal, accept = 'image/*', timeout = 25000 } = {}) {
    let url = publicImageUrl(value)
    const deadline = new AbortController()
    // A referenced deadline also wakes Node while Electron is waiting on native proxy callbacks.
    const timer = setTimeout(() => deadline.abort(new Error('图片读取超时，请换一张图片或稍后重试')), timeout)
    const combined = AbortSignal.any([...(signal ? [signal] : []), deadline.signal])
    try {
      redirectsLoop: for (let redirects = 0; redirects <= 3; redirects += 1) {
        combined.throwIfAborted()
        const hostname = url.hostname.replace(/^\[|\]$/g, '')
        let addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
          : await abortable(resolver(hostname, { all: true }), combined)
        if (proxyMapping(hostname, addresses) || (SEARCH_HOSTS.has(hostname) && addresses.some(item => !publicAddress(item.address)))) {
          // Fixed engine hosts and Fake-IP domains are resolved independently, never by trusting mapped IPs.
          addresses = await abortable(publicResolver(hostname, combined), combined)
        }
        if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
          throw new Error('图片地址解析到了本机、内网或保留网段，已阻止访问')
        }
        const unique = [...new Map([...addresses.filter(item => item.family === 4), ...addresses.filter(item => item.family !== 4)]
          .map(item => [item.address, item])).values()]
        const attempts = unique.length > 1 ? unique.slice(0, 2) : [unique[0], unique[0]]
        const proxy = systemProxy(await abortable(getProxy(url.href), combined))
        for (const [index, address] of attempts.entries()) {
          combined.throwIfAborted()
          const connection = connectionFactory(url, address, proxy)
          let response
          try {
            response = await abortable(requester(connection.url, { dispatcher: connection.dispatcher,
              method: 'GET', signal: combined, maxRedirections: 0, headersTimeout: 15000, bodyTimeout: 15000,
              headers: { Host: url.host, Accept: accept, 'User-Agent': 'WeChatOAStudio/0.3 (article image search)' } }), combined)
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
              if (redirects === 3) throw new Error('图片重定向次数过多')
              url = publicImageUrl(response.headers.location, url)
              continue redirectsLoop
            }
            if (response.statusCode !== 200) throw new Error(`图片来源返回 HTTP ${response.statusCode}`)
            if (Number(response.headers['content-length']) > maxBytes) throw new Error('图片或搜索结果超过允许大小')
            const chunks = []
            let total = 0
            const iterator = response.body[Symbol.asyncIterator]()
            while (true) {
              const { value: chunk, done } = await abortable(iterator.next(), combined)
              if (done) break
              total += chunk.length
              if (total > maxBytes) throw new Error('图片或搜索结果超过允许大小')
              chunks.push(chunk)
            }
            combined.throwIfAborted()
            if (!total) throw new Error('图片来源返回了空内容')
            return { bytes: Buffer.concat(chunks), type: String(response.headers['content-type'] || '').split(';')[0].toLowerCase(),
              url: url.href }
          } catch (error) {
            if (combined.aborted) throw combined.reason
            const code = error.code || error.cause?.code
            if (index === 0 && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH',
              'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) continue
            if (/^[\u4e00-\u9fff]/.test(error.message)) throw error
            throw new Error(`图片网络连接失败${code ? `（${code}）` : ''}，请检查网络后重试`)
          } finally { await dispose(response, connection.dispatcher) }
        }
      }
      throw new Error('图片重定向次数过多')
    } finally { clearTimeout(timer) }
  }
  return { fetchBytes }
}

module.exports = { createImageNetwork, publicAddress, publicImageUrl, pinnedDispatcher, systemProxy }
