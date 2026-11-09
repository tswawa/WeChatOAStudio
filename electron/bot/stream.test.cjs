// Verify real SDK SSE reasoning, provider limits, Responses summaries and cancellation.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { completion } = require('../ops/model.cjs')
const { normalizeModel } = require('./config.cjs')

async function serve(t, handler) {
  const server = http.createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    handler(JSON.parse(text), response)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  return `http://127.0.0.1:${server.address().port}/v1`
}
const event = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`)

test('reasoning and partial tool arguments stream through the SDK with the effort sent as written', async (t) => {
  let sent
  const baseUrl = await serve(t, (request, response) => {
    sent = request
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    event(response, { choices: [{ index: 0, delta: { reasoning_content: 'Consider ' } }] })
    event(response, { choices: [{ index: 0, delta: { reasoning_content: 'the request.' } }] })
    event(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1',
      function: { name: 'read_workspace', arguments: '{"kind":' } }] } }] })
    event(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0,
      function: { arguments: '"tasks"}' } }] }, finish_reason: 'tool_calls' }] })
    event(response, { choices: [], usage: { prompt_tokens: 42, completion_tokens: 12,
      completion_tokens_details: { reasoning_tokens: 8 } } })
    response.end('data: [DONE]\n\n')
  })
  const config = { baseUrl, apiKey: 'test', name: 'test', reasoningEffort: 'max', contextWindow: 8192 }
  const events = []
  const result = await completion({ private: () => ({ model: config }) }, [{ role: 'user', content: 'Read' }], {
    onEvent: value => events.push(value),
  })
  assert.equal(sent.reasoning_effort, 'max')
  for (const key of ['thinking', 'max_tokens', 'max_completion_tokens']) assert.equal(sent[key], undefined)
  assert.equal(result.reasoning_content, 'Consider the request.')
  assert.deepEqual(JSON.parse(result.tool_calls[0].function.arguments), { kind: 'tasks' })
  assert.equal(events.length, 2)
  assert.equal(result.usage.reasoningTokens, 8)
})

test('Responses streams the returned summary and preserves encrypted reasoning in the final output', async (t) => {
  let sent
  const output = [
    { type: 'reasoning', id: 'rs1', summary: [{ type: 'summary_text', text: 'Summary from provider' }],
      encrypted_content: 'encrypted' },
    { type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: 'Answer' }] },
  ]
  const baseUrl = await serve(t, (request, response) => {
    sent = request
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    event(response, { type: 'response.reasoning_summary_text.delta', delta: 'Summary from provider' })
    event(response, { type: 'response.output_text.delta', delta: 'Answer' })
    event(response, { type: 'response.completed', response: { status: 'completed', output,
      usage: { input_tokens: 44, output_tokens: 14 } } })
    response.end('data: [DONE]\n\n')
  })
  const events = []
  const result = await completion({ private: () => ({ model: {
    baseUrl, name: 'test', apiKey: 'test', apiFormat: 'responses', reasoningEffort: 'high',
  } }) }, [{ role: 'user', content: 'Read' }], { onEvent: value => events.push(value) })
  assert.deepEqual(sent.reasoning, { effort: 'high', summary: 'auto' })
  assert.equal(sent.max_output_tokens, undefined)
  assert.equal(result.reasoning, 'Summary from provider')
  assert.equal(result.responsesOutput[0].encrypted_content, 'encrypted')
  assert.equal(result.content, 'Answer')
  assert.equal(events[0].type, 'reasoning')
  assert.equal(events[1].type, 'text')
})

test('stream cancellation preserves received deltas and aborts the actual HTTP request', async (t) => {
  const controller = new AbortController()
  const baseUrl = await serve(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    event(response, { choices: [{ index: 0, delta: { reasoning_content: 'Received before stop' } }] })
  })
  const events = []
  await assert.rejects(completion({ private: () => ({ model: {
    baseUrl, name: 'test', apiKey: 'test',
  } }) }, [{ role: 'user', content: 'Read' }], { signal: controller.signal, onEvent: value => {
    events.push(value)
    controller.abort(new Error('Stopped by user'))
  } }), /Stopped by user/)
  assert.equal(events[0].delta, 'Received before stop')
})

test('Responses preserves plain reasoning content and omits reasoning when effort is left empty', async (t) => {
  const baseUrl = await serve(t, (request, response) => {
    assert.equal(request.reasoning, undefined)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    event(response, { type: 'response.reasoning_text.delta', delta: 'Actual reasoning text' })
    event(response, { type: 'response.completed', response: { status: 'completed', output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Actual reasoning text' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
    ] } })
    response.end()
  })
  const result = await completion({ private: () => ({ model: {
    baseUrl, apiKey: 'test', name: 'test', apiFormat: 'responses', reasoningEffort: '',
  } }) }, [{ role: 'user', content: 'Test' }], { onEvent: () => {} })
  assert.equal(result.reasoning, 'Actual reasoning text')
  assert.equal(result.responsesOutput[0].content[0].text, 'Actual reasoning text')
})

test('configuration keeps only context window and free-text effort, dropping old fields', () => {
  assert.equal(normalizeModel({ contextWindow: 2048 }).contextWindow, 2048)
  assert.equal(normalizeModel({ contextWindow: 4194304 }).contextWindow, 4194304)
  assert.equal(normalizeModel({ reasoningEffort: 'provider-custom-effort' }).reasoningEffort, 'provider-custom-effort')
  assert.throws(() => normalizeModel({ reasoningEffort: {} }), /配置格式/)
  assert.equal(normalizeModel({ reasoningEffort: ' xhigh ' }).reasoningEffort, 'xhigh')
  assert.equal(normalizeModel({ reasoningEffort: 'default' }).reasoningEffort, '')
  const legacy = normalizeModel({}, { baseUrl: 'https://api.deepseek.com', provider: 'deepseek',
    maxOutputTokens: 8192, compactAt: 75, reasoningEffort: 'default', contextWindow: 64000 })
  assert.deepEqual(Object.keys(legacy).sort(), ['apiFormat', 'apiKey', 'baseUrl', 'contextWindow', 'name', 'reasoningEffort'])
  assert.equal(legacy.contextWindow, 64000)
  assert.equal(legacy.reasoningEffort, '')
})
