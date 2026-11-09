// Emit standard Chat Completions SSE responses for real SDK integration tests.
function modelResponse(response, message, { stream = true, usage } = {}) {
  const measured = usage || { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
  if (!stream) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }], usage: measured }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const delta = { ...message }
  if (message.tool_calls) delta.tool_calls = message.tool_calls.map((call, index) => ({ ...call, index }))
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {},
    finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop' }], usage: measured })}\n\n`)
  response.end('data: [DONE]\n\n')
}

module.exports = { modelResponse }
