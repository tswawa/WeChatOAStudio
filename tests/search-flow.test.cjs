const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pageResources, pageImages, readImageSource } = require('../electron/images/sources.cjs')
const { articleFromHtml } = require('../electron/ops/content.cjs')
const { nativeImageCandidates, createSearchRouter } = require('../electron/ops/search.cjs')
const { searchImages } = require('../electron/images/search.cjs')
const { createWebSearch } = require('../electron/ops/web-search.cjs')
const { ENGINES } = require('../electron/ops/search-config.cjs')
const { engineUrl, fetchProvider } = require('../electron/ops/search-providers.cjs')
const { assessSearch } = require('../electron/ops/search-relevance.cjs')
const url = 'https://example.com/article'
const fixture = '<html><head><title>Source article</title><meta property="og:image" content="/cover.png">'
  + '<script type="application/ld+json">{"@type":"Article","image":"https://example.com/original.png"}</script></head><body>'
  + '<template id="PAGE_BODY"><article><p>Actual source facts. '.repeat(1)
  + 'This is a readable article with original facts and references. '.repeat(12)
  + '</p><img src="/small.png" srcset="/medium.png 1x, /large.png 2x" alt="Actual illustration">'
  + '<template><figure><a href="/File:Illustration"><img data-src="/lazy.webp" src="data:image/png;base64,AA"><figcaption>Original illustration caption</figcaption></a></figure></template>'
  + '<a href="/full.webp"><img src="/thumbnail.webp"></a></article></template><script>throw new Error("must not execute")</script></body></html>'

test('nested inert article templates expose source text, real images and detail links without executing scripts', async () => {
  const page = pageResources(fixture, url)
  assert.equal(page.diagnostics.templatesExpanded, 2)
  assert.deepEqual(page.images.map(item => item.imageUrl), ['large.png','lazy.webp','full.webp','cover.png','original.png'].map(name => 'https://example.com/' + name))
  assert.equal(page.images[1].detailPage, 'https://example.com/File:Illustration')
  assert.ok(page.links.some(item => item.kind === 'image_detail'))
  const article = await articleFromHtml(fixture, url)
  assert.match(article.content, /original facts/)
  assert.doesNotMatch(article.content, /must not execute/)
  assert.equal(article.images.length, page.images.length)
})

test('MediaWiki file-description pages ending in image extensions are not mistaken for downloadable originals', () => {
  const images = pageImages('<article><a class="mw-file-description" href="/File:Example.webp"><img src="/actual.webp"></a>'
    + '<a class="image" href="/wiki/File:Legacy.png"><img src="/legacy-thumbnail.png"></a></article>', url)
  assert.deepEqual(images.map(item => item.imageUrl), ['https://example.com/actual.webp','https://example.com/legacy-thumbnail.png'])
  assert.deepEqual(images.map(item => item.detailPage), ['https://example.com/File:Example.webp','https://example.com/wiki/File:Legacy.png'])
})

test('image-named HTML detail pages remain readable and expose their original outside the wiki description body', async () => {
  const html = '<div class="fullImageLink"><a href="https://images.example.com/full.webp"><img src="/preview.webp"></a></div>'
    + '<div class="mw-parser-output"><p>File description without another image.</p></div>'
  const result = await readImageSource({ fetchBytes: async value => ({ url: value, bytes: Buffer.from(html), type: 'text/html' }) }, 'https://example.com/File:Artwork.webp')
  assert.ok(result.images.some(item => item.imageUrl === 'https://images.example.com/full.webp'))
  assert.ok(result.images.every(item => item.imageUrl !== 'https://example.com/File:Artwork.webp'))
})

test('srcset uses a real grammar and prefers the provided higher-resolution image over a valid thumbnail src', () => {
  const images = pageImages('<article><img src="/tiny.png" srcset="https://example.com/picture.png?crop=1,2 1x, https://example.com/large.png?crop=3,4 2x"></article>', url)
  assert.equal(images[0].imageUrl, 'https://example.com/large.png?crop=3,4')
  assert.equal(images[0].extraction, 'srcset')
})

