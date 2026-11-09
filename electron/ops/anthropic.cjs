// Translate the shared conversation contract to Anthropic, preserving signed thinking and tool results.
const { modelBudget } = require('../bot/config.cjs')

function anthropicInput(messages) {
  const system = []
  const result = []
  const append = (role, content) => {
    if (!content.length) return
    if (result.at(-1)?.role === role) result.at(-1).content.push(...content)
    else result.push({ role, content })
  }
  for (const message of messages) {
    if (message.role === 'system') { system.push(String(message.content || '')); continue }
    if (message.role === 'tool') {
      append('user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content || '' }])
      continue
    }
    if (message.role === 'assistant' && message.anthropicContent) {
      append('assistant', structuredClone(message.anthropicContent))
      continue
    }
    const content = Array.isArray(message.content) ? message.content.map(part => {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.type !== 'image_url') throw new Error('Anthropic 不支持本次输入内容类型')
      const url = part.image_url.url
      const data = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url)
      return { type: 'image', source: data ? { type: 'base64', media_type: data[1], data: data[2] }
        : { type: 'url', url } }
    }) : message.content ? [{ type: 'text', text: message.content }] : []
    for (const call of message.tool_calls || []) content.push({ type: 'tool_use', id: call.id,
      name: call.function.name, input: JSON.parse(call.function.arguments) })
    append(message.role === 'assistant' ? 'assistant' : 'user', content)
  }
  return { system: system.join('\n\n'), messages: result }
}

function anthropicMessage(message) {
  if (['max_tokens', 'model_context_window_exceeded'].includes(message.stop_reason)) {
    throw new Error('模型达到服务商的单次输出上限，请降低思考强度或拆分请求后重试')
  }
  if (!['end_turn', 'tool_use', 'stop_sequence'].includes(message.stop_reason)) throw new Error('Anthropic 响应未正常完成，请重试')
  const content = message.content || []
  const calls = content.filter(part => part.type === 'tool_use').map(part => ({ id: part.id, type: 'function',
    function: { name: part.name, arguments: JSON.stringify(part.input) } }))
  const usage = message.usage || {}
  return { role: 'assistant', content: content.filter(part => part.type === 'text').map(part => part.text).join('') || null,
    reasoning: content.filter(part => part.type === 'thinking').map(part => part.thinking).join('\n'),
    ...(calls.length ? { tool_calls: calls } : {}), anthropicContent: content,
    usage: { inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
      outputTokens: usage.output_tokens || 0, reasoningTokens: usage.output_tokens_details?.thinking_tokens || 0,
      cachedTokens: usage.cache_read_input_tokens || 0 } }
}

async function anthropicClient(model, timeout = 600000) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const baseURL = model.baseUrl.replace(/\/messages\/?$/, '').replace(/\/v1\/?$/, '')
  return new Anthropic({ apiKey: model.apiKey, baseURL, timeout, maxRetries: 0 })
}

async function completeAnthropic(config, messages, { tools, signal, json, onEvent }) {
  const client = await anthropicClient(config)
  const input = anthropicInput(messages)
  const request = { model: config.name, ...input, max_tokens: Math.min(16384, modelBudget(config).output),
    ...(json ? { system: input.system + '\n只返回一个有效 JSON 对象，不使用代码围栏。' } : {}),
    ...(tools ? { tools: tools.map(tool => ({ name: tool.function.name, description: tool.function.description,
      input_schema: tool.function.parameters })), tool_choice: { type: 'auto' } } : {}),
    ...(config.reasoningEffort === 'none' ? { thinking: { type: 'disabled' } }
      : config.reasoningEffort ? { output_config: { effort: config.reasoningEffort } } : {}) }
  if (!onEvent) return anthropicMessage(await client.messages.create(request, { signal }))
  const stream = client.messages.stream(request, { signal })
  for await (const event of stream) {
    if (event.type !== 'content_block_delta') continue
    if (event.delta.type === 'text_delta') onEvent({ type: 'text', delta: event.delta.text })
    if (event.delta.type === 'thinking_delta') onEvent({ type: 'reasoning', delta: event.delta.thinking })
  }
  return anthropicMessage(await stream.finalMessage())
}

module.exports = { anthropicInput, anthropicMessage, anthropicClient, completeAnthropic }
