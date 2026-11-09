const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { pageImages, markdownImages, sourceImages, repositoryFileUrl } = require('../electron/images/sources.cjs')
const { articleFromHtml, renderArticle } = require('../electron/ops/content.cjs')
const { createImageService } = require('../electron/images/index.cjs')
const { createOpsStore } = require('../electron/ops/store.cjs')
const { createChat } = require('../electron/ops/chat.cjs')
const { modelResponse } = require('./helpers/model-response.cjs')
const png = fs.readFileSync(path.join(__dirname, '../electron/assets/app-icon.png'))
const url = 'https://raw.githubusercontent.com/author/project/main/README.md'

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-source-images-'))
  const store = createOpsStore(path.join(directory, 'ops.sqlite'))
  const state = { store, uploads: 0, drafts: 0, searches: 0, reviews: 0, directory }
  state.settings = { private: () => ({ model: { name: 'current-test' }, images: { downloadDirectory: path.join(directory, 'images') }, bot: { maxSteps: 256 } }) }
  state.mp = { uploadMaterial: async () => { state.uploads += 1; return { url: 'https://mmbiz.qpic.cn/test.png' } },
    saveDraft: async (_account, draft) => { state.drafts += 1; return { id: 'draft-one', ...draft } } }
  state.service = createImageService({ store, settings: state.settings, mp: state.mp,
    searcher: async () => { state.searches += 1; throw new Error('Source images must not depend on search indexing') },
    network: { fetchBytes: async value => value.endsWith('.md') ? { bytes: Buffer.from('# Product\n\n![Buyer conversation](docs/buyer.png)'), type: 'text/plain', url: value }
      : { bytes: png, type: 'image/png', url: value } },
    normalizer: async bytes => ({ bytes, width: 512, height: 512, mimeType: 'image/png' }),
    reviewer: async () => { state.reviews += 1; return { approved: true, description: 'A real application screenshot.', reason: 'Relevant to the product', model: 'current-test', reviewedAt: Date.now() } },
    ...options,
  })
  t.after(async () => { await state.chat?.close(); await state.service.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return state
}

test('HTML source discovery preserves relative, lazy and picture images while rejecting unsafe targets and page chrome', () => {
  const html = '<main><img src="https://example.com/avatar.png"><article class="markdown-body">'
    + '<img src="docs/buyer.png" alt="Buyer conversation"><img data-src="/images/product.webp" src="data:image/png;base64,AAA" alt="Product">'
    + '<picture><source srcset="images/small.png 1x, images/large.png 2x"><img alt="Support"></picture>'
    + '<img src="http://127.0.0.1/secret"><img src="file:///C:/secret.png"><img src="javascript:alert(1)">'
    + '<img src="docs/buyer.png"></article></main>'
  const result = pageImages(html, 'https://example.com/repository/README.html')
  assert.deepEqual(result.map(item => item.imageUrl), ['https://example.com/repository/docs/buyer.png',
    'https://example.com/images/product.webp', 'https://example.com/repository/images/large.png'])
  assert.equal(result[0].title, 'Buyer conversation')
  assert.ok(result.every(item => item.sourcePage === 'https://example.com/repository/README.html'))
})

test('README Markdown uses a real parser for inline/reference images and HTML but ignores fenced examples', async () => {
  const value = '# Product\n\n![Buyer](docs/buyer.png)\n\n![Support][shot]\n\n[shot]: docs/support.png "Chat"\n\n'
    + '<img src="docs/product.png" alt="Products">\n\n```md\n![Not a real screenshot](ignored.png)\n```'
  const result = await markdownImages(value, url)
  assert.deepEqual(result.map(item => item.imageUrl), ['buyer','support','product'].map(name => `https://raw.githubusercontent.com/author/project/main/docs/${name}.png`))
  assert.equal(result[1].title, 'Support')
})

test('GitHub blob URLs normalize to raw files without guessing a repository default branch', async () => {
  const given = 'https://github.com/author/project/blob/release/docs/README.md'
  assert.equal(repositoryFileUrl(given), 'https://raw.githubusercontent.com/author/project/release/docs/README.md')
  assert.equal(repositoryFileUrl('https://github.com/author/project/raw/main/docs/buyer.png'), 'https://raw.githubusercontent.com/author/project/main/docs/buyer.png')
  assert.equal(repositoryFileUrl('https://github.com/author/project'), 'https://github.com/author/project')
  const result = await sourceImages({ fetchBytes: async value => {
    assert.equal(value, 'https://raw.githubusercontent.com/author/project/release/docs/README.md')
    return { bytes: Buffer.from('![Buyer](../screenshots/buyer.png)'), type: 'text/plain', url: value }
  } }, given)
  assert.equal(result[0].imageUrl, 'https://raw.githubusercontent.com/author/project/release/screenshots/buyer.png')
  assert.equal(result[0].sourcePage, given)
})

test('article extraction returns real image metadata alongside readable source text', async () => {
  const result = await articleFromHtml('<html><head><title>Product</title></head><body><article><h1>Product</h1><p>'
    + 'This page contains actual readable facts about the product and its interface. '.repeat(10)
    + '</p><img src="./buyer.png" alt="Buyer conversation"></article></body></html>', 'https://example.com/docs/README.html')
  assert.match(result.content, /readable facts/)
  assert.equal(result.images[0].imageUrl, 'https://example.com/docs/buyer.png')
})

test('direct image URLs work without a search index, including correctly encoded octet-stream files', async () => {
  const result = await sourceImages({ fetchBytes: async value => ({ bytes: png, type: 'application/octet-stream', url: value }) }, 'https://example.com/buyer.png')
  assert.equal(result[0].origin, 'direct')
  assert.equal(result[0].imageUrl, 'https://example.com/buyer.png')
  await assert.rejects(sourceImages({ fetchBytes: async value => ({ bytes: Buffer.from('<script>not an image</script>'), type: 'image/png', url: value }) }, 'https://example.com/bad.png'), /无法识别/)
})

test('source discovery creates account-scoped candidates, and only current-model approval saves them', async t => {
  const f = setup(t)
  const result = await f.service.fromSources('a', { urls: [url] })
  assert.equal(f.searches, 0)
  assert.equal(result.images.length, 1)
  assert.equal(fs.existsSync(path.join(f.directory, 'images')), false)
  const candidate = result.images[0]
  await assert.rejects(f.service.prepare('b', { id: candidate.id, topic: 'Buyer conversations' }), /不属于/)
  const prepared = await f.service.prepare('a', { id: candidate.id, topic: 'Buyer conversations' })
  assert.equal(f.reviews, 1)
  const saved = await f.service.file('a', prepared.id)
  assert.ok(saved.bytes.equals(png))
  assert.equal(f.uploads, 0)
  assert.equal(f.drafts, 0)
  const html = await renderArticle(`Article\n\n${prepared.markdown}`, [], { resolveImage: ref => f.service.resolve('a', ref) })
  assert.match(html, /data-oa-image-id/)
})

test('source discovery reports partial failures and respects cancellation without creating candidates', async t => {
  const controller = new AbortController()
  const f = setup(t, { network: { fetchBytes: async value => {
    if (value.includes('/failed')) throw new Error('HTTP 403')
    if (value.includes('/cancel')) { controller.abort(new Error('Stopped by author')); return { bytes: png, type: 'image/png', url: value } }
    return { bytes: png, type: 'image/png', url: value }
  } } })
  const result = await f.service.fromSources('a', { urls: ['https://example.com/failed', 'https://example.com/buyer.png'] })
  assert.equal(result.images.length, 1)
  assert.equal(result.failures[0].reason, 'HTTP 403')
  const before = f.store.list('images', 'a').length
  await assert.rejects(f.service.fromSources('a', { urls: ['https://example.com/cancel'] }, { signal: controller.signal }), /Stopped by author/)
  assert.equal(f.store.list('images', 'a').length, before)
})

test('the actual Bot workspace tool can read README images, review them and create a confirmation without search or writes', async t => {
  const f = setup(t)
  let calls = 0
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.match(body.messages[0].content, /不要求被搜索引擎收录/)
    const outputs = body.messages.filter(item => item.role === 'tool')
    const returned = outputs.length ? JSON.parse(outputs.at(-1).content) : null
    calls += 1
    const tool = calls === 1 ? { name: 'read_workspace', args: { kind: 'image_sources', urls: [url] } }
      : calls === 2 ? { name: 'read_workspace', args: { kind: 'image_prepare', imageId: returned.images[0].id, topic: 'Buyer conversations' } }
        : { name: 'propose_action', args: { action: 'draft.create', title: 'Use original screenshot', detail: 'The actual README screenshot.',
          payload: JSON.stringify({ title: 'Product guide', markdown: 'A product guide.\n\n' + returned.markdown }) } }
    modelResponse(response, { role: 'assistant', content: null, tool_calls: [{ id: `source-${calls}`, type: 'function', function: {
      name: tool.name, arguments: JSON.stringify(tool.args),
    } }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), model: { name: 'current-test', apiKey: 'test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1` } })
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service, notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  const result = await f.chat.send('a', { text: '优先使用链接里 README 的图片，写一篇文章并配图。' })
  const card = result.messages.find(item => item.card?.action === 'draft.create')
  assert.ok(card)
  assert.equal(card.card.payload.images.length, 1)
  assert.equal(card.card.payload.images[0].sourcePage, url)
  assert.equal(card.card.state, 'open')
  assert.equal(f.searches, 0)
  assert.equal(f.uploads, 0)
  assert.equal(f.drafts, 0)
})
