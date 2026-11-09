const { test } = require('node:test')
const assert = require('node:assert/strict')
const { transcript, signature } = require('../electron/bot/context.cjs')

const model = { baseUrl: 'https://api.example.com', name: 'test-current', apiFormat: 'chat-completions' }
const call = (id, kind) => ({ id, type: 'function', function: { name: 'read_workspace', arguments: JSON.stringify({ kind }) } })

test('a new user turn clears historical private reasoning without deleting text, tool calls or tool results', () => {
  const history = [
    { role: 'user', text: 'Write an article.' },
    { role: 'bot', state: 'done', protocol: signature(model), reasoning: 'Old rules say images are unavailable.', apiMessages: [
      { role: 'assistant', content: null, reasoning_content: 'Old rules say images are unavailable.', tool_calls: [call('old', 'materials')] },
      { role: 'tool', tool_call_id: 'old', content: '[{"id":"existing-material"}]' },
    ] },
    { role: 'bot', state: 'done', protocol: signature(model), text: 'An old visible answer.', reasoning: 'Old capability belief.' },
    { role: 'user', text: '自行配图' },
    { role: 'bot', state: 'done', protocol: signature(model), apiMessages: [
      { role: 'assistant', content: null, reasoning_content: 'Read the current article and search images.', tool_calls: [call('new', 'article_context')] },
      { role: 'tool', tool_call_id: 'new', content: '{"html":"<p>The complete author article.</p>"}' },
    ] },
  ]
  const result = transcript(history, model)
  assert.equal(result[1].reasoning_content, '')
  assert.deepEqual(result[1].tool_calls, [call('old', 'materials')])
  assert.equal(result[2].content, '[{"id":"existing-material"}]')
  assert.deepEqual(result[3], { role: 'assistant', content: 'An old visible answer.' })
  assert.equal(result[5].reasoning_content, 'Read the current article and search images.')
  assert.match(result[6].content, /complete author article/)
  assert.equal(history[1].apiMessages[0].reasoning_content, 'Old rules say images are unavailable.')
  assert.equal(history[2].reasoning, 'Old capability belief.')
})

test('historical interrupted reasoning is not attached to a later user turn', () => {
  const result = transcript([
    { role: 'user', text: 'Earlier task.' },
    { role: 'bot', state: 'stopped', protocol: signature(model), text: 'Partial visible response.', reasoning: 'Obsolete partial thought.' },
    { role: 'user', text: 'Continue with images.' },
  ], model)
  assert.deepEqual(result[1], { role: 'assistant', content: 'Partial visible response.' })
})

test('clearing historical Chat reasoning does not alter Responses encrypted reasoning or its matching tool exchange', () => {
  const responseModel = { ...model, apiFormat: 'responses' }
  const output = [{ type: 'reasoning', id: 'r1', encrypted_content: 'provider-encrypted-state' },
    { type: 'function_call', call_id: 'call1', name: 'read_workspace', arguments: '{"kind":"tasks"}' }]
  const messages = [{ role: 'assistant', content: null, responsesOutput: output },
    { role: 'tool', tool_call_id: 'call1', content: '[]' }]
  const result = transcript([{ role: 'bot', state: 'done', protocol: signature(responseModel), apiMessages: messages },
    { role: 'user', text: 'A later turn.' }], responseModel)
  assert.deepEqual(result.slice(0, 2), messages)
})
