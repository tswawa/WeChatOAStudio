// 使用 Windows safeStorage 加密模型密钥，并向界面提供去除秘密的设置。
const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } = require('node:fs')
const { dirname } = require('node:path')
const { MODEL_DEFAULTS, BOT_DEFAULTS, normalizeModel, normalizeBot } = require('../bot/config.cjs')
const { IMAGE_DEFAULTS, normalizeImages } = require('../images/config.cjs')
const { SEARCH_DEFAULTS, normalizeSearch } = require('./search-config.cjs')

function createSettingsStore(filename, encryption = require('electron').safeStorage, { imageDirectory = '', legacyImageDirectory = '' } = {}) {
  const defaults = {
    model: { ...MODEL_DEFAULTS },
    bot: { ...BOT_DEFAULTS },
    images: { ...IMAGE_DEFAULTS, downloadDirectory: imageDirectory },
    search: structuredClone(SEARCH_DEFAULTS),
  }
  let current = structuredClone(defaults)
  const decrypt = (value) => value ? encryption.decryptString(Buffer.from(value, 'base64')) : ''
  if (existsSync(filename)) {
    const saved = JSON.parse(readFileSync(filename, 'utf8'))
    const model = { ...defaults.model, ...saved.model, apiKey: decrypt(saved.model?.encryptedKey) }
    current = {
      // Keep only current model fields; older versions also saved provider and output limits.
      model: Object.fromEntries(Object.keys(defaults.model).map((key) => [key, model[key]])),
      bot: { ...defaults.bot, ...saved.bot },
      images: normalizeImages(saved.images || {}, defaults.images),
      search: normalizeSearch(saved.search || {}, defaults.search),
    }
    if (current.model.reasoningEffort === 'default') current.model.reasoningEffort = ''
    if (!current.images.downloadDirectory || (legacyImageDirectory
      && require('node:path').resolve(current.images.downloadDirectory).toLowerCase() === require('node:path').resolve(legacyImageDirectory).toLowerCase())) {
      current.images = { ...defaults.images }
    }
    // Upgrade only legacy empty identity rules; an explicitly saved blank remains blank afterwards.
    if (saved.bot?.presetVersion === undefined && !String(saved.bot?.instructions || '').trim()) {
      current.bot.instructions = defaults.bot.instructions
    }
  }
  function persist(value) {
    if (!encryption.isEncryptionAvailable()) throw new Error('Windows 密钥加密暂不可用，无法保存设置')
    const saved = structuredClone(value)
    saved.model.encryptedKey = saved.model.apiKey
      ? encryption.encryptString(saved.model.apiKey).toString('base64') : ''
    delete saved.model.apiKey
    mkdirSync(dirname(filename), { recursive: true })
    writeFileSync(`${filename}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 })
    renameSync(`${filename}.tmp`, filename)
  }
  function publicValue() {
    const value = structuredClone(current)
    value.model.apiKeyConfigured = Boolean(value.model.apiKey)
    delete value.model.apiKey
    return value
  }
  function save(patch) {
    const next = structuredClone(current)
    if (patch.model) next.model = normalizeModel(patch.model, current.model)
    if (patch.bot) next.bot = normalizeBot(patch.bot, current.bot)
    if (patch.images) next.images = normalizeImages(patch.images, current.images)
    if (patch.search) next.search = normalizeSearch(patch.search, current.search)
    persist(next)
    current = next
    return publicValue()
  }
  if (!existsSync(filename)) persist(current)
  return { get: publicValue, private: () => structuredClone(current), save }
}

module.exports = { createSettingsStore }
