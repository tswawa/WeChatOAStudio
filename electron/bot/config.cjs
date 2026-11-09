// Validate shared Bot identity, the model context window and the user-written reasoning effort.
const { model: MODEL_DEFAULTS, bot: BOT_DEFAULTS } = require('./defaults.json')
const API_FORMATS = require('./api-formats.json')

function integer(value, min, max, label) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${label}必须是 ${min} 至 ${max} 的整数`)
  }
  return result
}

// The provider decides the actual output length; reserve a quarter of the window (at most 64K)
// for its reasoning and answer, plus a 5% safety margin for tokenizer differences.
function modelBudget(model) {
  const limit = model.contextWindow
  const output = Math.min(65536, Math.floor(limit / 4))
  const reserve = Math.max(1024, Math.ceil(limit * 0.05))
  return { limit, output, reserve, input: limit - output - reserve }
}

function normalizeModel(patch = {}, previous = MODEL_DEFAULTS) {
  const result = Object.fromEntries(Object.keys(MODEL_DEFAULTS)
    .map((key) => [key, previous[key] ?? MODEL_DEFAULTS[key]]))
  for (const key of ['baseUrl', 'name', 'apiFormat', 'reasoningEffort']) {
    if (patch[key] !== undefined) {
      if (typeof patch[key] !== 'string') throw new Error('模型配置格式无效')
      result[key] = patch[key].trim()
    }
  }
  const url = new URL(result.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('模型地址必须是 HTTP 或 HTTPS 接口地址')
  }
  result.baseUrl = url.href.replace(/\/$/, '')
  if (!API_FORMATS.some(format => format.id === result.apiFormat)) throw new Error('请选择有效的 API 格式')
  if (result.reasoningEffort === 'default') result.reasoningEffort = ''
  result.contextWindow = integer(patch.contextWindow ?? result.contextWindow, 1, Number.MAX_SAFE_INTEGER, '上下文窗口')
  if (patch.apiKey !== undefined && typeof patch.apiKey !== 'string') throw new Error('API Key 格式无效')
  if (patch.apiKey?.trim()) result.apiKey = patch.apiKey.trim()
  if (patch.clearApiKey === true) result.apiKey = ''
  return result
}

function normalizeBot(patch = {}, previous = BOT_DEFAULTS) {
  const result = { ...BOT_DEFAULTS, ...previous }
  for (const key of ['name', 'instructions']) {
    if (patch[key] !== undefined) {
      if (typeof patch[key] !== 'string') throw new Error('Bot 配置格式无效')
      result[key] = patch[key].trim()
    }
  }
  if (!result.name) throw new Error('请填写 Bot 名称')
  for (const key of ['memoryEnabled', 'autoRemember']) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('记忆设置格式无效')
    if (patch[key] !== undefined) result[key] = patch[key]
  }
  result.maxSteps = integer(patch.maxSteps ?? result.maxSteps, 1, Number.MAX_SAFE_INTEGER, '最大模型调用次数')
  return result
}

module.exports = { MODEL_DEFAULTS, BOT_DEFAULTS, normalizeModel, normalizeBot, modelBudget }
