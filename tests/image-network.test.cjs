// All download hops must remain public, bounded and tied to the validated DNS address.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { createImageNetwork, publicAddress, publicImageUrl } = require('../electron/images/network.cjs')
const { parseBing, parseOpenverse, diverseCandidates } = require('../electron/images/search.cjs')
const { proxyMapping, parsePublicAnswers, createPublicResolver } = require('../electron/images/public-dns.cjs')

function response(statusCode = 200, headers = {}, chunks = [Buffer.from('image')]) {
  return { statusCode, headers, body: Readable.from(chunks) }
}
const resolver = async () => [{ address: '8.8.8.8', family: 4 }]

const mappedAnswers = [{ address: '198.18.0.5', family: 4 }, { address: '2001:2::19', family: 6 }]
const dnsAnswer = (host, address = '8.8.8.8') => ({ Status: 0, Question: [{ name: host, type: 1 }],
  Answer: [{ name: host, type: 1, data: address }] })

test('proxy DNS pairs are recognized without accepting incomplete or mixed private results', () => {
  assert.equal(proxyMapping('images.example.com', mappedAnswers), true)
  assert.equal(proxyMapping('images.example.com', [mappedAnswers[0], { address: 'fdfe:dcba:9876::19', family: 6 }]), true)
  assert.equal(proxyMapping('198.18.0.5', mappedAnswers), false)
  for (const answers of [[mappedAnswers[0]], [mappedAnswers[1]],
    [...mappedAnswers, { address: '127.0.0.1', family: 4 }],
    [...mappedAnswers, { address: '8.8.8.8', family: 4 }]]) {
    assert.equal(proxyMapping('images.example.com', answers), false)
  }
})

test('recognized Fake-IP pairs are independently resolved and the actual connection uses only the verified public address', async () => {
  let resolutions = 0
  const network = createImageNetwork({ resolver: async () => mappedAnswers,
    publicResolver: async hostname => { resolutions += 1; assert.equal(hostname, 'images.example.com'); return [{ address: '8.8.8.8', family: 4 }] },
    connectionFactory: (url, address) => {
      assert.equal(address.address, '8.8.8.8')
      return { url: url.href, dispatcher: { destroy: async () => {} } }
    }, requester: async () => response(200, { 'content-type': 'image/png' }) })
  const result = await network.fetchBytes('https://images.example.com/picture')
  assert.equal(result.type, 'image/png')
  assert.equal(resolutions, 1)
})

test('fixed search-engine hosts use independently verified public DNS even when local DNS is poisoned', async () => {
  let consulted = false
  const network = createImageNetwork({ resolver: async () => [{ address: '2001::1', family: 6 }, { address: '31.13.92.37', family: 4 }],
    publicResolver: async hostname => { consulted = true; assert.equal(hostname, 'www.google.com'); return [{ address: '8.8.8.8', family: 4 }] },
    connectionFactory: (url, address) => {
      assert.equal(address.address, '8.8.8.8')
      return { url: url.href, dispatcher: { destroy: async () => {} } }
    }, requester: async () => response(200, { 'content-type': 'text/html' }) })
  await network.fetchBytes('https://www.google.com/search?q=desk')
  assert.equal(consulted, true)
})

test('ordinary private or mixed DNS results cannot invoke the Fake-IP fallback', async () => {
  let fallbacks = 0
  let requests = 0
  for (const answers of [[{ address: '127.0.0.1', family: 4 }], [mappedAnswers[0]],
    [...mappedAnswers, { address: '192.168.1.1', family: 4 }]]) {
    const network = createImageNetwork({ resolver: async () => answers,
      publicResolver: async () => { fallbacks += 1; return [{ address: '8.8.8.8', family: 4 }] },
      requester: async () => { requests += 1; return response() } })
    await assert.rejects(network.fetchBytes('https://images.example.com/picture'), /内网|保留/)
  }
  assert.equal(fallbacks, 0)
  assert.equal(requests, 0)
})

