// Native search is attempted first. Only an explicit unsupported result permits an engine fallback.
const { createHash } = require('node:crypto')
const { normalizeModel } = require('../bot/config.cjs')
const { publicImageUrl } = require('../images/network.cjs')

class NativeSearchUnsupported extends Error {}

function unsupported(error) {
  if ([404, 405, 501].includes(error.status)) return true
  const text = String(error.message || '')
  return [400, 422].includes(error.status) && /web[_ -]?search|google.?search|grounding|search_context_size|native.{0,10}search/i.test(text)
    && /unsupported|not supported|not available|unknown|unrecognized|does not support|not allowed|不支持|未提供/i.test(text)
}

function nativeDenial(text) {
  return /(?:没有|不具备|不支持|无法提供).{0,16}(?:原生|内置).{0,8}(?:联网|搜索)|(?:接口|模型).{0,12}(?:不支持|没有).{0,8}(?:联网搜索|web.?search)|(?:no|without|does not (?:have|support)|cannot use).{0,30}(?:native|built.in).{0,12}(?:web|search)/i.test(text)
}

function sources(output) {
  const found = []
  for (const item of output || []) {
    if (item.type === 'web_search_call') {
      for (const source of item.action?.sources || []) found.push({ title: source.title || '', url: source.url })
    }
    if (item.type === 'message') {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === 'url_citation') found.push({ title: annotation.title || '', url: annotation.url })
        }
      }
    }
  }
  return found
}

function cleanSources(values, limit = Infinity) {
  const result = []
  const seen = new Set()
  for (const item of values) {
    let url
    try { url = publicImageUrl(item.url).href } catch { continue }
    if (seen.has(url)) continue
    seen.add(url)
    result.push({ title: String(item.title || new URL(url).hostname).replace(/\s+/g, ' ').slice(0, 220), url,
      snippet: String(item.snippet || '').replace(/\s+/g, ' ').slice(0, 600) })
    if (result.length >= limit) break
  }
  return result
}

async function defaultClient(model) {
  if (model.apiFormat === 'anthropic') return require('./anthropic.cjs').anthropicClient(model, 45000)
  if (model.apiFormat === 'gemini') return require('./gemini.cjs').geminiClient(model, 45000)
  const { default: OpenAI } = await import('openai')
  return new OpenAI({ apiKey: model.apiKey, baseURL: model.baseUrl, timeout: 45000, maxRetries: 0 })
}