test('JSON image information and embedded article HTML are parsed as data rather than guessed image paths', async () => {
  const body = { query: { pages: { 1: { imageinfo: [{ url: 'https://images.example.com/original.png', descriptionurl: 'https://example.com/File:Original' }] } } },
    parse: { text: { '*': '<article><img src="/embedded.webp"></article>' }, images: ['Name-only-must-not-be-invented.png'] } }
  const page = await readImageSource({ fetchBytes: async value => ({ url: value, type: 'application/json', bytes: Buffer.from(JSON.stringify(body)) }) }, url)
  assert.equal(page.images.length, 2)
  assert.ok(page.images.some(item => item.imageUrl === 'https://images.example.com/original.png'))
  assert.ok(page.images.some(item => item.imageUrl === 'https://example.com/embedded.webp'))
  assert.ok(page.images.every(item => !item.imageUrl.includes('Name-only')))
})

test('native discovery includes body/template images even when an OpenGraph image is present', async () => {
  const result = await nativeImageCandidates({ results: [{ url, title: 'Article' }] }, { fetchBytes: async () => ({ url, bytes: Buffer.from(fixture), type: 'text/html' }) })
  assert.equal(result.length, 5)
  assert.ok(result.some(item => item.imageUrl.endsWith('/large.png')))
  assert.ok(result.some(item => item.imageUrl.endsWith('/cover.png')))
})

test('empty extraction and a network timeout are not interpreted as proof of login requirements', async () => {
  const page = await readImageSource({ fetchBytes: async () => ({ bytes: Buffer.from('<div id="app"></div>'), type: 'text/html' }) }, url)
  assert.equal(page.images.length, 0)
  assert.equal(page.diagnostics.code, 'no_image_urls_in_response')
  assert.match(page.diagnostics.note, /不代表页面没有图片/)
  await assert.rejects(readImageSource({ fetchBytes: async () => { throw new Error('UND_ERR_CONNECT_TIMEOUT') } }, url), /UND_ERR_CONNECT_TIMEOUT/)
})

const imageHtml = title => `<input name="q" value="DeepSeek 娘化 表情包"><a class="iusc" m='${JSON.stringify({ murl: 'https://images.example.com/' + encodeURIComponent(title) + '.png', purl: url, t: title })}'></a>`
const query = 'DeepSeek 娘化 表情包'
test('a provider can echo the right query while returning off-topic pictures, which are not accepted merely for being nonempty', async () => {
  const requests = [], assessments = []
  const settings = { private: () => ({ search: { engines: ['bing','baidu'] } }) }
  const result = await searchImages({ fetchBytes: async address => {
    requests.push(new URL(address).hostname)
    return { url: address, bytes: Buffer.from(requests.length === 1 ? imageHtml('求生口哨')
      : JSON.stringify({ data: [{ hoverURL: 'https://images.example.com/deepseek.png', fromURL: url, fromPageTitle: 'DeepSeek娘表情包' }] })) }
  } }, query, undefined, undefined, { settings, assessSearch: async input => {
    assessments.push(input)
    if (input.results[0].title === '求生口哨') {
      assert.equal(input.results[0].searchDiagnostics.queryVerification, 'matched')
      return { status: 'off_topic', reason: '结果全部是求生口哨，与娘化角色无关', pixelReviewed: false }
    }
    return { status: 'relevant', reason: '有角色表情包线索', pixelReviewed: false }
  } })
  assert.deepEqual(requests, ['www.bing.com','image.baidu.com'])
  assert.equal(assessments.length, 2)
  assert.equal(result[0].provider, '百度')
  assert.equal(result[0].unavailableSources[0].code, 'off_topic')
  assert.equal(result[0].searchAssessment.pixelReviewed, false)
})

