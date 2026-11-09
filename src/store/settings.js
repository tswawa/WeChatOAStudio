// 应用设置（所有公众号共用）：运营助手用的模型服务和 Bot 规则
import { reactive } from 'vue'
import { invokeAction } from '../services/workspace.js'
import { isDesktop } from '../services/desktop.js'
import defaults from '../../electron/bot/defaults.json'

export const settings = reactive({
  model: { ...defaults.model },
  bot: { ...defaults.bot },
  images: { ...defaults.images },
  search: { engines: [...defaults.search.engines] },
})

export async function loadSettings() {
  if (!isDesktop) return
  const saved = await invokeAction('settings.get')
  Object.assign(settings.model, saved.model, { apiKey: '' })
  Object.assign(settings.bot, saved.bot)
  Object.assign(settings.images, saved.images)
  Object.assign(settings.search, saved.search)
}

export async function saveSettings(value) {
  if (isDesktop) await invokeAction('settings.save', value)
  Object.assign(settings.model, value.model, isDesktop ? { apiKey: '' } : {})
  Object.assign(settings.bot, value.bot)
  Object.assign(settings.images, value.images)
  Object.assign(settings.search, value.search)
  if (isDesktop) await loadSettings()
}
