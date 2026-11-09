// 验证真实持久化边界、加密设置、内容排版和模型确认卡在确认之前不会写入。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { createOpsStore } = require('./store.cjs')
const { createSettingsStore } = require('./settings.cjs')
const { modelResponse } = require('../../tests/helpers/model-response.cjs')
const { createChat, draftVersion } = require('./chat.cjs')
const { articleFromHtml, renderArticle, publicUrl, privateAddress } = require('./content.cjs')
const { normalizeTask, normalizeCover, publicationTime } = require('./tasks.cjs')

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'mp-ops-'))
  return path
}

test('workspace isolation and dedup survive database reopening without affecting account schema', (t) => {
  const temp = directory(t)
  const path = join(temp, 'ops.sqlite')
  let store = createOpsStore(path)
  store.put('tasks', 'a', { id: 't1', name: 'A' })
  assert.throws(() => store.put('tasks', 'b', { id: 't1', name: 'B' }), /不属于/)
  assert.equal(store.get('tasks', 'b', 't1'), null)
  const items = store.freshItems('a', [{ title: 'First news', url: 'https://example.com/a', content: 'article' }])
  store.recordItems('a', items, 'r1', true)
  assert.equal(store.claimSlot('t1', 1000), true)
  store.close()
  store = createOpsStore(path)
  t.after(() => { store.close(); rmSync(temp, { recursive: true, force: true }) })
  assert.equal(store.get('tasks', 'a', 't1').name, 'A')
  assert.equal(store.claimSlot('t1', 1000), false)
  assert.equal(store.freshItems('a', [{ title: 'First news', url: 'https://example.com/b' }]).length, 0)
  assert.equal(store.freshItems('b', [{ title: 'First news', url: 'https://example.com/a' }]).length, 1)
})

test('settings redact credentials and preserve them on blank saves', (t) => {
  const temp = directory(t)
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const filename = join(temp, 'settings.json')
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(text).map((byte) => byte ^ 123),
    decryptString: (buffer) => Buffer.from(buffer).map((byte) => byte ^ 123).toString(),
  }
  const store = createSettingsStore(filename, encryption)
  assert.equal(store.get().model.apiFormat, 'chat-completions')
  store.save({ model: { name: 'model', apiKey: 'secret-model-key', apiFormat: 'responses' } })
  store.save({ model: { apiKey: '' } })
  assert.deepEqual(Object.keys(store.get()).sort(), ['bot', 'images', 'model', 'search'])
  assert.equal(store.private().model.apiKey, 'secret-model-key')
  assert.equal(store.get().model.apiKey, undefined)
  assert.equal(readFileSync(filename, 'utf8').includes('secret-model-key'), false)
  const reopened = createSettingsStore(filename, encryption)
  assert.equal(reopened.get().model.apiFormat, 'responses')
  assert.equal(reopened.private().model.apiKey, 'secret-model-key')
  reopened.save({ model: { clearApiKey: true } })
  assert.equal(reopened.get().model.apiKeyConfigured, false)
  assert.throws(() => reopened.save({ model: { apiFormat: 'unsupported' } }), /API/)

  const legacy = JSON.parse(readFileSync(filename, 'utf8'))
  Object.assign(legacy.model, { provider: 'deepseek', maxOutputTokens: 8192, compactAt: 75,
    reasoningEffort: 'default', contextWindow: 64000 })
  writeFileSync(filename, JSON.stringify(legacy))
  const migrated = createSettingsStore(filename, encryption).private().model
  assert.equal(migrated.provider, undefined)
  assert.equal(migrated.maxOutputTokens, undefined)
  assert.equal(migrated.reasoningEffort, '')
  assert.equal(migrated.contextWindow, 64000)
})

