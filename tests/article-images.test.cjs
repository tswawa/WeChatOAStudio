// Exercise search -> review -> local file -> confirmed WeChat upload without real account writes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createOpsStore } = require('../electron/ops/store.cjs')
const { createImageService } = require('../electron/images/index.cjs')
const { createChat, draftVersion } = require('../electron/ops/chat.cjs')
const { renderArticle, styleArticleHtml } = require('../electron/ops/content.cjs')
const { references, existingImages } = require('../electron/images/article.cjs')
const { inspectRaster, validateReview } = require('../electron/images/review.cjs')
const { normalizeImages } = require('../electron/images/config.cjs')
const { modelResponse } = require('./helpers/model-response.cjs')

const png = fs.readFileSync(path.join(__dirname, '../electron/assets/app-icon.png'))
const approved = () => ({ approved: true, decision: 'approved', relevant: true, risks: [],
  description: 'A green application icon on a light background.', reason: 'Safe and relevant to the article.',
  model: 'test-current', reviewedAt: Date.now() })

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-images-'))
  const folder = path.join(directory, 'approved')
  const store = createOpsStore(path.join(directory, 'ops.sqlite'))
  const f = { directory, folder, store, uploads: [], drafts: [], reviews: 0, downloads: 0 }
  f.settings = { private: () => ({ model: { name: 'test-current', contextWindow: 128000 }, images: { downloadDirectory: folder } }) }
  f.mp = {
    uploadMaterial: async (account, value) => {
      f.uploads.push({ account, value })
      return { id: '10001', url: 'https://mmbiz.qpic.cn/uploaded.png', mediaId: 'wechat-media' }
    },
    saveDraft: async (account, value) => { f.drafts.push({ account, value }); return { id: 'draft-1', ...value } },
  }
  f.service = createImageService({ store, settings: f.settings, mp: f.mp,
    network: { fetchBytes: async () => { f.downloads += 1; return { bytes: png, type: 'image/png' } } },
    searcher: async () => [{ imageUrl: 'https://images.example.com/picture.png', sourcePage: 'https://example.com/photo',
      title: 'A source picture', author: 'Photographer', license: '来源未提供明确授权', licenseVerified: false,
      createdAt: Date.now() }],
    normalizer: async bytes => ({ bytes, width: 512, height: 512, mimeType: 'image/png' }),
    reviewer: async (settings, image, _topic, _metadata, context) => {
      assert.equal(settings.private().model.name, 'test-current')
      assert.equal(image.bytes.equals(png), true)
      assert.equal(fs.existsSync(folder), false, 'An image was written before the model approved it')
      context.beforeModelCall?.()
      f.reviews += 1
      return approved()
    }, ...options,
  })
  t.after(async () => {
    await f.chat?.close()
    await f.service.close()
    store.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return f
}
async function prepare(f, options) {
  const [candidate] = await f.service.search('a', { query: 'app icon' })
  return f.service.prepare('a', { id: candidate.id, topic: 'application icons' }, options)
}

test('image quantity is not hard-coded into the image tool schema', () => {
  const { IMAGE_TOOLS } = require('../electron/images/tools.cjs')
  assert.equal(IMAGE_TOOLS[0].function.parameters.properties.limit.maximum, undefined)
})

test('image-count requests remain author instructions rather than programmatic proposal blockers', async t => {
  const f = setup(t)
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    modelResponse(response, { role: 'assistant', content: null, tool_calls: [{ id: 'plain-text-proposal', type: 'function',
      function: { name: 'propose_action', arguments: JSON.stringify({ action: 'draft.create', title: 'Wrong downgrade', detail: 'Text only',
        payload: JSON.stringify({ title: 'An article', markdown: '## Article\n\nBody without the requested images.' }) }) } }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  f.settings.private = () => ({ model: { name: 'test-current', apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, images: { downloadDirectory: f.folder },
    bot: { maxSteps: 1, memoryEnabled: false } })
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service,
    notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  const result = await f.chat.send('a', { text: '写一篇文章，联网找两张合适的配图。' })
  assert.equal(result.messages.some(message => message.role === 'card'), true)
  assert.equal(result.messages.flatMap(message => message.activity || []).some(step => step.state === 'error'), false)
  assert.equal(f.uploads.length, 0)
})

test('a confirmed text-only model cannot download or save candidates for fake visual review', async t => {
  const f = setup(t)
  f.settings.private = () => ({ model: { name: 'cn:deepseek-v4-pro' }, images: { downloadDirectory: f.folder } })
  await assert.rejects(prepare(f), error => error.code === 'MODEL_IMAGE_UNSUPPORTED')
  assert.equal(f.downloads, 0)
  assert.equal(f.reviews, 0)
  assert.equal(fs.existsSync(f.folder), false)
})

test('only a reviewed image is written locally, and no WeChat upload occurs during preparation', async t => {
  const f = setup(t)
  const result = await prepare(f)
  const saved = await f.service.file('a', result.id)
  assert.equal(saved.bytes.equals(png), true)
  assert.ok(saved.filename.startsWith(f.folder))
  assert.equal(f.uploads.length, 0)
  assert.equal(f.reviews, 1)
  assert.equal(result.markdown.includes('oa-image:' + result.id), true)
  assert.throws(() => f.service.resolve('b', 'oa-image:' + result.id), /不属于|未通过/)
})

test('two approved candidates with identical pixels commit a single complete cache file', async t => {
  const pendingReviews = []
  const f = setup(t, { reviewer: () => new Promise(resolve => pendingReviews.push(resolve)) })
  const [one] = await f.service.search('a', { query: 'first icon' })
  const [two] = await f.service.search('a', { query: 'second icon' })
  const completed = Promise.all([one, two].map(item => f.service.prepare('a', { id: item.id, topic: 'icons' })))
  await new Promise(resolve => setImmediate(resolve))
  const calls = pendingReviews.length
  for (const resolve of pendingReviews) resolve(approved())
  const results = await completed
  assert.equal(calls, 2)
  const first = await f.service.file('a', results[0].id)
  const second = await f.service.file('a', results[1].id)
  assert.equal(first.filename, second.filename)
  assert.equal(fs.readdirSync(path.dirname(first.filename)).filter(name => name.endsWith('.tmp')).length, 0)
})

test('image review receives author identity rules and only this account\'s relevant memories', async t => {
  let received
  const f = setup(t, { reviewer: async (_settings, _image, _topic, _source, options) => { received = options; return approved() } })
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), bot: { instructions: '保留作者署名水印，不因品牌标识拒绝配图。', memoryEnabled: true } })
  f.store.put('bot_memories', 'a', { id: 'own-image-preference', title: '作者选图偏好', content: '办公桌配图可以带来源水印。',
    pinned: true, updatedAt: Date.now() })
  f.store.put('bot_memories', 'b', { id: 'other-image-preference', title: 'Other account', content: 'OTHER_ACCOUNT_PRIVATE_POLICY',
    pinned: true, updatedAt: Date.now() })
  await prepare(f, { text: '请联网给文章配图，按我的选图要求处理。' })
  assert.match(received.authorInstructions, /保留作者署名水印/)
  assert.match(received.authorMemories, /可以带来源水印/)
  assert.doesNotMatch(received.authorMemories, /OTHER_ACCOUNT_PRIVATE_POLICY/)
  assert.match(received.authorRequest, /按我的选图要求/)
})

test('disabled long-term memory does not influence visual review', async t => {
  let received
  const f = setup(t, { reviewer: async (_settings, _image, _topic, _source, options) => { received = options; return approved() } })
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), bot: { instructions: '作者自定义规则。', memoryEnabled: false } })
  f.store.put('bot_memories', 'a', { id: 'disabled-image-memory', title: 'Preference', content: 'Do not use watermarks', pinned: true })
  await prepare(f)
  assert.equal(received.authorMemories, '')
  assert.equal(received.authorInstructions, '作者自定义规则。')
})

