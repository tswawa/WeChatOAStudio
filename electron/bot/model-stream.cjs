// Assemble real SDK stream deltas without inventing reasoning or tool progress.
function usageValue(value) {
  if (!value) return null
  return {
    inputTokens: value.input_tokens ?? value.prompt_tokens ?? 0,
    outputTokens: value.output_tokens ?? value.completion_tokens ?? 0,
    reasoningTokens: value.output_tokens_details?.reasoning_tokens
      ?? value.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: value.input_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens
      ?? value.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

async function chatStream(stream, emit) {
  const message = { role: 'assistant', content: '', reasoning_content: '' }
  const calls = new Map()
  let usage = null
  let finishReason = null
  for await (const chunk of stream) {
    if (chunk.usage) usage = usageValue(chunk.usage)
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
      : typeof delta.reasoning === 'string' ? delta.reasoning : ''
    if (reasoning) {
      message.reasoning_content += reasoning
      emit({ type: 'reasoning', delta: reasoning })
    }
    if (delta.content) {
      message.content += delta.content
      emit({ type: 'text', delta: delta.content })
    }
    if (delta.refusal) {
      message.content += delta.refusal
      emit({ type: 'text', delta: delta.refusal })
    }
    for (const part of delta.tool_calls || []) {
      if (!calls.has(part.index)) calls.set(part.index, {
        id: '', type: 'function', function: { name: '', arguments: '' },
      })
      const call = calls.get(part.index)
      if (part.id) call.id = part.id
      if (part.function?.name) call.function.name += part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }
  if (calls.size) message.tool_calls = [...calls.values()]
  if (!message.reasoning_content) delete message.reasoning_content
  if (finishReason === 'length') throw new Error('模型达到服务商的单次输出上限，请降低思考强度或拆分请求后重试')
  if (finishReason === 'content_filter') throw new Error('模型服务未能返回本次内容')
  return { ...message, usage }
}

async function responsesStream(stream, emit) {
  let response = null
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') emit({ type: 'text', delta: event.delta })
    if (['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'].includes(event.type)) {
      emit({ type: 'reasoning', delta: event.delta })
    }
    if (event.type === 'response.completed') response = event.response
    if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) {
      const limited = event.response?.incomplete_details?.reason === 'max_output_tokens'
      throw new Error(limited ? '模型达到服务商的单次输出上限，请降低思考强度或拆分请求后重试' : '模型响应中断，请重试')
    }
  }
  if (!response) throw new Error('模型流式响应没有正常结束，请重试')
  return response
}

module.exports = { chatStream, responsesStream, usageValue }
