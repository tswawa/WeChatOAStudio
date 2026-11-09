// 验证闹钟真实计时触发、重启防重、多星期与受控模型下的自动草稿/敏感操作确认边界。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { createOpsStore } = require('./store.cjs')
const { createChat, allowsScheduledDraft } = require('./chat.cjs')
const { createAlarmScheduler } = require('./alarms.cjs')
const { normalizeTask, normalizeShortcut, latestAssistantSlot } = require('./tasks.cjs')
const { modelResponse } = require('../../tests/helpers/model-response.cjs')

async function waitFor(predicate, timeout = 6000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for alarm')
}

function task(id, content) {
  const now = new Date()
  return {
    id, accountId: 'a', type: 'assistant', name: 'Test alarm', content, enabled: true,
    createdAt: Date.now() - 120000, updatedAt: Date.now() - 120000,
    schedule: { time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      repeat: 'daily', weekdays: [] },
  }
}

test('real timer sends saved text to model once and restart does not replay the claimed slot', { timeout: 10000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mp-alarm-'))
  const dbPath = join(directory, 'ops.sqlite')
  let store = createOpsStore(dbPath)
  let requests = 0
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    assert.equal(body.messages.at(-1).content, '查看当前运营任务')
    requests += 1
    modelResponse(res, { role: 'assistant', content: '已读取当前任务。' })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const settings = { private: () => ({ model: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test', name: 'test',
  } }) }
  const getAccount = () => ({ name: 'Test' })
  let chat = createChat({ store, settings, mp: {}, notify: () => {}, getAccount, act: async () => {} })
  let alarms = createAlarmScheduler({ store, chat, notify: () => {}, getAccount })
  t.after(async () => {
    await alarms.close()
    await chat.close()
    store.close()
    server.closeAllConnections()
    server.close()
    rmSync(directory, { recursive: true, force: true })
  })
  await new Promise((resolve) => setImmediate(resolve))
  store.put('tasks', 'a', task('t1', '查看当前运营任务'))
  const open = chat.snapshot('a').session.id
  await waitFor(() => store.list('runs', 'a')[0]?.status === 'succeeded')
  assert.equal(requests, 1)
  const scheduled = chat.snapshot('a').sessions.find((item) => item.kind === 'schedule')
  assert.ok(scheduled, 'scheduled runs use a dedicated session')
  assert.equal(chat.snapshot('a').session.id, open, 'the open conversation stays selected')
  assert.equal(chat.messages('a', open).length, 0, 'nothing is inserted into the open conversation')
  assert.ok(chat.messages('a', scheduled.id).some((item) => item.role === 'card' && item.card.type === 'run'))
  assert.ok(chat.messages('a', scheduled.id).some((item) => item.role === 'user' && item.channel === 'schedule'))
  assert.equal(store.list('messages', 'a').filter((message) => message.role === 'user')[0].text, '查看当前运营任务')
  await alarms.close()
  await chat.close()
  store.close()
  store = createOpsStore(dbPath)
  chat = createChat({ store, settings, mp: {}, notify: () => {}, getAccount, act: async () => {} })
  alarms = createAlarmScheduler({ store, chat, notify: () => {}, getAccount })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.equal(requests, 1)
  assert.equal(store.list('runs', 'a').length, 1)
})

test('weekly selection catches latest missed slot once and marks old slots expired without replay history', () => {
  const value = normalizeTask({
    type: 'assistant', name: 'Weekly', content: '查看数据',
    schedule: { time: '08:00', repeat: 'weekly', weekdays: [1, 3, 5, 3] },
  }, null, 'a', [])
  assert.deepEqual(value.schedule.weekdays, [1, 3, 5])
  value.createdAt = value.updatedAt = new Date(2026, 0, 1).getTime()
  const recent = latestAssistantSlot(value, new Date(2026, 0, 5, 10, 30).getTime())
  assert.equal(new Date(recent.slot).getHours(), 8)
  assert.equal(recent.expired, false)
  const old = latestAssistantSlot(value, new Date(2026, 0, 6, 10, 30).getTime())
  assert.equal(new Date(old.slot).getDate(), 5)
  assert.equal(old.expired, true)
  assert.throws(() => normalizeTask({ ...value, schedule: { ...value.schedule, weekdays: [] } }, null, 'a', []), /星期/)
  assert.throws(() => normalizeTask({ ...value, schedule: { ...value.schedule, weekdays: [8] } }, null, 'a', []), /星期/)
})