test('cached approval cannot be reused after author rules have changed', async t => {
  const f = setup(t)
  const image = await prepare(f)
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), bot: { instructions: '作者现在要求不同的选图风格。' } })
  await assert.rejects(f.service.prepare('a', { id: image.id, topic: 'application icons' }), /作者规则或相关记忆已变化/)
  assert.equal(f.reviews, 1)
})

test('rejected, uncertain and unsupported visual reviews never create the download directory', async t => {
  for (const reviewer of [async () => ({ ...approved(), approved: false, decision: 'uncertain' }),
    async () => { throw new Error('Current model does not support images') }]) {
    const f = setup(t, { reviewer })
    await assert.rejects(prepare(f))
    assert.equal(fs.existsSync(f.folder), false)
    assert.equal(f.service.list('a').length, 0)
    assert.equal(f.uploads.length, 0)
  }
})

test('cancelled reviews cannot save an image even when a provider returns afterwards', async t => {
  let finish
  const f = setup(t, { reviewer: () => new Promise(resolve => { finish = resolve }) })
  const controller = new AbortController()
  const pending = prepare(f, { signal: controller.signal })
  for (let index = 0; index < 10; index++) await Promise.resolve()
  controller.abort(new Error('Stopped'))
  finish(approved())
  await assert.rejects(pending, /Stopped/)
  assert.equal(fs.existsSync(f.folder), false)
})