test('legacy QQ settings are discarded without decrypting their token or losing model and Bot settings', (t) => {
  const temp = directory(t)
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const filename = join(temp, 'settings.json')
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(text).map(byte => byte ^ 123),
    decryptString: (buffer) => {
      assert.notEqual(buffer.toString(), 'retired-token')
      return Buffer.from(buffer).map(byte => byte ^ 123).toString()
    },
  }
  const original = createSettingsStore(filename, encryption)
  original.save({ model: { name: 'existing-model', apiKey: 'existing-secret', apiFormat: 'responses' },
    bot: { name: 'Existing Bot', instructions: 'Prefer concise writing.', autoRemember: false } })
  const before = original.private()
  const legacy = JSON.parse(readFileSync(filename, 'utf8'))
  legacy.qq = { enabled: true, managed: true, ownerQQ: '123456', address: 'http://127.0.0.1:17890',
    encryptedToken: Buffer.from('retired-token').toString('base64') }
  writeFileSync(filename, JSON.stringify(legacy))

  const upgraded = createSettingsStore(filename, encryption)
  assert.deepEqual(upgraded.private(), before)
  assert.deepEqual(Object.keys(upgraded.get()).sort(), ['bot', 'images', 'model', 'search'])
  assert.equal(upgraded.get().model.apiKey, undefined)
  assert.equal(upgraded.get().model.apiKeyConfigured, true)
  const saved = upgraded.save({ model: { apiKey: '' }, qq: { enabled: true, token: 'obsolete' } })
  assert.deepEqual(Object.keys(saved).sort(), ['bot', 'images', 'model', 'search'])
  const persisted = JSON.parse(readFileSync(filename, 'utf8'))
  assert.equal(Object.hasOwn(persisted, 'qq'), false)
  assert.equal(persisted.model.apiKey, undefined)
  assert.equal(readFileSync(filename, 'utf8').includes('existing-secret'), false)
  assert.deepEqual(createSettingsStore(filename, encryption).private(), before)
})

test('article extraction and Markdown rendering retain readable facts while excluding executable HTML', async () => {
  const content = 'This article explains a real development and provides enough details for a reader. '.repeat(12)
  const article = await articleFromHtml(`<html><head><title>News</title></head><body>
    <article><h1>News</h1><p>${content}</p></article></body></html>`, 'https://example.com/news')
  assert.match(article.content, /real development/)
  const html = await renderArticle('# Title\n\n<script>alert(1)</script>\n\n正文事实', [
    { url: 'https://example.com/news' },
  ])
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /style=/)
  assert.doesNotMatch(html, /资料来源|https:\/\/example.com\/news/)
  const authored = await renderArticle('正文事实\n\n[作者选择的来源](https://example.com/news)')
  assert.match(authored, /https:\/\/example.com\/news/)
  assert.throws(() => publicUrl('file:///secret'), /公开/)
  assert.equal(privateAddress('127.0.0.1'), true)
  assert.equal(privateAddress('::1'), true)
  assert.equal(privateAddress('8.8.8.8'), false)
})

test('model tool calls create pending cards and cannot mutate until confirmed once', { timeout: 10000 }, async (t) => {
  const temp = directory(t)
  const store = createOpsStore(join(temp, 'ops.sqlite'))
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    assert.equal(JSON.parse(body).tools.length, 3)
    modelResponse(res, {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call1', type: 'function', function: {
        name: 'propose_action', arguments: JSON.stringify({
          action: 'task.toggle', title: '暂停任务', detail: '暂停已选择的任务',
          payload: JSON.stringify({ id: 't1', enabled: false }),
        }),
      } }],
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let writes = 0
  const chat = createChat({
    store, settings: { private: () => ({ model: {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, name: 'test', apiKey: 'test-local-key',
    } }) },
    mp: {}, notify: () => {}, getAccount: () => ({ name: 'Account' }),
    act: async () => { writes += 1; return { saved: true } },
  })
  t.after(async () => {
    server.closeAllConnections()
    server.close()
    await chat.close()
    store.close()
    rmSync(temp, { recursive: true, force: true })
  })
  const result = await chat.send('a', { text: '暂停任务' })
  const card = result.messages.find((item) => item.role === 'card')
  assert.equal(card.card.state, 'open')
  assert.equal(writes, 0)
  await assert.rejects(chat.confirm('b', card.id), /不存在/)
  await chat.confirm('a', card.id)
  assert.equal(writes, 1)
  await assert.rejects(chat.confirm('a', card.id), /处理过/)
  assert.equal(writes, 1)
})