test('saved draft instruction can auto-create only new drafts, never publication', { timeout: 10000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mp-alarm-tools-'))
  const store = createOpsStore(join(directory, 'ops.sqlite'))
  let writes = 0
  let publishes = 0
  let calls = 0
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    calls += 1
    const action = calls === 1 ? 'draft.create' : 'draft.publish'
    const payload = calls === 1
      ? { title: 'New draft', digest: 'Summary', markdown: '# Text\n\nA new article.', cover: { url: 'https://mmbiz.qpic.cn/image' } }
      : { id: 'd1', mode: 'api', massNotify: true }
    modelResponse(res, { role: 'assistant', content: null, tool_calls: [{
      id: `call-${calls}`, type: 'function', function: { name: 'propose_action', arguments: JSON.stringify({
        action, title: action, detail: action, payload: JSON.stringify(payload),
      }) },
    }] })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const chat = createChat({
    store, settings: { private: () => ({ model: {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, name: 'test', apiKey: 'local-test',
    } }) }, notify: () => {}, getAccount: () => ({ name: 'Test' }), act: async () => {},
    mp: {
      saveDraft: async () => { writes += 1; return { id: 'd1' } },
      getDraft: async () => ({ id: 'd1', title: 'Draft', html: '<p>Full text</p>' }),
      publishOfficial: async () => { publishes += 1; return { status: 'submitted' } },
    },
  })
  t.after(async () => {
    await chat.close()
    server.closeAllConnections()
    server.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const result = await chat.sendScheduled('a', { text: '写一篇文章并存入草稿', taskId: 't1', taskName: 'Write', runId: 'r1' })
  assert.equal(writes, 1)
  assert.equal(publishes, 0)
  assert.equal(result.messages.filter((item) => item.card?.state === 'open').length, 1)
  assert.equal(allowsScheduledDraft('只查看数据，不要写草稿'), false)
})

test('shortcut content persists per account and missing model produces failed run with user text', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mp-alarm-missing-'))
  const store = createOpsStore(join(directory, 'ops.sqlite'))
  const shortcut = normalizeShortcut({ name: 'Check', content: '查看昨日数据' }, null, 'a')
  store.put('shortcuts', 'a', shortcut)
  assert.equal(store.list('shortcuts', 'a')[0].content, '查看昨日数据')
  assert.deepEqual(store.list('shortcuts', 'b'), [])
  const chat = createChat({ store, settings: { private: () => ({ model: {} }) }, mp: {},
    notify: () => {}, getAccount: () => ({ name: 'Test' }), act: async () => {} })
  const alarms = createAlarmScheduler({ store, chat, notify: () => {}, getAccount: () => ({ name: 'Test' }) })
  t.after(async () => {
    await alarms.close()
    await chat.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const run = alarms.start('a', task('t2', '查看昨日数据'))
  await waitFor(() => store.get('runs', 'a', run.id)?.status === 'failed')
  assert.match(store.get('runs', 'a', run.id).error, /模型名称和 API Key/)
  assert.equal(store.list('messages', 'a').some((message) => message.role === 'user' && message.text === '查看昨日数据'), true)
})

test('a running scheduled task does not block switching the open conversation and cannot be deleted mid-run', { timeout: 10000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mp-alarm-session-'))
  const store = createOpsStore(join(directory, 'ops.sqlite'))
  let release
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {}
    await new Promise((resolve) => { release = resolve })
    modelResponse(res, { role: 'assistant', content: 'Done.' })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const chat = createChat({ store, settings: { private: () => ({ model: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, name: 'test', apiKey: 'local-test',
  } }) }, mp: {}, notify: () => {}, getAccount: () => ({ name: 'Test' }), act: async () => {} })
  t.after(async () => {
    release?.()
    await chat.close()
    server.closeAllConnections()
    server.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const pending = chat.sendScheduled('a', { text: '查看数据', taskId: 't1', taskName: 'Check', runId: 'r1' })
  await waitFor(() => Boolean(release))
  const scheduled = chat.snapshot('a').sessions.find((item) => item.kind === 'schedule')
  assert.equal(chat.snapshot('a').busy, false, 'the open conversation is not shown as busy')
  assert.throws(() => chat.deleteSession('a', scheduled.id), /定时任务/)
  const fresh = chat.newSession('a')
  assert.equal(chat.snapshot('a').session.id, fresh.id)
  release()
  await pending
  assert.ok(chat.messages('a', scheduled.id).some((item) => item.role === 'bot' && item.text === 'Done.'))
  assert.equal(chat.messages('a', fresh.id).length, 0)
})