test('identical concurrent prepare requests share one review and one local file', async t => {
  const f = setup(t)
  const [candidate] = await f.service.search('a', { query: 'icon' })
  const first = f.service.prepare('a', { id: candidate.id, topic: 'application icons' })
  const second = f.service.prepare('a', { id: candidate.id, topic: 'application icons' })
  assert.equal(first, second)
  const [one, two] = await Promise.all([first, second])
  assert.equal(one.id, two.id)
  assert.equal(f.reviews, 1)
  assert.equal(f.downloads, 1)
})

test('local modifications are rejected before any image upload', async t => {
  const f = setup(t)
  const asset = await prepare(f)
  const file = await f.service.file('a', asset.id)
  fs.appendFileSync(file.filename, 'changed')
  const html = await renderArticle(`Text\n\n${asset.markdown}`, [], { resolveImage: ref => f.service.resolve('a', ref) })
  await assert.rejects(f.service.forWeChat('a', html, f.service.cover('a', asset.id)), /修改|一致/)
  assert.equal(f.uploads.length, 0)
})

test('article rendering accepts reviewed IDs without imposing attribution or license captions', async t => {
  const f = setup(t)
  const asset = await prepare(f)
  const resolver = ref => f.service.resolve('a', ref)
  const html = await renderArticle(`Intro\n\n![Caption](oa-image:${asset.id})`, [], { resolveImage: resolver })
  assert.deepEqual(references(html), [asset.id])
  assert.doesNotMatch(html, /example\.com\/photo|Photographer|原始来源|许可|授权/)
  assert.match(html, /alt="Caption"/)
  await assert.rejects(renderArticle('![Bad](https://unreviewed.example.com/photo.jpg)', [], { resolveImage: resolver }), /审核/)
  await assert.rejects(styleArticleHtml('<p>Intro</p><img src="http://127.0.0.1/secret">', { resolveImage: resolver }), /审核/)
  const pasted = await styleArticleHtml(html, { resolveImage: resolver })
  assert.doesNotMatch(pasted, /原始来源|授权|许可/)
  assert.deepEqual(references(pasted), [asset.id])
  const authored = await renderArticle(`${asset.markdown}\n\n图片署名：[作者自选署名](https://example.com/photo)`, [], { resolveImage: resolver })
  assert.match(authored, /作者自选署名/)
  assert.match(authored, /https:\/\/example.com\/photo/)
  const withCaption = html.replace('</span>', '<span>作者在图片容器内自写的图注。</span></span>')
  const restyled = await styleArticleHtml(withCaption, { resolveImage: resolver })
  assert.match(restyled, /作者在图片容器内自写的图注/)
  assert.deepEqual(references(restyled), [asset.id])
})

test('existing WeChat images are preserved only when read from the selected draft', async t => {
  const f = setup(t)
  const old = 'https://mmbiz.qpic.cn/old.png'
  const known = existingImages(`<p><img src="${old}"></p>`)
  const html = await renderArticle(`Existing\n\n![Old](${old})`, [], {
    resolveImage: ref => f.service.resolve('a', ref, known),
  })
  assert.match(html, /old\.png/)
  assert.deepEqual(references(html), [])
  await assert.rejects(renderArticle('![Other](https://mmbiz.qpic.cn/other.png)', [], {
    resolveImage: ref => f.service.resolve('a', ref, known),
  }))
})