test('failed independent verification or nonpublic public-DNS answers never open the target', async () => {
  let requests = 0
  for (const publicResolver of [async () => { throw new Error('Verification unavailable') },
    async () => [{ address: '192.168.1.1', family: 4 }]]) {
    const network = createImageNetwork({ resolver: async () => mappedAnswers, publicResolver,
      requester: async () => { requests += 1; return response() } })
    await assert.rejects(network.fetchBytes('https://images.example.com/picture'))
  }
  assert.equal(requests, 0)
})

test('public-DNS parsing validates the question and follows only its CNAME chain', () => {
  const value = { Status: 0, Question: [{ name: 'images.example.com.', type: 1 }], Answer: [
    { name: 'images.example.com.', type: 5, data: 'cdn.example.com.' },
    { name: 'cdn.example.com.', type: 1, data: '8.8.8.8' },
    { name: 'other.example.com.', type: 1, data: '9.9.9.9' },
  ] }
  assert.deepEqual(parsePublicAnswers(value, 'images.example.com'), [{ address: '8.8.8.8', family: 4 }])
  const alidns = dnsAnswer('images.example.com')
  alidns.Question = alidns.Question[0]
  assert.deepEqual(parsePublicAnswers(alidns, 'images.example.com'), [{ address: '8.8.8.8', family: 4 }])
  assert.throws(() => parsePublicAnswers(value, 'another.example.com'))
  for (const address of ['127.0.0.1', '198.18.0.5', '169.254.169.254']) {
    assert.throws(() => parsePublicAnswers(dnsAnswer('images.example.com', address), 'images.example.com'))
  }
})

test('independent DNS lookups share in-flight verification and use fixed HTTPS resolver endpoints', async () => {
  let calls = 0
  let finish
  const resolver = createPublicResolver({ queryDns: async (endpoint, hostname) => {
    calls += 1
    assert.equal(endpoint.hostname, 'dns.alidns.com')
    assert.equal(endpoint.address, '223.5.5.5')
    return new Promise(resolve => { finish = () => resolve(dnsAnswer(hostname)) })
  } })
  const one = resolver('images.example.com')
  const two = resolver('images.example.com')
  assert.equal(calls, 1)
  assert.equal(one, two)
  finish()
  assert.deepEqual(await one, [{ address: '8.8.8.8', family: 4 }])
})

test('independent DNS tries a second pinned provider without accepting a private answer', async () => {
  const attempts = []
  const resolver = createPublicResolver({ queryDns: async (endpoint, host) => {
    attempts.push(endpoint.address)
    return dnsAnswer(host, attempts.length === 1 ? '198.18.0.5' : '8.8.8.8')
  } })
  assert.deepEqual(await resolver('images.example.com'), [{ address: '8.8.8.8', family: 4 }])
  assert.deepEqual(attempts, ['223.5.5.5', '1.1.1.1'])
})

test('search candidates prefer distinct sources without claiming previews have passed visual review', () => {
  const item = (id, host, title = 'Desk', licenseVerified = false) => ({ id, sourcePage: `https://${host}/photo/${id}`,
    imageUrl: `https://${host}/image/${id}`, title, licenseVerified })
  const result = diverseCandidates([item('stock1', 'stock.example.com', '正版图片'),
    item('stock2', 'stock.example.com', '正版图片'), item('shop', 'shop.example.com'),
    item('shop2', 'shop.example.com'), item('photo', 'photos.example.com')], 3)
  assert.deepEqual(result.map(value => value.id), ['stock1', 'shop', 'photo'])
  assert.equal(result.every(value => value.licenseVerified === false), true)
  const licensed = diverseCandidates([item('shop', 'shop.example.com'),
    item('cc0', 'public.example.com', 'Public domain', true)], 1)
  assert.equal(licensed[0].id, 'shop')
})

test('candidate selection deduplicates files but can fill remaining slots when only one source exists', () => {
  const one = { imageUrl: 'https://example.com/a.png', sourcePage: 'https://example.com/photo/a', title: 'One' }
  const two = { imageUrl: 'https://example.com/b.png', sourcePage: 'https://example.com/photo/b', title: 'Two' }
  assert.deepEqual(diverseCandidates([one, { ...one }, two], 6), [one, two])
})

