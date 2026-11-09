// Estimate context with the local tiktoken encoder and reserve space before API calls.
const { Tiktoken } = require('js-tiktoken/lite')
const ranks = require('js-tiktoken/ranks/o200k_base')
const { modelBudget } = require('./config.cjs')
let tokenizer

function encoder() {
  tokenizer ||= new Tiktoken(ranks)
  return tokenizer
}

function tokens(text) {
  return encoder().encode(String(text || ''), [], []).length
}

function truncate(text, limit) {
  const encoded = encoder().encode(String(text || ''), [], [])
  return encoded.length <= limit ? String(text || '') : encoder().decode(encoded.slice(0, Math.max(0, limit)))
}

function estimate(messages, tools = []) {
  let images = 0
  const textMessages = messages.map(message => {
    if (!Array.isArray(message.content)) return message
    return { ...message, content: message.content.map(part => {
      if (part.type !== 'image_url' && part.type !== 'input_image') return part
      images += 1
      return { type: part.type, image: '[image pixels]' }
    }) }
  })
  // Bound image accounting independently of its base64 wire representation.
  return 32 + images * 4096 + textMessages.reduce((total, message) => total + 16 + tokens(JSON.stringify(message)), 0)
    + (tools.length ? 32 + tokens(JSON.stringify(tools)) : 0)
}

function toolOutput(value, limit) {
  const text = JSON.stringify(value)
  if (tokens(text) <= limit) return text
  return JSON.stringify({
    truncated: true,
    notice: '结果超过本轮上下文预算，仅返回预览。请缩小查询范围或读取具体记录。',
    preview: truncate(text, Math.max(128, limit - 160)),
  })
}

module.exports = { tokens, truncate, estimate, budget: modelBudget, toolOutput }
