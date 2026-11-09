// Exercise both provider protocols and Responses tool replay through the actual SDK.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { completion } = require('./model.cjs')

const tools = [{ type: 'function', function: {
  name: 'list_tasks', description: 'Read tasks', parameters: { type: 'object', properties: {} },
} }]

async function provider(run) {
  const requests = []
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/chat/completions') {
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'chat result' } }] }))
    } else if (requests.length === 1) {
      response.end(JSON.stringify({ id: 'resp_1', status: 'completed', output: [
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'encrypted-reasoning' },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'list_tasks', arguments: '{}' },
      ] }))
    } else {
      response.end(JSON.stringify({ id: 'resp_2', status: 'completed', output: [{
        type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'response result' }],
      }] }))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  try {
    await run({ requests, baseUrl })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('Chat Completions remains compatible and does not send Responses-only metadata', async () => {
  await provider(async ({ requests, baseUrl }) => {
    const settings = { private: () => ({ model: { baseUrl, name: 'model', apiKey: 'test', apiFormat: 'chat-completions' } }) }
    const result = await completion(settings, [{ role: 'user', content: 'read', responsesOutput: [] }], { tools, json: true })
    assert.equal(result.content, 'chat result')
    assert.equal(requests[0].path, '/v1/chat/completions')
    assert.equal(requests[0].body.messages[0].responsesOutput, undefined)
    assert.deepEqual(requests[0].body.tools, tools)
    assert.equal(requests[0].body.response_format.type, 'json_object')
  })
})

test('Responses sends function calls back with original reasoning and matching call_id', async () => {
  await provider(async ({ requests, baseUrl }) => {
    const settings = { private: () => ({ model: { baseUrl, name: 'model', apiKey: 'test', apiFormat: 'responses' } }) }
    const messages = [{ role: 'system', content: 'Read tasks' }, { role: 'user', content: 'read' }]
    const first = await completion(settings, messages, { tools })
    assert.equal(first.tool_calls[0].id, 'call_1')
    assert.equal(first.tool_calls[0].function.name, 'list_tasks')
    messages.push(first, { role: 'tool', tool_call_id: 'call_1', content: '[]' })
    const result = await completion(settings, messages, { tools, json: true })
    assert.equal(result.content, 'response result')
    const request = requests[1].body
    assert.equal(request.store, false)
    assert.equal(request.tools[0].name, 'list_tasks')
    assert.equal(request.tools[0].function, undefined)
    assert.equal(request.tools[0].strict, false)
    assert.equal(request.input[2].encrypted_content, 'encrypted-reasoning')
    assert.equal(request.input[3].call_id, 'call_1')
    assert.deepEqual(request.input[4], { type: 'function_call_output', call_id: 'call_1', output: '[]' })
    assert.equal(request.text.format.type, 'json_object')
  })
})
