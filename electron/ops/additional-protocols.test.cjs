const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { completion } = require('./model.cjs')
const { createNativeSearch } = require('./native-search.cjs')
const { normalizeModel } = require('../bot/config.cjs')
const { transcript, signature } = require('../bot/context.cjs')

const tools = [{ type: 'function', function: { name: 'read_workspace', description: 'Read current workspace',
  parameters: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] } } }]
async function serverFor(t, handler) {
  const requests = []
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const value = { path: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }
    requests.push(value)
    await handler(value, response, requests.length)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` }
}
function anthropic(response, content, stream = false) {
  const message = { id: 'msg-test', type: 'message', role: 'assistant', model: 'current-test', content,
    stop_reason: content.some(item => item.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: 80, output_tokens: 20 } }
  if (!stream) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(message)); return }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
  event({ type: 'message_start', message: { ...message, content: [], stop_reason: null } })
  for (const [index, block] of content.entries()) {
    if (block.type === 'thinking') {
      event({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      event({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } })
      event({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } })
    } else if (block.type === 'tool_use') {
      event({ type: 'content_block_start', index, content_block: { ...block, input: {} } })
      event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    } else {
      event({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      event({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    }
    event({ type: 'content_block_stop', index })
  }
  event({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } })
  event({ type: 'message_stop' })
  response.end()
}
function gemini(response, parts, stream = false, extra = {}) {
  const message = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', ...extra }],
    usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, thoughtsTokenCount: 5 } }
  response.writeHead(200, { 'Content-Type': stream ? 'text/event-stream' : 'application/json' })
  response.end(stream ? `data: ${JSON.stringify(message)}\n\n` : JSON.stringify(message))
}
for (const format of ['anthropic', 'gemini']) {
  test(`${format} streams real thinking and replays signed tool calls using the native SDK`, async t => {
    const f = await serverFor(t, (request, response, index) => {
      if (format === 'anthropic') anthropic(response, index === 1 ? [
        { type: 'thinking', thinking: 'Actual provider reasoning', signature: 'signed-thinking' },
        { type: 'tool_use', id: 'call-one', name: 'read_workspace', input: { kind: 'tasks' } },
      ] : [{ type: 'text', text: 'Native tool round trip completed' }], true)
      else gemini(response, index === 1 ? [{ thought: true, text: 'Actual provider reasoning' },
        { functionCall: { name: 'read_workspace', args: { kind: 'tasks' } }, thoughtSignature: 'c2lnbmVkLXRoaW5raW5n' }]
        : [{ text: 'Native tool round trip completed' }], true)
    })
    const settings = { private: () => ({ model: { apiFormat: format, name: 'current-test', apiKey: 'test-key',
      baseUrl: f.baseUrl + (format === 'anthropic' ? '/gateway/v1' : '/gateway/v1beta'), reasoningEffort: 'high' } }) }
    const messages = [{ role: 'system', content: 'Author preferences' }, { role: 'user', content: 'Read tasks' }]
    const events = []
    const first = await completion(settings, messages, { tools, onEvent: event => events.push(event) })
    assert.ok(events.some(event => event.type === 'reasoning' && event.delta.includes('Actual provider')))
    assert.equal(first.tool_calls[0].function.name, 'read_workspace')
    assert.deepEqual(JSON.parse(first.tool_calls[0].function.arguments), { kind: 'tasks' })
    assert.ok(first.usage.inputTokens > 0)
    const result = await completion(settings, [...messages, first,
      { role: 'tool', tool_call_id: first.tool_calls[0].id, content: '[]' }], { tools, onEvent() {} })
    assert.match(result.content, /completed/)
    const second = f.requests[1]
    if (format === 'anthropic') {
      assert.equal(second.path, '/gateway/v1/messages')
      assert.equal(second.body.system, 'Author preferences')
      assert.equal(second.body.messages[1].content[0].signature, 'signed-thinking')
      assert.equal(second.body.messages[2].content[0].tool_use_id, first.tool_calls[0].id)
      assert.equal(second.body.output_config.effort, 'high')
      assert.equal(second.body.tools[0].input_schema.type, 'object')
      assert.ok(second.headers.authorization || second.headers['x-api-key'])
    } else {
      assert.match(second.path, /^\/gateway\/v1beta\/models\/current-test:streamGenerateContent/)
      assert.equal(second.body.contents[1].parts[1].thoughtSignature, 'c2lnbmVkLXRoaW5raW5n')
      assert.equal(second.body.contents[2].parts[0].functionResponse.name, 'read_workspace')
      assert.equal(second.body.contents[2].parts[0].functionResponse.id, first.tool_calls[0].id)
      assert.equal(second.body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH')
      assert.ok(second.body.tools[0].functionDeclarations[0].parametersJsonSchema)
    }
    const model = normalizeModel(settings.private().model)
    const history = transcript([{ role: 'bot', state: 'done', protocol: signature(model), apiMessages: [first] },
      { role: 'user', text: 'Another user turn' }], model)
    assert.deepEqual(history[0][format === 'anthropic' ? 'anthropicContent' : 'geminiContent'],
      first[format === 'anthropic' ? 'anthropicContent' : 'geminiContent'])
  })

  test(`${format} sends actual image bytes, returns structured JSON and accepts the configured current model`, async t => {
    const verdict = JSON.stringify({ decision: 'approved', relevant: true, risks: [], description: 'Actual pixels', reason: 'Suitable' })
    const f = await serverFor(t, (_request, response) => format === 'anthropic'
      ? anthropic(response, [{ type: 'text', text: verdict }]) : gemini(response, [{ text: verdict }]))
    const settings = { private: () => ({ model: { apiFormat: format, name: 'current-vision', apiKey: 'test-key', baseUrl: f.baseUrl } }) }
    const answer = await completion(settings, [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: [
      { type: 'text', text: 'Inspect pixels' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,cGl4ZWxz' } },
    ] }], { json: true })
    assert.equal(JSON.parse(answer.content).decision, 'approved')
    const body = f.requests[0].body
    if (format === 'anthropic') assert.equal(body.messages[0].content[1].source.data, 'cGl4ZWxz')
    else {
      assert.equal(body.contents[0].parts[1].inlineData.data, 'cGl4ZWxz')
      assert.equal(body.generationConfig.responseMimeType, 'application/json')
    }
  })

  test(`${format} performs its own native search before application engines`, async t => {
    const f = await serverFor(t, (_request, response) => format === 'anthropic' ? anthropic(response, [
      { type: 'server_tool_use', id: 'search-one', name: 'web_search', input: { query: 'news' } },
      { type: 'web_search_tool_result', tool_use_id: 'search-one', content: [{ type: 'web_search_result', title: 'News', url: 'https://example.com/news' }] },
      { type: 'text', text: 'Actual search summary' },
    ]) : gemini(response, [{ text: 'Actual search summary' }], false, { groundingMetadata: {
      webSearchQueries: ['news'], groundingChunks: [{ web: { title: 'News', uri: 'https://example.com/news' } }],
    } }))
    const settings = { private: () => ({ model: { apiFormat: format, name: 'current-test', apiKey: 'test-key', baseUrl: f.baseUrl } }) }
    const result = await createNativeSearch({ settings }).search('news')
    assert.equal(result.supported, true)
    assert.equal(result.format, format)
    assert.equal(result.results[0].url, 'https://example.com/news')
    assert.equal(f.requests.length, 1)
  })

  test(`${format} never switches protocols or authorizes engine fallback for auth, quota or unverifiable search output`, async t => {
    for (const status of [401,429,500,200]) {
      const f = await serverFor(t, (_request, response) => {
        if (status === 200) return format === 'anthropic' ? anthropic(response, [{ type: 'text', text: 'No verifiable sources' }])
          : gemini(response, [{ text: 'No verifiable sources' }])
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { type: 'api_error', message: 'Test service failure', code: status } }))
      })
      const settings = { private: () => ({ model: { apiFormat: format, name: 'current-test', apiKey: 'test-key', baseUrl: f.baseUrl } }) }
      await assert.rejects(createNativeSearch({ settings }).search('news'), /未降级|未切换/)
      assert.equal(f.requests.length, 1)
    }
  })

  test(`${format} cancellation aborts a live stream and keeps already emitted text`, async t => {
    const f = await serverFor(t, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (format === 'anthropic') {
        response.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'live', type: 'message', role: 'assistant',
          model: 'current-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } })}\n\n`)
        response.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`)
        response.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial text' } })}\n\n`)
      } else response.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Partial text' }] } }] })}\n\n`)
    })
    const controller = new AbortController()
    const settings = { private: () => ({ model: { apiFormat: format, name: 'current-test', apiKey: 'test-key', baseUrl: f.baseUrl } }) }
    const events = []
    await assert.rejects(completion(settings, [{ role: 'user', content: 'Start' }], {
      signal: controller.signal, onEvent(event) { events.push(event); controller.abort(new Error('Stopped by author')) },
    }), /Stopped by author/)
    assert.equal(events[0].delta, 'Partial text')
  })

  test(`${format} explicit native-search rejection permits only engine fallback, not another protocol`, async t => {
    const f = await serverFor(t, (_request, response) => {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'web_search / googleSearch is not supported', code: 400 } }))
    })
    const settings = { private: () => ({ model: { apiFormat: format, name: 'current-test', apiKey: 'test-key', baseUrl: f.baseUrl } }) }
    const result = await createNativeSearch({ settings }).search('news')
    assert.equal(result.supported, false)
    assert.equal(f.requests.length, 1)
  })
}
