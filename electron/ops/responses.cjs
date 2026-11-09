// Map Bot history and real reasoning streams to the stateless Responses protocol.
const { responsesStream, usageValue } = require('../bot/model-stream.cjs')
function inputItems(messages) {
  const input = []
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content || '' })
    } else if (message.role === 'assistant' && message.responsesOutput) {
      input.push(...message.responsesOutput)
    } else if (message.role === 'assistant' && message.tool_calls?.length) {
      if (message.content) input.push({ role: 'assistant', content: message.content })
      for (const call of message.tool_calls) {
        input.push({ type: 'function_call', call_id: call.id,
          name: call.function.name, arguments: call.function.arguments })
      }
    } else {
      const content = Array.isArray(message.content) ? message.content.map(part => {
        if (part.type === 'text') return { type: 'input_text', text: part.text }
        if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url.url,
          detail: part.image_url.detail || 'auto' }
        return part
      }) : message.content || ''
      input.push({ role: message.role, content })
    }
  }
  return input
}

function responseMessage(response) {
  if (['failed', 'incomplete'].includes(response.status) || response.error) {
    throw new Error('模型响应未完成，请检查思考强度和服务商状态')
  }
  const output = response.output || []
  const text = output.filter((item) => item.type === 'message').flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text').map((item) => item.text).join('\n')
  const calls = output.filter((item) => item.type === 'function_call').map((item) => ({
    id: item.call_id,
    type: 'function',
    function: { name: item.name, arguments: item.arguments },
  }))
  return {
    role: 'assistant', content: response.output_text || text || null,
    ...(calls.length ? { tool_calls: calls } : {}),
    responsesOutput: output.filter((item) => ['message', 'reasoning', 'function_call'].includes(item.type)),
    reasoning: output.filter((item) => item.type === 'reasoning')
      .flatMap((item) => [...(item.summary || []), ...(item.content || [])])
      .map((item) => item.text || '').join('\n'),
    usage: usageValue(response.usage),
  }
}

async function completeResponses(client, config, messages, { tools, signal, json, onEvent }) {
  const request = {
    model: config.name,
    input: inputItems(messages),
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(config.reasoningEffort ? {
      reasoning: {
        effort: config.reasoningEffort,
        ...(config.reasoningEffort === 'none' ? {} : { summary: 'auto' }),
      },
    } : {}),
    ...(tools ? {
      tools: tools.map((tool) => ({ type: 'function', ...tool.function, strict: false })),
      tool_choice: 'auto',
    } : {}),
    ...(json ? { text: { format: { type: 'json_object' } } } : {}),
    ...(onEvent ? { stream: true } : {}),
  }
  const streamOrResponse = await client.responses.create(request, { signal })
  const result = onEvent ? await responsesStream(streamOrResponse, onEvent) : streamOrResponse
  return responseMessage(result)
}

module.exports = { inputItems, responseMessage, completeResponses }
