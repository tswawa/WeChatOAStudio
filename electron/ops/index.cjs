// 汇总运营工作区操作，为桌面界面提供真实业务入口。
const { createOpsStore } = require('./store.cjs')
const { createSettingsStore } = require('./settings.cjs')
const { normalizeTask, normalizeSource, normalizeShortcut, normalizeTemplate } = require('./tasks.cjs')
const { createRunner } = require('./runner.cjs')
const { createChat } = require('./chat.cjs')
const { completion } = require('./model.cjs')
const { reconcilePublished } = require('./published.cjs')
const { createAlarmScheduler } = require('./alarms.cjs')
const { initializeShortcuts } = require('./shortcuts.cjs')
const { normalizeModel } = require('../bot/config.cjs')
const { createImageService } = require('../images/index.cjs')
const { createSearchRouter } = require('./search.cjs')
const { createImageNetwork } = require('../images/network.cjs')
const { initializeBotPreset } = require('../bot/preset.cjs')
const { createAttachmentService } = require('../bot/attachments.cjs')
const path = require('node:path')

function createOpsService({ dbPath, settingsPath, mp, notify, getAccount, imageDirectory = '', legacyImageDirectory = '', getImageProxy }) {
  const store = createOpsStore(dbPath)
  const settings = createSettingsStore(settingsPath, undefined, { imageDirectory, legacyImageDirectory })
  for (const accountId of new Set(store.all('bot_memories').map(item => item.accountId))) {
    initializeBotPreset(store, accountId, settings.private().bot)
  }
  const network = createImageNetwork({ getProxy: getImageProxy })
  const search = createSearchRouter({ settings, network })
  const attachments = createAttachmentService({ store, directory: path.join(path.dirname(dbPath), 'BotAttachments') })
  const images = createImageService({ store, settings, mp, defaultDirectory: imageDirectory, network, searcher: search.images,
    readAttachment: (accountId,id) => attachments.file(accountId,id) })
  const web = { search: search.web, network }
  const runner = createRunner({ store, settings, mp, notify, getAccount, network })
  let alarms = null
  let closed = false
  function requireRecord(name, accountId, id) {
    if (typeof id !== 'string' || !id) throw new Error('缺少记录编号')
    const record = store.get(name, accountId, id)
    if (!record) throw new Error('记录不存在或不属于当前公众号')
    return record
  }
  function snapshot(accountId) {
    if (!getAccount(accountId)) throw new Error('公众号不存在')
    initializeShortcuts(store, accountId)
    initializeBotPreset(store, accountId, settings.private().bot)
    return {
      tasks: store.list('tasks', accountId),
      runs: store.list('runs', accountId).reverse(),
      sources: store.list('sources', accountId),
      messages: chat.messages(accountId),
      bot: chat.snapshot(accountId),
      shortcuts: store.list('shortcuts', accountId),
      templates: store.list('templates', accountId),
      settings: settings.get(),
    }
  }
  async function act(action, accountId, payload) {
    let result
    if (action === 'task.save') {
      const existing = payload.id ? requireRecord('tasks', accountId, payload.id) : null
      const sources = store.list('sources', accountId)
      const added = (payload.type === 'assistant' || existing?.type === 'assistant' ? [] : payload.sources || [])
        .map((source) => normalizeSource(source, null, accountId))
      const task = normalizeTask({
        ...payload, sourceIds: [...(payload.sourceIds || existing?.sourceIds || []), ...added.map((source) => source.id)],
      }, existing, accountId, [...sources, ...added])
      if (task.type === 'assistant' && task.publication.mode !== 'confirm' && !mp.getApiConfig?.(accountId)?.connected) throw new Error('请先接入官方接口，再授权定时发表或群发')
      task.updatedAt = Date.now()
      if (task.type === 'assistant') task.publication = { ...task.publication, authorizedAt: Date.now() }
      for (const source of added) store.put('sources', accountId, source)
      result = store.put('tasks', accountId, task)
    } else if (action === 'task.toggle') {
      const task = requireRecord('tasks', accountId, payload.id)
      if (typeof payload.enabled !== 'boolean') throw new Error('缺少任务启停状态')
      result = store.put('tasks', accountId, { ...task, enabled: payload.enabled, updatedAt: Date.now() })
    } else if (action === 'task.delete') {
      requireRecord('tasks', accountId, payload.id)
      const runs = store.list('runs', accountId).filter((run) => run.taskId === payload.id)
      if (runs.some((run) => run.status === 'running')) throw new Error('请先停止正在执行的任务')
      for (const run of runs) {
        if (run.status === 'scheduled') runner.stop(accountId, run.id)
        store.remove('runs', accountId, run.id)
      }
      store.remove('tasks', accountId, payload.id)
      result = { deleted: true }
    } else if (action === 'task.run') {
      const task = requireRecord('tasks', accountId, payload.id)
      result = task.type === 'assistant' ? alarms.start(accountId, task, { trial: payload.trial === true })
        : runner.start(accountId, task, { trial: payload.trial !== false })
    } else if (action === 'run.stop') {
      const run = requireRecord('runs', accountId, payload.id)
      result = run.type === 'assistant' ? alarms.stop(accountId, payload.id) : runner.stop(accountId, payload.id)
    } else if (action === 'source.save') {
      const existing = payload.id ? requireRecord('sources', accountId, payload.id) : null
      result = store.put('sources', accountId, normalizeSource(payload, existing, accountId))
    } else if (action === 'source.delete') {
      requireRecord('sources', accountId, payload.id)
      if (store.list('tasks', accountId).some((task) => task.sourceIds?.includes(payload.id))) {
        throw new Error('这个来源仍被运营任务使用，请先修改任务')
      }
      store.remove('sources', accountId, payload.id)
      result = { deleted: true }
    } else if (action === 'shortcut.save') {
      const existing = payload.id ? requireRecord('shortcuts', accountId, payload.id) : null
      result = store.put('shortcuts', accountId, normalizeShortcut(payload, existing, accountId))
    } else if (action === 'shortcut.delete') {
      requireRecord('shortcuts', accountId, payload.id)
      store.remove('shortcuts', accountId, payload.id)
      result = { deleted: true }
    } else if (action === 'template.save') {
      const existing = payload.id ? requireRecord('templates', accountId, payload.id) : null
      const template = normalizeTemplate(payload, existing, accountId)
      // 只能有一个默认模板
      if (template.isDefault) {
        for (const other of store.list('templates', accountId)) {
          if (other.id !== template.id && other.isDefault) store.put('templates', accountId, { ...other, isDefault: false })
        }
      }
      result = store.put('templates', accountId, template)
    } else if (action === 'template.delete') {
      requireRecord('templates', accountId, payload.id)
      store.remove('templates', accountId, payload.id)
      result = { deleted: true }
    } else throw new Error('不支持的运营操作')
    notify(accountId)
    return result
  }
  const chat = createChat({ store, settings, mp, notify, getAccount, act, images, web, attachments })
  alarms = createAlarmScheduler({ store, chat, notify, getAccount, mp })
  async function handle(action, accountId, payload = {}) {
    if (closed) throw new Error('应用正在关闭')
    if (!getAccount(accountId)) throw new Error('请先登录公众号')
    initializeShortcuts(store, accountId)
    initializeBotPreset(store, accountId, settings.private().bot)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('操作参数无效')
    if (action === 'settings.get') return settings.get()
    if (action === 'settings.save') {
      const result = settings.save(payload)
      notify(accountId)
      return result
    }
    if (action === 'settings.test') {
      const model = normalizeModel(payload.model, settings.private().model)
      const transient = { private: () => ({ model }) }
      const response = await completion(transient, [{ role: 'user', content: '请只回答：连接成功' }])
      return { ok: true, message: response.content }
    }
    if (action === 'template.image.prepare') return require('./template-images.cjs').prepareTemplateImage(payload)
    if (action === 'chat.attachment.prepare') return attachments.prepare(accountId, payload)
    if (action === 'workspace.get') return snapshot(accountId)
    if (action === 'chat.send') return chat.send(accountId, payload)
    if (action === 'chat.confirm') return chat.confirm(accountId, payload.messageId, payload.payload)
    if (action === 'chat.cancel') return chat.cancel(accountId, payload.messageId)
    if (action === 'chat.image.remove') return chat.removeImage(accountId, payload.messageId, payload.imageId)
    if (action === 'images.list') return images.list(accountId)
    if (action === 'chat.clear') return chat.clear(accountId)
    if (action === 'chat.stop') return chat.stop(accountId)
    if (action === 'chat.session.new') return chat.newSession(accountId)
    if (action === 'chat.session.select') return chat.selectSession(accountId, payload.id)
    if (action === 'chat.session.delete') return chat.deleteSession(accountId, payload.id)
    if (action === 'memory.list') return chat.memory.list(accountId, payload.query)
    if (action === 'memory.save' || action === 'memory.delete') {
      const result = action === 'memory.save' ? chat.memory.save(accountId, payload)
        : chat.memory.remove(accountId, payload.id)
      notify(accountId)
      return result
    }
    return act(action, accountId, payload)
  }
  return {
    handle, snapshot, getPrivateSettings: settings.private,
    attachmentFile(accountId,id) {
      if (closed || !getAccount(accountId)) throw new Error('公众号不存在或应用正在关闭')
      return attachments.file(accountId,id)
    },
    imageFile(accountId, id) {
      if (closed || !getAccount(accountId)) throw new Error('公众号不存在或应用正在关闭')
      return images.file(accountId, id)
    },
    reconcilePublished(accountId, published) {
      if (closed) throw new Error('应用正在关闭')
      if (!getAccount(accountId)) throw new Error('公众号不存在')
      return reconcilePublished(store, accountId, published, notify)
    },
    async close() {
      closed = true
      await alarms.close()
      await chat.close()
      await images.close()
      await attachments.close()
      await runner.close()
      store.close()
    },
  }
}

module.exports = { createOpsService }
