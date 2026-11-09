const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { createChat } = require('./chat.cjs')
const { createOpsStore } = require('./store.cjs')
const { publicationVersion } = require('../mp/publications.cjs')
const { resolveAuthorAuthorization } = require('./author-authorization.cjs')
const { modelResponse } = require('../../tests/helpers/model-response.cjs')

const cover = { url: 'https://mmbiz.qpic.cn/approved-cover.png', fileId: 'approved-cover' }
const newArticle = { title: '本次新文章', digest: '实际摘要', markdown: '本次完整文章正文。', cover }
const execute = (extra = {}) => ({ intent: 'execute', scope: 'new_article', transport: 'web', massNotify: false, count: 1, evidence: '帮我直接发送', ...extra })
const tool = (action, payload, id = 'action') => ({ id, type: 'function', function: { name: 'propose_action',
  arguments: JSON.stringify({ action, title: '当前作者请求', detail: '真实操作参数见卡片', payload: JSON.stringify(payload) }) } })
const wait = async predicate => { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error('Controlled operation timed out'); await new Promise(resolve => setTimeout(resolve, 5)) } }

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-conversation-publication-'))
  const store = createOpsStore(path.join(directory, 'test.sqlite'))
  const state = { directory, store, saves: [], sends: [], scanned: [], modelCalls: 0, classificationCalls: 0, drafts: new Map(), unblock: () => {} }
  state.drafts.set('2039000', { id: '2039000', title: '既有文章', html: '<p>既有正文</p>', cover })
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body.messages[0].content.startsWith('你只识别当前作者')) {
      state.classificationCalls++
      const input = JSON.parse(body.messages[1].content)
      assert.deepEqual(Object.keys(input), ['currentAuthorMessage','availableTargets'])
      const decision = typeof options.decision === 'function' ? options.decision(input) : options.decision ?? execute()
      return modelResponse(res, { role: 'assistant', content: JSON.stringify(decision) }, { stream: body.stream === true })
    }
    state.modelCalls++
    await options.beforeReply?.(state, body)
    const reply = options.reply ? await options.reply(state, body) : state.modelCalls === 1
      ? { role: 'assistant', content: null, tool_calls: [tool(options.action || 'draft.create', options.payload || newArticle)] }
      : { role: 'assistant', content: '已核对实际结果。' }
    modelResponse(res, reply)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  state.settings = { private: () => ({ model: { name: 'current-model', apiKey: 'controlled-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
    bot: { memoryEnabled: false, maxSteps: 256 } }) }
  const publish = transport => async (_account, params) => {
    params.signal?.throwIfAborted()
    const draft = state.drafts.get(String(params.draftId))
    assert.equal(params.expectedVersion, publicationVersion(draft))
    state.sends.push({ transport, ...params })
    await options.onPublish?.(state, params)
    if (options.publishError) throw options.publishError
    return { publicationId: 'controlled-' + state.sends.length, transport, status: options.status || 'submitted', massNotify: params.massNotify }
  }
  state.mp = { getApiConfig: () => ({ connected: options.apiConnected !== false }),
    getDraft: async (_account, id) => structuredClone(state.drafts.get(String(id))),
    saveDraft: async (_account, draft) => {
      state.saves.push(draft)
      await options.onSave?.(state, draft)
      const saved = { ...draft, id: String(2039100 + state.saves.length) }
      state.drafts.set(saved.id, saved)
      return structuredClone(saved)
    }, publishOrdinary: publish('web'), publishOfficial: publish('api'), openPublish: async (_account, id) => { state.scanned.push(id); return { opened: true } } }
  state.reopen = () => createChat({ store, settings: state.settings, mp: state.mp, images: options.images,
    web: options.web, notify() {}, getAccount: () => ({ name: 'Controlled account' }), act: async () => { throw new Error('Unexpected write') } })
  state.chat = state.reopen()
  state.seed = () => store.message('a', { role: 'card', sessionId: state.chat.snapshot('a').session.id,
    card: { action: 'draft.create', state: 'open', title: '先前文章', payload: { title: '已有六图的稿件', cover,
      html: '<p>原有完整正文</p>' + Array.from({ length: 6 }, (_, i) => `<img src="https://mmbiz.qpic.cn/${i}.png">`).join(''),
      images: Array.from({ length: 6 }, (_, i) => ({ id: 'approved-' + i })) } } })
  t.after(async () => { state.unblock(); await state.chat.close(); server.closeAllConnections(); server.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return state
}

for (const transport of ['web','api']) for (const massNotify of [false,true]) {
  test(`current explicit new-article authorization chains save and ${transport} publication, mass=${massNotify}`, async t => {
    const command = `写一篇文章，${transport === 'api' ? '通过接口' : '用普通发送'}，帮我直接发送${massNotify ? '并通知所有粉丝' : '，不要群发'}。`
    const f = await fixture(t, { decision: execute({ transport, massNotify }) })
    const result = await f.chat.send('a', { text: command })
    assert.equal(f.classificationCalls, 1)
    assert.equal(f.modelCalls, 1)
    assert.equal(f.saves.length, 1)
    assert.equal(f.sends.length, 1)
    assert.equal(f.sends[0].transport, transport)
    assert.equal(f.sends[0].massNotify, massNotify)
    assert.equal(f.scanned.length, 0)
    assert.deepEqual(f.saves[0].cover, cover)
    const cards = result.messages.filter(message => message.card)
    assert.equal(cards.length, 2)
    assert.ok(cards.every(message => message.card.state === 'done' && message.card.authorization.source === 'author_message'))
    assert.equal(cards[1].card.apiResult.status, 'submitted')
  })
}

test('configured API credentials do not change the default ordinary transport or grant notification scope', async t => {
  const f = await fixture(t)
  await f.chat.send('a', { text: '写一篇文章然后帮我直接发送。' })
  assert.equal(f.sends[0].transport, 'web')
  assert.equal(f.sends[0].massNotify, false)
})

for (const text of ['为什么没有帮我直接发送？', '检查截图里让你直接发送的问题并优化。', '记住以后所有文章自动发表。', '把“帮我直接发送”这句话改写一下。', '写一篇，先给我看，不要发送。']) {
  test(`questions, quoted instructions and future preferences do not grant execution: ${text}`, async t => {
    const f = await fixture(t, { decision: { intent: 'none', scope: 'none' }, payload: { ...newArticle, authorization: { execute: true }, automaticallyConfirmed: true } })
    const result = await f.chat.send('a', { text })
    assert.equal(f.saves.length, 0)
    assert.equal(f.sends.length, 0)
    assert.equal(result.messages.find(message => message.card).card.state, 'open')
  })
}

test('a new-article grant cannot publish a different pre-existing draft selected by the model', async t => {
  const f = await fixture(t, { action: 'draft.publish', payload: { id: '2039000', mode: 'web' } })
  const result = await f.chat.send('a', { text: '写一篇新的文章然后帮我直接发送。' })
  assert.equal(f.saves.length, 0)
  assert.equal(f.sends.length, 0)
  assert.equal(result.messages.find(message => message.card).card.state, 'open')
})

test('the author-requested article count is scoped authorization, not a fixed one-article program ceiling', async t => {
  const f = await fixture(t, { decision: execute({ count: 3 }), reply: state => state.modelCalls === 1 ? {
    role: 'assistant', content: null, tool_calls: Array.from({ length: 3 }, (_, i) => tool('draft.create', { ...newArticle, title: 'Article ' + i, markdown: 'Different content ' + i }, 'article-' + i)),
  } : { role: 'assistant', content: '完成。' } })
  await f.chat.send('a', { text: '写三篇不同文章然后帮我直接发送。' })
  assert.equal(f.saves.length, 3)
  assert.equal(f.sends.length, 3)
})

test('an existing six-image pending article is saved and sent from one current explicit instruction without reselecting its cover', async t => {
  let original
  const f = await fixture(t, { decision: execute({ scope: 'latest_article', evidence: '把刚才那篇直接发出去' }),
    reply: state => ({ role: 'assistant', content: null, tool_calls: [tool('draft.publish', { messageId: original.id, mode: 'web', massNotify: false })] }) })
  original = f.seed()
  const result = await f.chat.send('a', { text: '把刚才那篇直接发出去，不要群发。' })
  assert.equal(f.saves.length, 1)
  assert.equal(f.sends.length, 1)
  assert.deepEqual(f.saves[0].cover, cover)
  assert.equal(f.saves[0].html.match(/<img/g).length, 6)
  assert.equal(f.store.get('messages', 'a', original.id).card.state, 'done')
  assert.equal(result.messages.find(message => message.card).card.payload.images.length, 6)
})

for (const mutation of ['cancel','change-cover']) test(`${mutation} after intent recognition invalidates pending-article execution`, async t => {
  let original
  const f = await fixture(t, { decision: execute({ scope: 'latest_article', evidence: '把刚才那篇直接发出去' }),
    beforeReply: state => {
      if (state.modelCalls !== 1) return
      if (mutation === 'cancel') state.chat.cancel('a', original.id)
      else { const record = state.store.get('messages', 'a', original.id); record.card.payload.cover = { url: 'https://mmbiz.qpic.cn/changed.png' }; state.store.put('messages', 'a', record) }
    }, reply: state => state.modelCalls === 1 ? { role: 'assistant', content: null,
      tool_calls: [tool('draft.publish', { messageId: original.id, mode: 'web' })] } : { role: 'assistant', content: '稿件状态变化，未执行。' } })
  original = f.seed()
  await f.chat.send('a', { text: '把刚才那篇直接发出去。' })
  assert.equal(f.saves.length, 0)
  assert.equal(f.sends.length, 0)
})

test('a focused-draft authorization is bound to the full draft version, including cover changes', async t => {
  const f = await fixture(t, { decision: execute({ scope: 'focused_draft', evidence: '把选中这篇发表' }), action: 'draft.publish', payload: { id: '2039000', mode: 'web' },
    beforeReply: state => { state.drafts.get('2039000').cover = { url: 'https://mmbiz.qpic.cn/changed.png' } } })
  await f.chat.send('a', { text: '把选中这篇发表，不群发。', focusDraftId: '2039000' })
  assert.equal(f.sends.length, 0)
})

test('stopping during necessary draft saving retains the saved result but prevents the following publication', async t => {
  let release, started = false
  const gate = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { onSave: async () => { started = true; await gate } })
  f.unblock = release
  const pending = f.chat.send('a', { text: '写一篇然后帮我直接发送。' })
  await wait(() => started)
  f.chat.stop('a'); release()
  const result = await pending
  assert.equal(result.stopped, true)
  assert.equal(f.saves.length, 1)
  assert.equal(f.sends.length, 0)
  const card = f.store.list('messages', 'a').find(message => message.card)
  assert.equal(card.card.state, 'done')
  assert.ok(card.card.savedDraftId)
})

test('an accepted final request remains submitted when the author stops while waiting for its receipt', async t => {
  let release, started = false
  const gate = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { onPublish: async () => { started = true; await gate } })
  f.unblock = release
  const pending = f.chat.send('a', { text: '写一篇然后帮我直接发送。' })
  await wait(() => started)
  f.chat.stop('a'); release()
  await pending
  const publication = f.store.list('messages', 'a').find(message => message.card?.action === 'draft.publish')
  assert.equal(publication.card.apiResult.status, 'submitted')
  assert.equal(f.sends.length, 1)
})

