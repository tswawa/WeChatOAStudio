// Verify Bot memory, archival sessions, compaction and restart behavior.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { createOpsStore } = require('../ops/store.cjs')
const { createChat } = require('../ops/chat.cjs')
const { modelResponse } = require('../../tests/helpers/model-response.cjs')
const { budget, estimate } = require('./tokens.cjs')
const { transcript, signature } = require('./context.cjs')

async function setup(t, handler, model = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'oastudio-bot-'))
  const dbPath = join(directory, 'app.sqlite')
  const store = createOpsStore(dbPath)
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    handler(JSON.parse(body), response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const settings = { private: () => ({ model: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, name: 'test', apiKey: 'test-secret', ...model,
  } }) }
  const options = { store, settings, mp: {}, notify: () => {}, getAccount: () => ({ name: 'Account' }),
    act: async () => ({ saved: true }) }
  const chat = createChat(options)
  t.after(async () => {
    await chat.close()
    server.closeAllConnections()
    server.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { store, chat, dbPath, options }
}

test('the Bot keeps memory across messages and archived sessions, including after reopening', async (t) => {
  let count = 0
  const requests = []
  const { store, chat, dbPath, options } = await setup(t, (body, response) => {
    requests.push(body)
    count += 1
    if (count === 1) modelResponse(response, { role: 'assistant', content: null,
      reasoning_content: 'Save the preference supplied by the user.', tool_calls: [{ id: 'remember1', type: 'function',
        function: { name: 'memory', arguments: JSON.stringify({ operation: 'save',
          title: 'Writing style', content: 'The user prefers concise writing.' }) } }] })
    else modelResponse(response, { role: 'assistant', content: 'Concise writing.', reasoning_content: 'Use the saved fact.' })
  })
  const first = chat.snapshot('a').session.id
  await chat.send('a', { text: 'Remember that I prefer concise writing.' })
  assert.equal(chat.memory.list('a').length, 1)
  assert.equal(chat.snapshot('a').model.apiKey, undefined)
  assert.equal(chat.messages('a').some(message => message.reasoning), true)
  assert.equal(chat.messages('a').some(message => message.activity?.[0]?.name === 'memory'), true)

  await chat.send('a', { text: 'What is my preference?' })
  assert.match(requests.at(-1).messages[0].content, /prefers concise/)
  const second = chat.newSession('a').id
  assert.notEqual(second, first)
  assert.equal(chat.messages('a').length, 0)
  assert.equal(chat.memory.list('a').length, 1)
  chat.selectSession('a', first)
  assert.ok(chat.messages('a').length >= 5)
  assert.throws(() => chat.selectSession('b', first), /不存在|不属于/)
  assert.equal(chat.memory.list('b').length, 0)
  assert.throws(() => chat.memory.save('b', { id: chat.memory.list('a')[0].id, title: 'Bad', content: 'Bad' }), /不存在/)
  const reopened = createOpsStore(dbPath)
  const restored = createChat({ ...options, store: reopened })
  assert.equal(restored.snapshot('a').session.id, first)
  assert.equal(restored.memory.list('a').length, 1)
  assert.equal(restored.snapshot('a').sessions.length, 2)
  await restored.close()
  reopened.close()
})

test('legacy QQ history, templates and tasks survive reopening without the QQ bridge', async (t) => {
  const { store, chat, dbPath, options } = await setup(t, (_body, response) => {
    modelResponse(response, { role: 'assistant', content: 'Ready.' })
  })
  const oldUser = store.message('a', { role: 'user', text: 'An earlier request.', channel: 'qq' })
  const oldReply = store.message('a', { role: 'bot', text: 'An earlier answer.', state: 'done' })
  const template = { id: 'template-existing', name: 'Existing template', structure: 'Short paragraphs.',
    html: '<p style="font-size: 16px">Sample article.</p>', isDefault: true }
  const task = { id: 'task-existing', name: 'Existing task', type: 'assistant', content: 'Read the daily stats.',
    schedule: { time: '08:00', repeat: 'daily', weekdays: [] }, enabled: true }
  store.put('templates', 'a', template)
  store.put('tasks', 'a', task)

  const session = chat.snapshot('a').session
  assert.deepEqual(chat.messages('a').map(({ id }) => id), [oldUser.id, oldReply.id])
  assert.equal(chat.messages('a')[0].channel, 'qq')
  assert.equal(chat.messages('a').every(message => message.sessionId === session.id), true)
  assert.equal(chat.messages('b').length, 0)
  await chat.send('a', { text: 'Continue here.' })
  assert.equal(chat.messages('a').find(message => message.text === 'Continue here.').channel, 'desktop')

  const reopened = createOpsStore(dbPath)
  const restored = createChat({ ...options, store: reopened })
  try {
    assert.equal(restored.snapshot('a').session.id, session.id)
    assert.equal(restored.messages('a').some(message => message.id === oldUser.id), true)
    assert.equal(restored.messages('a').some(message => message.id === oldReply.id), true)
    assert.equal(reopened.get('templates', 'a', template.id).html, template.html)
    assert.equal(reopened.get('tasks', 'a', task.id).content, task.content)
    assert.equal(reopened.get('templates', 'b', template.id), null)
  } finally {
    await restored.close()
    reopened.close()
  }
})

test('context automatically summarizes old turns while preserving all archived messages', async (t) => {
  const summaries = []
  let finalRequest
  const { store, chat } = await setup(t, (body, response) => {
    if (!body.tools) {
      summaries.push(body)
      assert.ok(estimate(body.messages) <= budget({ contextWindow: 8192 }).input)
      modelResponse(response, { role: 'assistant', content: 'The user prefers short reports. Earlier work was completed.' },
        { stream: false })
    } else {
      finalRequest = body
      modelResponse(response, { role: 'assistant', content: 'Continuing with the summary.' })
    }
  }, { contextWindow: 8192 })
  chat.snapshot('a')
  store.message('a', { role: 'user', text: 'Read the tasks.' })
  store.message('a', { role: 'bot', state: 'done', text: 'Read them.', activity: [{ id: 'call-old', name: 'read_workspace',
    state: 'done', arguments: '{"kind":"tasks"}', result: '[{"id":"task-real-1"}]' }] })
  const card = store.message('a', { role: 'card', card: { type: 'action', kind: 'action', action: 'task.toggle',
    title: 'Pause task', detail: 'task-real-1', state: 'open', payload: { id: 'task-real-1', enabled: false } } })
  for (let index = 0; index < 32; index += 1) {
    store.message('a', { role: 'user', text: `Old request ${index}. ` + 'Earlier user context. '.repeat(30) })
    store.message('a', { role: 'bot', text: 'Earlier answer. '.repeat(30) })
  }
  const before = chat.messages('a').length
  await chat.send('a', { text: 'Continue the work.' })
  assert.ok(summaries.length >= 1)
  const summarized = JSON.parse(summaries[0].messages[1].content).records
  assert.equal(summarized.find((record) => record.tools)?.tools[0].result, '[{"id":"task-real-1"}]')
  assert.equal(summarized.find((record) => record.tools).tools[0].callId, 'call-old')
  assert.match(finalRequest.messages[0].content, /prefers short reports/)
  assert.equal(chat.messages('a').length, before + 2)
  assert.ok(chat.snapshot('a').session.summaryThrough)
  assert.equal(chat.snapshot('a').session.context.compacted, true)
  assert.doesNotMatch(finalRequest.messages[0].content, /当前状态/)

  chat.cancel('a', card.id)
  await chat.send('a', { text: 'Is the task paused?' })
  assert.match(finalRequest.messages[0].content, new RegExp(`${card.id}「Pause task」当前状态：cancelled`))
})

test('replies with reasoning keep reasoning_content when replayed as text history', () => {
  const model = { baseUrl: 'https://example.com', name: 'test', apiFormat: 'chat-completions' }
  const messages = transcript([{
    role: 'bot', state: 'stopped', protocol: signature(model), text: 'Partial answer', reasoning: 'Partial thought',
  }], model)
  assert.deepEqual(messages, [{ role: 'assistant', content: 'Partial answer', reasoning_content: 'Partial thought' }])
  const other = transcript([{ role: 'bot', state: 'stopped', protocol: 'other|model|chat-completions',
    text: 'Partial answer', reasoning: 'Partial thought' }], model)
  assert.deepEqual(other, [{ role: 'assistant', content: 'Partial answer' }])
})

test('oversized input fails before a provider request and leaves the user message intact', async (t) => {
  let requests = 0
  const { chat } = await setup(t, (_body, response) => { requests += 1; response.end() },
    { contextWindow: 4096 })
  await assert.rejects(chat.send('a', { text: 'oversized input '.repeat(5000) }), /上下文预算/)
  assert.equal(requests, 0)
  assert.equal(chat.messages('a')[0].role, 'user')
  assert.equal(chat.snapshot('a').busy, false)
})

test('the default Bot call budget can continue beyond the former 64-call ceiling', { timeout: 20000 }, async t => {
  let requests = 0
  const { chat } = await setup(t, (_body, response) => {
    requests += 1
    modelResponse(response, requests <= 70 ? { role: 'assistant', content: null, tool_calls: [{ id: `long-${requests}`, type: 'function',
      function: { name: 'read_workspace', arguments: '{"kind":"tasks"}' } }] }
      : { role: 'assistant', content: 'The longer task completed.' })
  })
  const result = await chat.send('a', { text: 'Complete this long read-only task.' })
  assert.equal(requests, 71)
  assert.equal(result.limited, undefined)
  assert.equal(result.messages.at(-1).text, 'The longer task completed.')
})

test('a stopped tool exchange cannot inject dangling function calls into the next request', () => {
  const model = { baseUrl: 'https://example.com', name: 'test', apiFormat: 'chat-completions' }
  const messages = transcript([{
    role: 'bot', state: 'stopped', protocol: signature(model), text: 'Partial answer',
    apiMessages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'unfinished', type: 'function',
      function: { name: 'memory', arguments: '{}' } }] }],
  }], model)
  assert.deepEqual(messages, [{ role: 'assistant', content: 'Partial answer' }])
})