test('transient GET failures retry once using only already verified public addresses', async () => {
  const addresses = []
  let calls = 0, disposed = 0
  const network = createImageNetwork({ resolver: async () => [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }],
    connectionFactory: (url, address) => { addresses.push(address.address); return { url: url.href, dispatcher: { destroy() { disposed += 1 } } } },
    requester: async (_url, options) => {
      assert.equal(options.method, 'GET')
      assert.equal(options.headers.Host, 'images.example.com')
      calls += 1
      if (calls === 1) throw Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })
      return response()
    } })
  assert.equal((await network.fetchBytes('https://images.example.com/photo.png')).bytes.toString(), 'image')
  assert.deepEqual(addresses, ['8.8.8.8','1.1.1.1'])
  assert.equal(calls, 2)
  assert.equal(disposed, 2)
})

test('access denials, certificate errors and size limits never trigger connection retries', async () => {
  for (const mode of ['denied','certificate','size']) {
    let calls = 0
    const network = createImageNetwork({ resolver, requester: async () => {
      calls += 1
      if (mode === 'certificate') throw Object.assign(new Error('Invalid certificate'), { code: 'CERT_HAS_EXPIRED' })
      return mode === 'denied' ? response(403) : response(200, { 'content-length': '99999999' })
    } })
    await assert.rejects(network.fetchBytes('https://images.example.com/photo.png'))
    assert.equal(calls, 1)
  }
})

test('transient GET retries stop after the second failure', async () => {
  let calls = 0
  const network = createImageNetwork({ resolver, requester: async () => {
    calls += 1
    throw Object.assign(new Error('Reset'), { code: 'ECONNRESET' })
  } })
  await assert.rejects(network.fetchBytes('https://images.example.com/photo.png'), /ECONNRESET/)
  assert.equal(calls, 2)
})

test('private, mapped and reserved addresses and unsafe URL forms are blocked', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1',
    '198.18.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8']) {
    assert.equal(publicAddress(address), false, address)
  }
  assert.equal(publicAddress('8.8.8.8'), true)
  assert.equal(publicAddress('2606:4700:4700::1111'), true)
  for (const url of ['file:///C:/secret', 'http://2130706433/a', 'http://localhost/a',
    'http://service.internal/a', 'https://example.com:445/a', 'https://user:pass@example.com/a', '', undefined]) {
    assert.throws(() => publicImageUrl(url))
  }
})

test('DNS rebinding and mixed public/private DNS answers stop before connecting', async () => {
  let calls = 0
  const network = createImageNetwork({ resolver: async () => [
    { address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 },
  ], requester: async () => { calls += 1; return response() } })
  await assert.rejects(network.fetchBytes('https://images.example.com/picture'), /内网|保留/)
  assert.equal(calls, 0)
})

test('every redirect is revalidated and cannot redirect a download into an internal service', async () => {
  let calls = 0
  const network = createImageNetwork({ resolver, requester: async () => {
    calls += 1
    return response(302, { location: 'http://169.254.169.254/latest/meta-data' })
  } })
  await assert.rejects(network.fetchBytes('https://images.example.com/picture'), /公开/)
  assert.equal(calls, 1)
})

test('unknown lengths are bounded while streaming and no cookies or model key are sent', async () => {
  const network = createImageNetwork({ resolver, requester: async (_url, options) => {
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.maxRedirections, 0)
    return response(200, {}, [Buffer.alloc(4), Buffer.alloc(4)])
  } })
  await assert.rejects(network.fetchBytes('https://images.example.com/picture', { maxBytes: 5 }), /大小/)
})

test('an explicitly configured system proxy still connects to an approved IP with the original Host', async () => {
  const network = createImageNetwork({ resolver, getProxy: async () => 'PROXY 127.0.0.1:7890',
    requester: async (url, options) => {
      assert.equal(new URL(url).hostname, '8.8.8.8')
      assert.equal(options.headers.Host, 'images.example.com')
      return response(200, { 'content-type': 'image/png' })
    } })
  const result = await network.fetchBytes('https://images.example.com/picture')
  assert.equal(result.type, 'image/png')
})