test('off-topic web results use only the remaining author-selected engines in the saved order', async () => {
  const requests = []
  const web = createWebSearch({ settings: { private: () => ({ search: { engines: ['bing','google'] } }) }, network: { fetchBytes: async address => {
    requests.push(new URL(address).hostname)
    return { url: address, bytes: Buffer.from(requests.length === 1 ? '<li class="b_algo"><h2><a href="https://example.com/whistle">求生口哨</a></h2></li>'
      : '<div class="MjjYud"><a href="https://example.com/character"><h3>DeepSeek娘</h3></a></div>') }
  } } })
  const result = await web.search('a', { query }, { assessSearch: async input => ({ status: input.results[0].title.includes('口哨') ? 'off_topic' : 'relevant', reason: '主题核对' }) })
  assert.deepEqual(requests, ['www.bing.com','www.google.com'])
  assert.equal(result.provider, 'Google')
  assert.equal(result.unavailableSources[0].code, 'off_topic')
})

test('unknown relevance retains candidates; assessment failures do not masquerade as provider failures or enable another engine', async () => {
  const settings = { private: () => ({ search: { engines: ['bing','google'] } }) }
  let calls = 0
  const network = { fetchBytes: async address => { calls++; return { url: address, bytes: Buffer.from(imageHtml('Untitled')) } } }
  const retained = await searchImages(network, query, undefined, undefined, { settings, assessSearch: async () => ({ status: 'unknown', reason: '需要看像素' }) })
  assert.equal(retained.length, 1)
  assert.equal(retained[0].searchAssessment.status, 'unknown')
  calls = 0
  await assert.rejects(searchImages(network, query, undefined, undefined, { settings, assessSearch: async () => { throw Object.assign(new Error('模型余额不足'), { searchAssessmentError: true }) } }), /余额不足/)
  assert.equal(calls, 1)
})

test('off-topic native results do not authorize engine fallback', async () => {
  let engines = 0
  const router = createSearchRouter({ native: { search: async () => ({ supported: true, results: [{ url, title: 'Different topic' }] }) },
    network: { fetchBytes: async () => ({ bytes: Buffer.from('<article><img src="/wrong.png"></article>'), type: 'text/html' }) },
    imageEngine: async () => { engines++; return [] } })
  const result = await router.images(null, query, undefined, undefined, { assessSearch: async () => ({ status: 'off_topic', reason: 'Wrong subject' }) })
  assert.equal(result[0].searchAssessment.status, 'off_topic')
  assert.equal(engines, 0)
})

test('search query mismatch is rejected and application-forced provider content filters are absent', async () => {
  const bing = ENGINES.find(item => item.id === 'bing')
  await assert.rejects(fetchProvider({ fetchBytes: async address => ({ url: address,
    bytes: Buffer.from('<input name="q" value="unrelated"><a class="iusc" m="{}"></a>') }) }, bing, 'images', query), /检索词与请求不符/)
  assert.equal(engineUrl(bing, 'images', query).searchParams.has('adlt'), false)
  assert.equal(engineUrl(ENGINES.find(item => item.id === 'google'), 'images', query).searchParams.has('safe'), false)
})

test('metadata relevance uses the configured model and does not claim actual image review', async () => {
  const settings = { private: () => ({ model: { name: 'current-model', apiKey: 'private-fixture-key' } }) }
  let modelCalls = 0
  const result = await assessSearch(settings, { query, mode: 'images', results: [{ title: '求生口哨', sourcePage: url }] }, {
    beforeModelCall: () => { modelCalls++ },
  }, async (actual, messages, options) => {
    assert.equal(actual, settings)
    assert.equal(options.json, true)
    assert.doesNotMatch(JSON.stringify(messages), /private-fixture-key/)
    assert.match(messages[0].content, /不是图片视觉审核/)
    return { content: JSON.stringify({ status: 'off_topic', reason: '求生口哨不是该角色' }) }
  })
  assert.equal(modelCalls, 1)
  assert.equal(result.pixelReviewed, false)
  assert.equal(result.model, 'current-model')
})
