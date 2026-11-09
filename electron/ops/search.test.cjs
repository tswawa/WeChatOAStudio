const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createNativeSearch } = require('./native-search.cjs')
const { createSearchRouter, nativeImageCandidates } = require('./search.cjs')
const { parseWebResults, resultUrl, createWebSearch } = require('./web-search.cjs')

const settings = { private: () => ({ model: { name: 'test-model', baseUrl: 'https://api.example.com/v1', apiKey: 'test-key',
  apiFormat: 'chat-completions' } }) }
const stream = values => (async function* () { yield* values })()
const error = (status, message) => Object.assign(new Error(message), { status })
const nativeResult = { supported: true, provider: '模型原生搜索', fetchedAt: Date.now(),
  results: [{ title: 'Desk', url: 'https://example.com/desk', snippet: '' }], summary: 'Native search result' }
const chatCitation = { choices: [{ delta: { content: 'Result', annotations: [
  { type: 'url_citation', url_citation: { title: 'Source', url: 'https://example.com/source' } },
] } }] }

test('Chat native search results suppress every engine fallback', async () => {
  let engines = 0
  let modelCalls = 0
  const native = createNativeSearch({ settings, clientFactory: async () => ({ chat: { completions: {
    create: async request => { modelCalls += 1; assert.ok(request.web_search_options); return stream([chatCitation]) },
  } } }) })
  const router = createSearchRouter({ settings, native, engineWeb: { search: async () => { engines += 1 } } })
  const result = await router.web('a', { query: 'desk' })
  assert.equal(result.provider, '模型原生搜索')
  assert.equal(result.results[0].url, 'https://example.com/source')
  assert.equal(modelCalls, 1)
  assert.equal(engines, 0)
})

test('Responses native search sends a real built-in search and preserves returned sources', async () => {
  const native = createNativeSearch({ settings: { private: () => ({ model: { ...settings.private().model, apiFormat: 'responses' } }) },
    clientFactory: async () => ({ responses: { create: async request => {
      assert.equal(request.tools[0].type, 'web_search')
      assert.equal(request.tool_choice, 'required')
      return stream([{ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://example.com/native', title: 'Native' }] } },
      ] } }])
    } } }) })
  const result = await native.search('desk')
  assert.equal(result.supported, true)
  assert.equal(result.format, 'responses')
  assert.equal(result.results[0].url, 'https://example.com/native')
})

test('explicit lack of native capability permits Bing and caches the unsupported result', async () => {
  const order = []
  const native = createNativeSearch({ settings, clientFactory: async () => ({ chat: { completions: {
    create: async () => { order.push('native-chat'); return stream([{ choices: [{ delta: { content: '当前接口没有原生联网搜索能力。' } }] }]) },
  } }, responses: { create: async () => { order.push('native-responses'); throw error(404, 'Endpoint not found') } } }) })
  const router = createSearchRouter({ settings, native, engineWeb: { search: async () => { order.push('bing'); return { provider: 'Bing', results: [] } } } })
  const first = await router.web('a', { query: 'desk' })
  await router.web('a', { query: 'another desk' })
  assert.deepEqual(order, ['native-chat', 'native-responses', 'bing', 'bing'])
  assert.match(first.fallbackReason, /没有原生/)
})

test('a preferred native format being unsupported still tries the other native format before Bing', async () => {
  let engines = 0
  const native = createNativeSearch({ settings, clientFactory: async () => ({ chat: { completions: {
    create: async () => { throw error(400, 'web_search_options is not supported') },
  } }, responses: { create: async () => stream([{ type: 'response.completed', response: { status: 'completed', output: [
    { type: 'web_search_call', action: { sources: [{ title: 'Native', url: 'https://example.com/native' }] } },
  ] } }]) } }) })
  const router = createSearchRouter({ settings, native, engineWeb: { search: async () => { engines += 1 } } })
  assert.equal((await router.web('a', { query: 'desk' })).provider, '模型原生搜索')
  assert.equal(engines, 0)
})