test('cancellation also interrupts a pending DNS lookup before any connection', async () => {
  const controller = new AbortController()
  let calls = 0
  const network = createImageNetwork({ resolver: () => new Promise(() => {}),
    requester: async () => { calls += 1; return response() } })
  const pending = network.fetchBytes('https://images.example.com/a', { signal: controller.signal })
  controller.abort(new Error('Stopped by user'))
  await assert.rejects(pending, /Stopped by user/)
  assert.equal(calls, 0)
})

test('a refused real HTTP response is disposed without an uncaught stream abort error', async t => {
  const http = require('node:http')
  const { request } = require('undici')
  const server = http.createServer((_request, response) => { response.writeHead(403); response.write('refused') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const network = createImageNetwork({ resolver,
    requester: () => request(`http://127.0.0.1:${server.address().port}/image`) })
  await assert.rejects(network.fetchBytes('https://images.example.com/refused'), /HTTP 403/)
  await new Promise(resolve => setImmediate(resolve))
})

test('the total deadline bounds native proxy resolution, requests and response chunks', async () => {
  const stalled = () => new Promise(() => {})
  for (const options of [
    { getProxy: stalled },
    { requester: stalled },
    { requester: async () => ({ statusCode: 200, headers: {}, body: new Readable({ read() {} }) }) },
  ]) {
    const network = createImageNetwork({ resolver, requester: async () => response(), ...options })
    await assert.rejects(network.fetchBytes('https://images.example.com/a', { timeout: 30 }), /超时/)
  }
})

test('a stuck connection destructor cannot keep the download operation open indefinitely', async () => {
  let destroyed = false
  const network = createImageNetwork({ resolver, requester: async () => response(),
    connectionFactory: url => ({ url: url.href, dispatcher: { destroy() { destroyed = true; return new Promise(() => {}) } } }),
  })
  const result = await network.fetchBytes('https://images.example.com/a')
  assert.equal(result.bytes.toString(), 'image')
  assert.equal(destroyed, true)
})

test('search metadata is parsed as JSON data, deduced from real result URLs and never executed', () => {
  const good = { murl: 'https://images.example.com/a.jpg', purl: 'https://example.com/article', t: 'Image',
    license: 'CC0' }
  const html = `<a class="iusc" m='${JSON.stringify(good)}'></a>`
    + '<script>throw new Error("Do not execute")</script><a class="iusc" m="broken"></a>'
    + `<a class="iusc" m='${JSON.stringify({ ...good, murl: 'http://127.0.0.1/secret' })}'></a>`
  const result = parseBing(html)
  assert.equal(result.length, 1)
  assert.equal(result[0].licenseVerified, undefined)
  assert.equal(result[0].license, undefined)
  assert.equal(result[0].imageUrl, good.murl)
  const sources = parseOpenverse({ results: [
    { url: good.murl, foreign_landing_url: good.purl, title: 'Open image', creator: 'Author', license: 'by',
      license_url: 'https://creativecommons.org/licenses/by/4.0/' },
    { url: 'https://images.example.com/noncommercial.jpg', foreign_landing_url: good.purl, license: 'by-nc' },
    { url: 'https://images.example.com/unspecified.jpg', foreign_landing_url: good.purl },
    { url: 'https://images.example.com/custom.jpg', foreign_landing_url: good.purl,
      license: 'custom', license_url: 'https://example.com/custom-license' },
    { url: 'https://images.example.com/bad-metadata.jpg', foreign_landing_url: good.purl,
      license: 'custom', license_url: 'javascript:alert(1)' },
  ] })
  assert.equal(sources.length, 5)
  assert.equal(sources.every(item => !Object.hasOwn(item, 'licenseVerified')), true)
  assert.equal(sources[0].license, 'by')
  assert.equal(sources[1].license, 'by-nc')
  assert.equal(sources[2].license, undefined)
  assert.equal(sources[3].licenseUrl, 'https://example.com/custom-license')
  assert.equal(sources[4].licenseUrl, undefined)
  assert.equal(parseOpenverse({ results: [{ url: 'http://127.0.0.1/secret', foreign_landing_url: good.purl }] }).length, 0)
})
