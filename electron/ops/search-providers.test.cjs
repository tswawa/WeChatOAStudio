const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ENGINES, normalizeSearch } = require('./search-config.cjs')
const { engineUrl, parseWeb, jsonImages, htmlImages, fetchProvider } = require('./search-providers.cjs')
const { createWebSearch } = require('./web-search.cjs')
const { searchImages } = require('../images/search.cjs')

const article = 'https://example.com/article'
const picture = 'https://images.example.com/photo.jpg'
const bingRedirect = 'https://www.bing.com/ck/a?u=a1' + Buffer.from(article).toString('base64url')
const yahooRedirect = 'https://r.search.yahoo.com/_ylt=example/RU=' + encodeURIComponent(article) + '/RK=2/RS=example'
const webFixtures = {
  bing: `<li class="b_algo"><h2><a href="${bingRedirect}">Title</a></h2><div class="b_caption"><p>Summary</p></div></li>`,
  google: `<div class="MjjYud"><a href="/url?q=${encodeURIComponent(article)}"><h3>Title</h3></a><div class="VwiC3b">Summary</div></div>`,
  baidu: `<div class="result c-container" mu="${article}"><h3><a href="https://www.baidu.com/link?url=tracking">Title</a></h3><div class="c-abstract">Summary</div></div>`,
  sogou: `<div class="vrwrap"><h3><a href="${article}">Title</a></h3><p>Summary</p></div>`,
  so360: `<div class="res-list"><h3><a href="${article}">Title</a></h3><p>Summary</p></div>`,
  duckduckgo: `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(article)}">Title</a><div class="result__snippet">Summary</div></div>`,
  yahoo: `<div id="web"><div class="algo"><h3><a href="${yahooRedirect}">Title</a></h3><p>Summary</p></div></div>`,
  yandex: `<li class="serp-item"><h2><a href="${article}">Title</a></h2><p>Summary</p></li>`,
}
const jsonFixtures = {
  baidu: { data: [{ hoverURL: picture, fromURL: article, fromPageTitleEnc: 'Photo' }] },
  sogou: { data: { items: [{ oriPicUrl: picture, oriPageUrl: article, title: 'Photo' }] } },
  so360: { list: [{ img: picture, link: article, title: 'Photo' }] },
  duckduckgo: { results: [{ image: picture, url: article, title: 'Photo' }] },
}
function imageFixture(id) {
  if (id === 'bing') return `<a class="iusc" m='${JSON.stringify({ murl: picture, purl: article, t: 'Photo' })}'></a>`
  if (id === 'yandex') return `<div data-bem='${JSON.stringify({ 'serp-item': { img_href: picture, snippet: { url: article, title: 'Photo' } } })}'></div>`
  return `<a href="/imgres?imgurl=${encodeURIComponent(picture)}&imgrefurl=${encodeURIComponent(article)}"><img alt="Photo"></a>`
}

for (const engine of ENGINES) {
  test(`${engine.name} web results and fixed query endpoints are supported`, () => {
    const url = engineUrl(engine, 'web', '办公桌 test')
    assert.equal(url.origin, engine.webOrigin)
    assert.equal(url.searchParams.get(engine.webQuery), '办公桌 test')
    const result = parseWeb(engine, webFixtures[engine.id], url.href)
    assert.equal(result[0].url, article)
    assert.equal(result[0].title, 'Title')
  })
  test(`${engine.name} image results retain actual image and source URLs`, () => {
    const result = jsonFixtures[engine.id] ? jsonImages(engine, jsonFixtures[engine.id])
      : htmlImages(engine, imageFixture(engine.id), engineUrl(engine, 'images', 'desk').href)
    assert.equal(result[0].imageUrl, picture)
    assert.equal(result[0].sourcePage, article)
    assert.equal(result[0].provider, engine.name)
    assert.equal(result[0].licenseVerified, undefined)
    assert.equal(result[0].license, undefined)
  })
}

test('selected web engines fail over in the author\'s order and never enable an unselected source', async () => {
  const requests = []
  const settings = { private: () => ({ search: { engines: ['google', 'bing'] } }) }
  const engine = createWebSearch({ settings, network: { fetchBytes: async url => {
    requests.push(new URL(url).hostname)
    return { url, bytes: Buffer.from(new URL(url).hostname === 'www.google.com' ? '<p>Verification required</p>' : webFixtures.bing) }
  } } })
  const result = await engine.search('a', { query: 'desk' })
  assert.deepEqual(requests, ['www.google.com', 'www.bing.com'])
  assert.equal(result.provider, 'Bing')
  assert.equal(result.unavailableSources[0].engine, 'Google')
})

test('selected image engines use the same configured ordering', async () => {
  const requests = []
  const settings = { private: () => ({ search: { engines: ['google', 'baidu'] } }) }
  const network = { fetchBytes: async url => {
    requests.push(new URL(url).hostname)
    return { url, bytes: Buffer.from(new URL(url).hostname === 'www.google.com' ? '<p>No public images</p>' : JSON.stringify(jsonFixtures.baidu)) }
  } }
  const result = await searchImages(network, 'desk', 2, undefined, { settings })
  assert.deepEqual(requests, ['www.google.com', 'image.baidu.com'])
  assert.equal(result[0].provider, '百度')
})

test('DuckDuckGo uses only the publicly returned search token and a fixed JSON endpoint', async () => {
  const engine = ENGINES.find(item => item.id === 'duckduckgo')
  const calls = []
  const network = { fetchBytes: async url => {
    calls.push(url)
    return { bytes: Buffer.from(calls.length === 1 ? '<script>var vqd="123456-7890";</script>' : JSON.stringify(jsonFixtures.duckduckgo)) }
  } }
  const result = await fetchProvider(network, engine, 'images', 'desk')
  assert.equal(new URL(calls[1]).origin, 'https://duckduckgo.com')
  assert.equal(new URL(calls[1]).pathname, '/i.js')
  assert.equal(new URL(calls[1]).searchParams.get('vqd'), '123456-7890')
  assert.equal(result[0].imageUrl, picture)
})

test('captcha pages and explicit spider denials remain errors rather than being bypassed', async () => {
  const baidu = ENGINES.find(item => item.id === 'baidu')
  await assert.rejects(fetchProvider({ fetchBytes: async () => ({ url: 'https://wappass.baidu.com/static/captcha/tuxing.html',
    bytes: Buffer.from('<title>百度安全验证</title>') }) }, baidu, 'web', 'desk'), /安全验证/)
  await assert.rejects(fetchProvider({ fetchBytes: async () => ({ bytes: Buffer.from('{"antiFlag":1,"message":"Forbid spider access"}') }) },
    baidu, 'images', 'desk'), /不允许自动访问/)
})

test('source settings require at least one known engine and preserve author ordering', () => {
  assert.deepEqual(normalizeSearch({ engines: ['google', 'baidu', 'google'] }), { engines: ['google', 'baidu'] })
  assert.throws(() => normalizeSearch({ engines: [] }))
  assert.throws(() => normalizeSearch({ engines: ['http://127.0.0.1'] }))
  assert.equal(ENGINES.length, 8)
})