test('task schedule preserves requested next-day publication and rejects missing sources', () => {
  const task = normalizeTask({
    name: 'Daily', topic: 'News', style: '', sourceIds: ['s1'], mode: 'draft_notify',
    schedule: { repeat: 'daily', prepareAt: '23:00', publishAt: '08:00' },
  }, null, 'a', [{ id: 's1' }])
  const started = new Date(2026, 0, 1, 23, 0).getTime()
  assert.equal(new Date(publicationTime(task, started)).getDate(), 2)
  assert.equal(new Date(publicationTime(task, started)).getHours(), 8)
  assert.throws(() => normalizeTask({ ...task, sourceIds: ['missing'] }, null, 'a', []), /来源不存在/)
})

test('chosen task cover survives edits and persistence without retaining arbitrary fields', (t) => {
  const temp = directory(t)
  const path = join(temp, 'ops.sqlite')
  let store = createOpsStore(path)
  const task = normalizeTask({
    name: 'Daily', topic: 'News', sourceIds: ['s1'], mode: 'draft_only',
    schedule: { repeat: 'daily', prepareAt: '08:00', publishAt: '09:00' },
    cover: { url: 'https://mmbiz.qpic.cn/image', mediaId: 'web-image-123', fileId: '100000066', cookie: 'unwanted' },
  }, null, 'a', [{ id: 's1' }])
  store.put('tasks', 'a', task)
  store.close()
  store = createOpsStore(path)
  t.after(() => { store.close(); rmSync(temp, { recursive: true, force: true }) })
  const restored = store.get('tasks', 'a', task.id)
  assert.deepEqual(restored.cover, { url: 'https://mmbiz.qpic.cn/image', mediaId: 'web-image-123', fileId: '100000066' })
  const edited = normalizeTask({ name: 'Renamed' }, restored, 'a', [{ id: 's1' }])
  assert.deepEqual(edited.cover, restored.cover)
  assert.equal(normalizeTask({ cover: null }, restored, 'a', [{ id: 's1' }]).cover, null)
  assert.throws(() => normalizeCover({ url: 'file:///secret' }), /公开/)
  assert.throws(() => normalizeCover({ label: 'fake-cover' }), /请选择/)
})

test('title-only confirmation rereads full draft, preserves metadata and rejects changed body', async (t) => {
  const temp = directory(t)
  const store = createOpsStore(join(temp, 'ops.sqlite'))
  const original = {
    id: 'd1', title: 'Before', digest: 'Summary', html: '<p>Full original body</p>',
    cover: { url: 'https://mmbiz.qpic.cn/cover', mediaId: 'web-media' }, metadata: { preserved: true },
  }
  let latest = structuredClone(original)
  let written = null
  let reads = 0
  const chat = createChat({
    store, settings: {}, notify: () => {}, getAccount: () => ({ name: 'Account' }), act: async () => {},
    mp: {
      getDraft: async () => { reads += 1; return structuredClone(latest) },
      listDrafts: async () => { throw new Error('Must read full draft') },
      saveDraft: async (_id, draft) => { written = draft; return draft },
    },
  })
  t.after(async () => {
    await chat.close()
    store.close()
    rmSync(temp, { recursive: true, force: true })
  })
  const card = () => store.message('a', { role: 'card', card: {
    type: 'action', action: 'draft.update', state: 'open',
    payload: { id: 'd1', title: 'After', expectedVersion: draftVersion(original) },
  } })
  await chat.confirm('a', card().id)
  assert.equal(reads, 1)
  assert.deepEqual(written, { ...original, title: 'After' })
  latest.html = '<p>Edited in WeChat after proposal</p>'
  await assert.rejects(chat.confirm('a', card().id), /已被修改/)
  assert.equal(reads, 2)
  assert.equal(written.html, original.html)
})