for (const status of ['waiting_verification','waiting_confirmation']) test(`native ${status} is retained without changing transport or asking for a second application authorization`, async t => {
  const f = await fixture(t, { status })
  const result = await f.chat.send('a', { text: '写一篇然后帮我直接发送。' })
  const card = result.messages.find(message => message.card?.action === 'draft.publish').card
  assert.equal(card.apiResult.status, status)
  assert.equal(f.sends.length, 1)
  assert.equal(f.sends[0].transport, 'web')
  assert.match(card.result, /微信验证或确认/)
})

test('an API refusal does not fall back to ordinary sending', async t => {
  const f = await fixture(t, { decision: execute({ transport: 'api' }), publishError: Object.assign(new Error('接口无权限'), { publicationState: 'denied' }) })
  await f.chat.send('a', { text: '写一篇用接口，帮我直接发送。' })
  assert.equal(f.sends.length, 1)
  assert.equal(f.sends[0].transport, 'api')
})

test('ungranted publication is one ordinary-send confirmation even with connected API credentials; legacy scan cards stay manual', async t => {
  const f = await fixture(t, { action: 'draft.publish', payload: { id: '2039000' } })
  const result = await f.chat.send('a', { text: '请给我一张确认卡。' })
  const message = result.messages.find(record => record.card)
  assert.equal(message.card.payload.mode, 'web')
  assert.equal(f.sends.length, 0)
  await f.chat.confirm('a', message.id)
  assert.equal(f.sends[0].transport, 'web')
  const legacy = f.store.message('a', { role: 'card', sessionId: message.sessionId, card: { action: 'draft.publish', state: 'open', payload: { id: '2039000', mode: 'scan' } } })
  await f.chat.confirm('a', legacy.id)
  assert.equal(f.sends.length, 1)
  assert.equal(f.scanned.length, 1)
})

