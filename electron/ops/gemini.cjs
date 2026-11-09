// Gemini uses its native SDK; function-call thought signatures survive every tool round trip.
const { randomUUID } = require('node:crypto')

function geminiInput(messages) {
  const system = []
  const contents = []
  const names = new Map()
  const append = (role, parts) => {
    if (!parts.length) return
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts)
    else contents.push({ role, parts })
  }
  for (const message of messages) {
    if (message.role === 'system') { system.push(String(message.content || '')); continue }
    if (message.role === 'tool') {
      const name = names.get(message.tool_call_id)
      if (!name) throw new Error('Gemini 工具结果缺少匹配的调用记录')
      append('user', [{ functionResponse: { id: message.tool_call_id, name, response: { result: message.content || '' } } }])
      continue
    }
    for (const call of message.tool_calls || []) names.set(call.id, call.function.name)
    if (message.role === 'assistant' && message.geminiContent) {
      append('model', structuredClone(message.geminiContent))
      continue
    }
    const parts = Array.isArray(message.content) ? message.content.map(part => {
      if (part.type === 'text') return { text: part.text }
      if (part.type !== 'image_url') throw new Error('Gemini 不支持本次输入内容类型')
      const data = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url.url)
      if (!data) throw new Error('Gemini 图片输入需要已读取的实际图片数据')
      return { inlineData: { mimeType: data[1], data: data[2] } }
    }) : message.content ? [{ text: message.content }] : []
    for (const call of message.tool_calls || []) parts.push({ functionCall: { id: call.id, name: call.function.name,
      args: JSON.parse(call.function.arguments) } })
    append(message.role === 'assistant' ? 'model' : 'user', parts)
  }
  return { systemInstruction: system.join('\n\n'), contents }
}

async function geminiClient(model, timeout = 600000) {
  const { GoogleGenAI } = await import('@google/genai')
  return new GoogleGenAI({ apiKey: model.apiKey, httpOptions: { baseUrl: model.baseUrl,
    ...(/\/v1(?:beta|alpha)?\/?$/.test(new URL(model.baseUrl).pathname) ? { apiVersion: '' } : {}),
    timeout, retryOptions: { attempts: 1 } } })
}

function geminiMessage(parts, finishReason, usage = {}) {
  if (finishReason === 'MAX_TOKENS') throw new Error('模型达到服务商的单次输出上限，请降低思考强度或拆分请求后重试')
  if (finishReason !== 'STOP') throw new Error('Gemini 响应未正常完成，请检查模型返回与内容限制')
  const content = structuredClone(parts)
  const calls = content.filter(part => part.functionCall).map(part => {
    part.functionCall.id ||= `call_${randomUUID()}`
    return { id: part.functionCall.id, type: 'function', function: { name: part.functionCall.name,
      arguments: JSON.stringify(part.functionCall.args || {}) } }
  })
  return { role: 'assistant', content: content.filter(part => part.text && !part.thought).map(part => part.text).join('') || null,
    reasoning: content.filter(part => part.thought).map(part => part.text || '').join(''), geminiContent: content,
    ...(calls.length ? { tool_calls: calls } : {}), usage: { inputTokens: usage.promptTokenCount || 0,
      outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
      reasoningTokens: usage.thoughtsTokenCount || 0, cachedTokens: usage.cachedContentTokenCount || 0 } }
}

async function completeGemini(config, messages, { tools, signal, json, onEvent }) {
  const client = await geminiClient(config)
  const { contents, systemInstruction } = geminiInput(messages)
  const request = { model: config.name, contents, config: { systemInstruction, abortSignal: signal,
    automaticFunctionCalling: { disable: true },
    ...(tools ? { tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.function.name,
      description: tool.function.description, parametersJsonSchema: tool.function.parameters })) }] } : {}),
    ...(json ? { responseMimeType: 'application/json' } : {}),
    ...(config.reasoningEffort ? { thinkingConfig: config.reasoningEffort === 'none'
      ? { thinkingBudget: 0 } : /^\d+$/.test(config.reasoningEffort) ? { thinkingBudget: Number(config.reasoningEffort), includeThoughts: true }
        : { thinkingLevel: config.reasoningEffort.toUpperCase(), includeThoughts: true } } : {}) } }
  if (!onEvent) {
    const result = await client.models.generateContent(request)
    return geminiMessage(result.candidates?.[0]?.content?.parts || [], result.candidates?.[0]?.finishReason, result.usageMetadata)
  }
  const parts = []
  let finishReason, usage
  const stream = await client.models.generateContentStream(request)
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    const candidate = chunk.candidates?.[0]
    for (const part of candidate?.content?.parts || []) {
      parts.push(part)
      if (part.text) onEvent({ type: part.thought ? 'reasoning' : 'text', delta: part.text })
    }
    finishReason = candidate?.finishReason || finishReason
    usage = chunk.usageMetadata || usage
  }
  return geminiMessage(parts, finishReason, usage)
}

module.exports = { geminiInput, geminiClient, geminiMessage, completeGemini }