function createNativeSearch({ settings, clientFactory = defaultClient } = {}) {
  const capabilities = new Map()
  async function invoke(format, client, model, query, { signal, beforeModelCall, limit }) {
    beforeModelCall?.()
    const countRequest = Number.isSafeInteger(limit) ? `\n作者希望返回 ${limit} 个真实候选；来源不足时如实返回实际数量，不编造补足。` : ''
    const prompt = `请实际使用接口原生联网搜索检索以下关键词，并返回真实检索结果及来源链接。若接口没有原生联网搜索能力，请明确说明；不要用既有知识冒充搜索，也不要调用应用侧搜索引擎。${countRequest}\n关键词：${query}`
    let text = ''
    const references = []
    if (format === 'anthropic') {
      const result = await client.messages.create({ model: model.name, max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }], tools: [{ type: 'web_search_20250305', name: 'web_search' }] }, { signal })
      if (result.stop_reason !== 'end_turn') throw new Error('原生搜索响应未完成，未切换搜索源')
      const searched = result.content?.some(part => part.type === 'server_tool_use' && part.name === 'web_search')
      for (const part of result.content || []) {
        if (part.type === 'text') {
          text += part.text || ''
          if (searched) references.push(...(part.citations || []).filter(item => item.type === 'web_search_result_location')
            .map(item => ({ title: item.title, url: item.url })))
        }
        if (part.type === 'web_search_tool_result' && Array.isArray(part.content)) {
          references.push(...part.content.filter(item => item.type === 'web_search_result').map(item => ({ title: item.title, url: item.url })))
        }
        if (part.type === 'web_search_tool_result' && part.content?.type === 'web_search_tool_result_error') {
          throw new Error(`原生搜索工具失败：${part.content.error_code || 'unknown'}`)
        }
      }
    } else if (format === 'gemini') {
      const result = await client.models.generateContent({ model: model.name, contents: prompt,
        config: { tools: [{ googleSearch: {} }], abortSignal: signal } })
      const candidate = result.candidates?.[0]
      if (candidate?.finishReason !== 'STOP') throw new Error('原生搜索响应未完成，未切换搜索源')
      text = (candidate.content?.parts || []).map(part => part.thought ? '' : part.text || '').join('')
      const grounding = candidate.groundingMetadata
      if (grounding?.webSearchQueries?.length) references.push(...(grounding.groundingChunks || []).filter(item => item.web?.uri)
        .map(item => ({ title: item.web.title, url: item.web.uri })))
    } else if (format === 'responses') {
      const stream = await client.responses.create({ model: model.name, input: prompt,
        tools: [{ type: 'web_search' }], tool_choice: 'required',
        include: ['web_search_call.action.sources'], stream: true, store: false }, { signal })
      let completed
      for await (const event of stream) {
        if (event.type === 'response.completed') completed = event.response
        if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) {
          const failure = new Error(event.message || event.response?.error?.message || '原生搜索响应未完成')
          const code = String(event.code || event.response?.error?.code || '')
          if (/unsupported|unknown_tool|tool_not_supported/.test(code)) throw new NativeSearchUnsupported(failure.message)
          throw failure
        }
      }
      if (!completed || completed.status !== 'completed') throw new Error('原生搜索未正常完成，未切换搜索源')
      references.push(...sources(completed.output))
      text = (completed.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text').map(item => item.text).join('\n')
    } else {
      const stream = await client.chat.completions.create({ model: model.name,
        messages: [{ role: 'user', content: prompt }], web_search_options: {}, stream: true }, { signal })
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta || chunk.choices?.[0]?.message || {}
        if (delta.content) text += delta.content
        for (const annotation of delta.annotations || []) {
          if (annotation.type === 'url_citation') {
            const value = annotation.url_citation || annotation
            references.push({ title: value.title, url: value.url })
          }
        }
      }
    }
    const results = cleanSources(references)
    if (results.length) return { results, summary: text.slice(0, 4000), format }
    if (nativeDenial(text)) throw new NativeSearchUnsupported('接口明确表示没有原生联网搜索能力')
    throw new Error('原生搜索未返回可验证的检索来源，尚未切换到搜索引擎')
  }

  return {
    async search(query, options = {}) {
      const config = normalizeModel((options.settings || settings).private().model)
      if (!config.name || !config.apiKey) throw new Error('请先配置模型服务')
      const key = [config.baseUrl, config.name, config.apiFormat,
        createHash('sha256').update(config.apiKey).digest('hex').slice(0, 16)].join('|')
      const previous = capabilities.get(key)
      if (previous?.unsupported && Date.now() - previous.at < 10 * 60 * 1000) {
        return { supported: false, reason: previous.reason, checkedAt: previous.at }
      }
      const combined = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(45000)])
      const client = await clientFactory(config)
      const formats = previous?.format ? [previous.format] : ['anthropic', 'gemini'].includes(config.apiFormat)
        ? [config.apiFormat] : [config.apiFormat, config.apiFormat === 'responses' ? 'chat-completions' : 'responses']
      const reasons = []
      options.progress?.('正在检查模型原生联网搜索')
      for (const format of formats) {
        combined.throwIfAborted()
        try {
          const result = await invoke(format, client, config, query, { ...options, signal: combined })
          capabilities.set(key, { format, at: Date.now() })
          return { supported: true, provider: '模型原生搜索', ...result, fetchedAt: Date.now() }
        } catch (error) {
          if (options.signal?.aborted) throw options.signal.reason
          if (combined.aborted) throw new Error('模型原生搜索超时，未自动降级搜索源，请稍后重试')
          if (!(error instanceof NativeSearchUnsupported) && !unsupported(error)) {
            if ([401, 403, 429].includes(error.status)) throw new Error(`模型原生搜索访问受限（HTTP ${error.status}），未降级搜索源`)
            throw new Error(`模型原生搜索失败${error.status ? `（HTTP ${error.status}）` : ''}，未降级搜索源：${error.message}`)
          }
          reasons.push(`${format}: ${error instanceof NativeSearchUnsupported ? error.message : `接口不支持此搜索请求（HTTP ${error.status}）`}`)
        }
      }
      const value = { unsupported: true, reason: reasons.join('；'), at: Date.now() }
      capabilities.set(key, value)
      return { supported: false, reason: value.reason, checkedAt: value.at }
    },
  }
}

module.exports = { createNativeSearch, NativeSearchUnsupported, unsupported, nativeDenial, cleanSources }