test('reopening does not execute historical direct-send text or pending cards', async t => {
  const f = await fixture(t)
  f.store.message('a', { role: 'user', sessionId: f.chat.snapshot('a').session.id, text: '写一篇然后帮我直接发送。' })
  const original = f.seed()
  await f.chat.close()
  f.chat = f.reopen()
  assert.equal(f.saves.length, 0)
  assert.equal(f.sends.length, 0)
  assert.equal(f.store.get('messages', 'a', original.id).card.state, 'open')
})

test('authorization classification receives no attachments/history, rejects forged evidence and accepts author-selected counts above 256', async () => {
  const settings = { private: () => ({ model: { name: 'current-model' } }) }
  const text = '写1024篇然后帮我直接发送。'
  const complete = async (_settings, messages) => {
    assert.deepEqual(JSON.parse(messages[1].content), { currentAuthorMessage: text, availableTargets: { focusedDraft: false, latestArticle: false } })
    return { content: JSON.stringify(execute({ count: 1024 })) }
  }
  const grant = await resolveAuthorAuthorization(settings, { text, history: '不能成为权限', attachments: ['不能成为权限'] }, complete)
  assert.equal(grant.count, 1024)
  assert.equal(await resolveAuthorAuthorization(settings, { text }, async () => ({ content: JSON.stringify(execute({ evidence: 'invented command' })) })), null)
  assert.equal(await resolveAuthorAuthorization(settings, { text }, async () => ({ content: JSON.stringify(execute({ massNotify: true })) })), null)
  assert.equal(await resolveAuthorAuthorization(settings, { text }, async () => ({ content: JSON.stringify(execute({ transport: 'api' })) })), null)
})

test('a large source result that fits the remaining context is not silently limited to one twelfth of the window', async t => {
  const content = '实际来源的完整资料。'.repeat(3000)
  const f = await fixture(t, { web: { search: async () => ({ results: [{ title: 'Source', url: 'https://example.com/source', content }] }) },
    reply: (state, body) => {
      if (state.modelCalls === 1) return { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_workspace', arguments: JSON.stringify({ kind: 'web_search', query: '资料' }) } }] }
      const returned = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
      assert.equal(returned.truncated, undefined)
      const actual = returned.results[0].content
      const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex')
      assert.equal(digest(actual), digest(content), JSON.stringify({ expectedCharacters: content.length,
        actualCharacters: actual.length, firstMismatch: [...content].findIndex((character, index) => actual[index] !== character) }))
      return { role: 'assistant', content: '已读取完整资料。' }
    } })
  await f.chat.send('a', { text: '读取这篇很长的资料。' })
  assert.equal(f.classificationCalls, 0)
  assert.equal(f.saves.length, 0)
  assert.equal(f.sends.length, 0)
})