test('uploads are reused within an article and local references never enter the saved WeChat body', async t => {
  const f = setup(t)
  const asset = await prepare(f)
  const html = await renderArticle(`${asset.markdown}\n\nBody\n\n${asset.markdown}`, [], {
    resolveImage: ref => f.service.resolve('a', ref),
  })
  const result = await f.service.forWeChat('a', html, f.service.cover('a', asset.id))
  assert.equal(f.uploads.length, 1)
  assert.equal(result.cover.url, 'https://mmbiz.qpic.cn/uploaded.png')
  assert.equal(result.html.includes('mp-ops:'), false)
  assert.equal(result.html.includes('data-oa-image-id'), false)
  assert.match(result.html, /https:\/\/mmbiz.qpic.cn\/uploaded.png/)
  await f.service.forWeChat('a', html)
  assert.equal(f.uploads.length, 1)
})

test('files and strict structured verdicts are checked independently from the model', () => {
  assert.ok(inspectRaster(png, 'image/png').width > 0)
  assert.throws(() => inspectRaster(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml'))
  assert.throws(() => inspectRaster(png, 'text/html'), /不一致/)
  assert.throws(() => validateReview({ approved: true }), /明确/)
  assert.equal(validateReview({ ...approved(), decision: 'uncertain' }).approved, false)
  assert.equal(validateReview({ ...approved(), risks: ['personal_data'] }).approved, false)
  assert.throws(() => normalizeImages({ downloadDirectory: '../outside' }), /本机/)
  assert.throws(() => normalizeImages({ downloadDirectory: '\\\\server\\share' }), /本机/)
})

test('a Bot tool round trip needs only operation confirmation, not image-rights acknowledgement, before upload and save', async t => {
  const f = setup(t)
  let calls = 0
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.match(body.messages[0].content, /不能.*断言不能联网/)
    assert.doesNotMatch(body.messages[0].content, /核实.*使用授权|审核通过不代表取得版权许可|附实际来源链接/)
    assert.match(body.messages[0].content, /回复和确认卡说明也遵守此约定/)
    assert.match(body.messages[0].content, /历史中的默认标签和额外勾选已废除/)
    assert.match(body.messages[0].content, /没有明确的作者限制时，不擅自添加选图禁令/)
    calls += 1
    const outputs = body.messages.filter(message => message.role === 'tool')
    const returned = outputs.length ? JSON.parse(outputs.at(-1).content) : null
    assert.deepEqual(body.tools.map(item => item.function.name), ['read_workspace', 'propose_action', 'memory'])
    const kinds = body.tools[0].function.parameters.properties.kind.enum
    assert.ok(kinds.includes('image_search') && kinds.includes('image_prepare') && kinds.includes('article_context'))
    const tool = calls === 1 ? { name: 'read_workspace', args: { kind: 'image_search', query: 'application icon', limit: 1 } }
      : calls === 2 ? { name: 'read_workspace', args: { kind: 'image_prepare', imageId: returned[0].id, topic: 'application icons' } }
        : { name: 'propose_action', args: { action: 'draft.create', title: 'Create image article', detail: 'Reviewed image article',
          payload: JSON.stringify({ title: 'An article with an image', digest: 'Summary', markdown: `## Article\n\nAn introduction.\n\n${returned.markdown}\n\nA conclusion.` }) } }
    modelResponse(response, { role: 'assistant', content: null, tool_calls: [{ id: 'call-' + calls, type: 'function',
      function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), model: { name: 'test-current', apiKey: 'test-secret',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 128000 } })
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service,
    notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => { throw new Error('Unexpected write') } })
  const result = await f.chat.send('a', { text: 'Write an article with a reviewed image.' })
  const card = result.messages.find(message => message.role === 'card')
  assert.equal(card.card.state, 'open')
  assert.equal(card.card.payload.images.length, 1)
  assert.ok(card.card.payload.cover.assetId)
  assert.equal(f.uploads.length, 0)
  assert.equal(f.drafts.length, 0)
  assert.equal(card.card.payload.images[0].licenseVerified, undefined)
  assert.equal(card.card.payload.images[0].license, undefined)
  await f.chat.confirm('a', card.id)
  assert.equal(f.uploads.length, 1)
  assert.equal(f.drafts.length, 1)
  assert.equal(f.drafts[0].value.html.includes('mp-ops:'), false)
  assert.match(f.drafts[0].value.html, /uploaded\.png/)
  await assert.rejects(f.chat.confirm('a', card.id), /处理过/)
  assert.equal(f.drafts.length, 1)
})

test('confirmed draft edits do not require an image-rights field and still validate the image before uploading', async t => {
  const f = setup(t)
  const asset = await prepare(f)
  const original = { id: 'draft-1', title: 'Original', html: '<p>Original body</p>', cover: { url: 'https://mmbiz.qpic.cn/old-cover.png' } }
  f.mp.getDraft = async () => original
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service,
    notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  const html = await renderArticle(`Original body\n\n${asset.markdown}`, [], { resolveImage: ref => f.service.resolve('a', ref) })
  const message = f.store.message('a', { role: 'card', card: { state: 'open', action: 'draft.update',
    payload: { id: original.id, html, expectedVersion: draftVersion(original) } } })
  assert.equal(f.uploads.length, 0)
  await f.chat.confirm('a', message.id)
  assert.equal(f.uploads.length, 1)
  assert.equal(f.drafts.length, 1)
  assert.deepEqual(f.drafts[0].value.cover, original.cover)
  assert.match(f.drafts[0].value.html, /uploaded\.png/)
})

test('explicitly authorized scheduled image drafts are saved without a licensing gate or acknowledgement field', async t => {
  const f = setup(t)
  const asset = await prepare(f)
  let calls = 0
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    calls += 1
    if (calls > 1) return modelResponse(response, { role: 'assistant', content: '已保存新草稿。' })
    modelResponse(response, { role: 'assistant', content: null, tool_calls: [{ id: 'scheduled-image', type: 'function',
      function: { name: 'propose_action', arguments: JSON.stringify({ action: 'draft.create', title: 'Image article', detail: 'Prepared article',
        payload: JSON.stringify({ title: 'Application icons', markdown: `## Article\n\nApplication icons.\n\n${asset.markdown}` }) }) } }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), model: { name: 'test-current', apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1` } })
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service,
    notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  const result = await f.chat.sendScheduled('a', { text: '写一篇文章并存入草稿', taskId: 'task-1', taskName: 'Write', runId: 'run-1' })
  const card = result.messages.find(message => message.card?.action === 'draft.create')
  assert.equal(card.card.state, 'done')
  assert.equal(card.card.automaticallyConfirmed, true)
  assert.equal(card.card.payload.images.length, 1)
  assert.equal(card.card.payload.images[0].licenseVerified, undefined)
  assert.equal(f.uploads.length, 1)
  assert.equal(f.drafts.length, 1)
})

test('a cancelled article remains available to a short image follow-up through the existing workspace tool', async t => {
  const f = setup(t)
  let calls = 0
  let original
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.deepEqual(body.tools.map(item => item.function.name), ['read_workspace', 'propose_action', 'memory'])
    calls += 1
    const outputs = body.messages.filter(item => item.role === 'tool')
    const returned = outputs.length ? JSON.parse(outputs.at(-1).content) : null
    if (calls === 2) {
      original = returned
      assert.equal(original.title, '人工智能伦理')
      assert.equal(original.state, 'cancelled')
      assert.match(original.html, /作者原文标记 E2739/)
      assert.equal(original.draftId, null)
    }
    const tool = calls === 1 ? { name: 'read_workspace', args: { kind: 'article_context' } }
      : calls === 2 ? { name: 'read_workspace', args: { kind: 'image_search', query: '人工智能伦理', limit: 1 } }
        : calls === 3 ? { name: 'read_workspace', args: { kind: 'image_prepare', imageId: returned[0].id, topic: '人工智能伦理' } }
          : { name: 'propose_action', args: { action: 'draft.create', title: '给原文章配图', detail: '保留原文并加入已审核图片',
            payload: JSON.stringify({ title: original.title, markdown: `## 偏见与责任\n\n作者原文标记 E2739，保留原有论述。\n\n${returned.markdown}` }) } }
    modelResponse(response, { role: 'assistant', content: null, tool_calls: [{ id: 'followup-' + calls, type: 'function',
      function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const previous = f.settings.private
  f.settings.private = () => ({ ...previous(), model: { name: 'test-current', apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1` } })
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service,
    notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  const sessionId = f.chat.snapshot('a').session.id
  f.store.message('a', { role: 'card', sessionId, card: { action: 'draft.create', state: 'cancelled',
    payload: { title: '早期文章', html: '<p>不应选择早期文章。</p>' } } })
  const cancelled = f.store.message('a', { role: 'card', sessionId, card: { action: 'draft.create', state: 'cancelled',
    payload: { title: '人工智能伦理', html: '<h2>偏见与责任</h2><p>作者原文标记 E2739，保留原有论述。</p>' } } })
  f.store.message('b', { role: 'card', sessionId, card: { action: 'draft.create', state: 'cancelled',
    payload: { title: '其他账号私有文章', html: '<p>OTHER_ACCOUNT_SECRET</p>' } } })
  const result = await f.chat.send('a', { text: '自行配图' })
  const proposal = result.messages.find(message => message.card?.action === 'draft.create')
  assert.ok(proposal)
  assert.equal(proposal.card.payload.title, '人工智能伦理')
  assert.equal(proposal.card.payload.images.length, 1)
  assert.match(proposal.card.payload.html, /作者原文标记 E2739/)
  assert.doesNotMatch(proposal.card.payload.html, /OTHER_ACCOUNT_SECRET/)
  assert.equal(f.store.get('messages', 'a', cancelled.id).card.state, 'cancelled')
  assert.equal(f.uploads.length, 0)
  assert.equal(f.drafts.length, 0)
})

test('a short image follow-up does not impose a hidden numeric quota on proposals', async t => {
  const f = setup(t)
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    modelResponse(response, { role: 'assistant', content: null, tool_calls: [{ id: 'missing-followup-image', type: 'function',
      function: { name: 'propose_action', arguments: JSON.stringify({ action: 'draft.create', title: 'Wrong plain draft', detail: 'No images',
        payload: JSON.stringify({ title: '人工智能伦理', markdown: '## 原文\n\n原有文章内容。' }) }) } }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  f.settings.private = () => ({ model: { name: 'test-current', apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, images: { downloadDirectory: f.folder },
    bot: { maxSteps: 1, memoryEnabled: false } })
  f.chat = createChat({ store: f.store, settings: f.settings, mp: f.mp, images: f.service,
    notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  const result = await f.chat.send('a', { text: '自行配图' })
  assert.equal(result.messages.some(message => message.role === 'card'), true)
  assert.equal(result.messages.flatMap(message => message.activity || []).some(step => step.state === 'error'), false)
  assert.equal(f.uploads.length, 0)
})

test('historical image-review attempts never create an application quota or require clearing history', async t => {
  const f = setup(t)
  const historical = { id: 'img_00000000-0000-0000-0000-000000000040',
    state: 'rejected', reviewAttempts: Array(200).fill(Date.now()), createdAt: Date.now() }
  f.store.put('images', 'a', historical)
  for (let i = 0; i < 50; i += 1) f.store.put('images', 'a', {
    id: `img_${String(i).padStart(8, '0')}-0000-0000-0000-000000000001`,
    state: 'rejected', reviewedAt: Date.now(), createdAt: Date.now(),
  })
  let calls = 0
  const image = await prepare(f, { beforeModelCall: () => { calls += 1 } })
  assert.equal(f.reviews, 1)
  assert.equal(f.downloads, 1)
  assert.equal(calls, 1)
  assert.ok((await f.service.file('a', image.id)).bytes.equals(png))
  assert.deepEqual(f.store.get('images', 'a', historical.id), { ...historical, accountId: 'a' })
})

test('image search has no application per-minute quota and reviews continue beyond the former daily ceiling', async t => {
  let calls = 0, reviews = 0
  const f = setup(t, { reviewer: async (settings, image, topic, metadata, context) => {
    assert.equal(settings.private().model.name, 'test-current')
    assert.ok(image.bytes.equals(png))
    context.beforeModelCall?.()
    reviews += 1
    return approved()
  } })
  for (let index = 0; index < 45; index += 1) {
    const image = await prepare(f, { beforeModelCall: () => { calls += 1 } })
    assert.ok((await f.service.file('a', image.id)).bytes.equals(png))
  }
  assert.equal(reviews, 45)
  assert.equal(calls, 45)
  assert.equal(f.downloads, 45)
  assert.equal(f.uploads.length, 0)
  assert.equal(f.store.list('images', 'a').filter(item => item.state === 'approved').length, 45)
})