test('authentication, quota, server errors and uncertain native output never trigger an engine fallback', async () => {
  for (const failure of [error(401, 'Unauthorized'), error(403, 'Forbidden'), error(429, 'Quota'), error(503, 'Unavailable'),
    error(400, 'Invalid model name')]) {
    let engines = 0
    const native = createNativeSearch({ settings, clientFactory: async () => ({ chat: { completions: {
      create: async () => { throw failure },
    } } }) })
    const router = createSearchRouter({ settings, native, engineWeb: { search: async () => { engines += 1 } } })
    await assert.rejects(router.web('a', { query: 'desk' }))
    assert.equal(engines, 0)
  }
  let engines = 0
  const native = createNativeSearch({ settings, clientFactory: async () => ({ chat: { completions: {
    create: async () => stream([{ choices: [{ delta: { content: 'Here is an answer without actual search evidence.' } }] }]),
  } } }) })
  const router = createSearchRouter({ settings, native, engineWeb: { search: async () => { engines += 1 } } })
  await assert.rejects(router.web('a', { query: 'desk' }), /未返回可验证/)
  assert.equal(engines, 0)
})

test('native image search extracts actual page images rather than inventing URLs or invoking Bing', async () => {
  let engineCalls = 0
  const network = { fetchBytes: async () => ({ bytes: Buffer.from('<meta property="og:image" content="/actual.jpg">') }) }
  const router = createSearchRouter({ settings, network, native: { search: async () => nativeResult },
    imageEngine: async () => { engineCalls += 1 } })
  const result = await router.images(network, 'desk', 2)
  assert.equal(result[0].imageUrl, 'https://example.com/actual.jpg')
  assert.equal(result[0].sourcePage, 'https://example.com/desk')
  assert.equal(result[0].provider, '模型原生搜索')
  assert.equal(engineCalls, 0)
  await assert.rejects(nativeImageCandidates(nativeResult, { fetchBytes: async () => ({ bytes: Buffer.from('<p>No images</p>') }) }, 2), /未改用搜索引擎/)
})

test('only explicit native lack of support permits the image engine fallback', async () => {
  let engines = 0
  const router = createSearchRouter({ settings, native: { search: async () => ({ supported: false, reason: 'Explicit unsupported' }) },
    imageEngine: async () => { engines += 1; return [{ imageUrl: 'https://example.com/a.png' }] } })
  const result = await router.images({}, 'desk', 1)
  assert.equal(engines, 1)
  assert.equal(result[0].fallbackReason, 'Explicit unsupported')
})

test('web parser decodes actual Bing result destinations and rejects local links', () => {
  const destination = 'https://example.com/article'
  const link = 'https://www.bing.com/ck/a?u=a1' + Buffer.from(destination).toString('base64url')
  const html = `<ol><li class="b_algo"><h2><a href="${link}">Article title</a></h2><div class="b_caption"><p>Summary</p></div></li>
    <li class="b_algo"><h2><a href="http://127.0.0.1/secret">Unsafe</a></h2></li></ol>`
  assert.deepEqual(parseWebResults(html), [{ title: 'Article title', url: destination, snippet: 'Summary' }])
  assert.throws(() => resultUrl('http://localhost/secret'))
})

test('application-side Bing search uses only GET-style public fetches with bounded parsing', async () => {
  const requests = []
  const engine = createWebSearch({ network: { fetchBytes: async (url, options) => {
    requests.push({ url, options })
    return { bytes: Buffer.from('<li class="b_algo"><h2><a href="https://example.com/desk">Desk</a></h2><p>Organize a desk.</p></li>') }
  } } })
  const result = await engine.search('a', { query: '办公桌整理', limit: 2 })
  assert.equal(result.provider, 'Bing')
  assert.equal(new URL(requests[0].url).hostname, 'www.bing.com')
  assert.equal(requests[0].options.maxBytes, 3 * 1024 * 1024)
  assert.equal(result.results.length, 1)
})
