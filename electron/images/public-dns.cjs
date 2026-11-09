// Resolve proxy Fake-IP answers independently; never connect to an unverified mapped address.
const https = require('node:https')
const { isIP } = require('node:net')
const ipaddr = require('ipaddr.js')

const ENDPOINTS = [
  { hostname: 'dns.alidns.com', address: '223.5.5.5', pathname: '/resolve' },
  { hostname: 'cloudflare-dns.com', address: '1.1.1.1', pathname: '/dns-query' },
  { hostname: 'dns.google', address: '8.8.8.8', pathname: '/resolve' },
]
const lower = value => String(value || '').toLowerCase().replace(/\.$/, '')

function proxyMapping(hostname, addresses) {
  if (isIP(hostname) || !addresses.length) return false
  const v4 = address => /^198\.(18|19)\.\d{1,3}\.\d{1,3}$/.test(address) && isIP(address) === 4
  const v6 = address => {
    try {
      const ip = ipaddr.parse(address)
      return ip.kind() === 'ipv6' && (ip.match(ipaddr.parse('2001:2::'), 48)
        || ip.match(ipaddr.parse('fdfe:dcba:9876::'), 48))
    } catch { return false }
  }
  return addresses.some(item => v4(item.address)) && addresses.some(item => v6(item.address))
    && addresses.every(item => v4(item.address) || v6(item.address))
}

function parsePublicAnswers(value, hostname) {
  if (value?.Status !== 0 || !Array.isArray(value.Answer)) throw new Error('公网 DNS 暂未返回可验证结果')
  const questions = Array.isArray(value.Question) ? value.Question : value.Question ? [value.Question] : []
  if (!questions.some(item => lower(item.name) === lower(hostname)
    && Number(item.type) === 1)) throw new Error('公网 DNS 的查询目标不一致')
  const names = new Set([lower(hostname)])
  for (let hop = 0; hop < 8; hop += 1) {
    let added = false
    for (const item of value.Answer) {
      if (item.type === 5 && names.has(lower(item.name)) && !names.has(lower(item.data))) {
        names.add(lower(item.data))
        added = true
      }
    }
    if (!added) break
  }
  const answers = value.Answer.filter(item => names.has(lower(item.name)) && item.type === 1)
    .map(item => ({ address: item.data, family: 4 }))
  if (!answers.length || answers.some(item => {
    try { return ipaddr.parse(item.address).kind() !== 'ipv4' || ipaddr.parse(item.address).range() !== 'unicast' }
    catch { return true }
  })) throw new Error('公网 DNS 仍返回了内网或保留地址，已阻止访问')
  return [...new Map(answers.map(item => [item.address, item])).values()]
}

function query(endpoint, hostname, signal) {
  const url = new URL(endpoint.pathname, `https://${endpoint.hostname}`)
  url.search = new URLSearchParams({ name: hostname, type: 'A' })
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(3000)])
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      signal: deadline, agent: false, servername: endpoint.hostname, rejectUnauthorized: true,
      lookup(name, options, callback) {
        if (name !== endpoint.hostname) return callback(new Error('DNS 服务的目标发生变化'))
        if (options.all) callback(null, [{ address: endpoint.address, family: 4 }])
        else callback(null, endpoint.address, 4)
      },
      headers: { Accept: 'application/dns-json', 'User-Agent': 'WeChatOAStudio/0.3 (public DNS verification)' },
    }, response => {
      response.on('error', reject)
      if (response.statusCode !== 200) {
        response.destroy()
        reject(new Error('公网 DNS 服务暂不可用'))
        return
      }
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > 65536) {
          response.destroy()
          reject(new Error('公网 DNS 响应过大'))
        } else chunks.push(chunk)
      })
      response.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new Error('公网 DNS 响应无效')) }
      })
    })
    request.on('error', reject)
  })
}

function createPublicResolver({ queryDns = query } = {}) {
  const pending = new Map()
  return function resolve(hostname, signal) {
    if (!pending.has(hostname)) {
      const operation = (async () => {
        const causes = []
        for (const endpoint of ENDPOINTS) {
          signal?.throwIfAborted()
          try { return parsePublicAnswers(await queryDns(endpoint, hostname, signal), hostname) }
          catch (error) {
            if (signal?.aborted) throw signal.reason
            causes.push({ provider: endpoint.hostname, reason: error.code || error.message })
          }
        }
        const error = new Error('代理映射的公网地址无法验证，请检查代理或 DNS 后重试')
        error.code = 'PUBLIC_DNS_UNAVAILABLE'
        error.causes = causes
        throw error
      })().finally(() => pending.delete(hostname))
      pending.set(hostname, operation)
    }
    return pending.get(hostname)
  }
}

module.exports = { proxyMapping, parsePublicAnswers, createPublicResolver }
