// 校验运营任务和来源，统一定时计算及原型字段，不隐式扩大任务授权。
const { uid } = require('./store.cjs')
const { publicUrl, cleanTemplateHtml, templateText } = require('./content.cjs')

const MODES = new Set(['draft_only', 'draft_notify', 'auto_publish'])
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function normalizeCover(value) {
  if (!value) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('封面信息无效，请重新选择素材')
  const url = value.url ? publicUrl(String(value.url)) : ''
  const mediaId = String(value.mediaId || '').trim()
  const fileId = String(value.fileId || '').trim()
  if (!url && !mediaId) throw new Error('请选择已有图片素材作为封面')
  if (mediaId.length > 512) throw new Error('封面素材编号无效')
  if (fileId && !/^\d+$/.test(fileId)) throw new Error('封面文件编号无效')
  return { url, mediaId, fileId }
}

function normalizeTask(input, existing, accountId, sources) {
  const task = { ...existing, ...input }
  if (task.type === 'assistant') return normalizeAssistantTask(input, existing, accountId)
  if (!task.name?.trim()) throw new Error('请填写任务名称')
  const topic = String(task.topic || task.instruction || '').trim()
  if (!topic) throw new Error('请填写任务要写的内容')
  const schedule = { ...existing?.schedule, ...input.schedule }
  if (!['daily', 'weekly'].includes(schedule.repeat)
    || !TIME.test(schedule.prepareAt) || !TIME.test(schedule.publishAt)) throw new Error('任务时间设置不完整')
  if (schedule.repeat === 'weekly' && (!Number.isInteger(schedule.weekday)
    || schedule.weekday < 1 || schedule.weekday > 7)) throw new Error('请选择每周执行的星期')
  if (!MODES.has(task.mode)) throw new Error('请选择有效的执行方式')
  const sourceIds = [...new Set(task.sourceIds || [])]
  if (!sourceIds.length) throw new Error('请至少选择一个资讯来源')
  if (sourceIds.some((id) => !sources.some((source) => source.id === id))) throw new Error('资讯来源不存在')
  return {
    id: existing?.id || uid('t'), accountId, name: task.name.trim(), topic,
    style: String(task.style || ''), schedule,
    mode: task.mode, sourceIds, massNotify: task.massNotify === true, enabled: task.enabled !== false,
    cover: normalizeCover(task.cover), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }
}

function normalizeAssistantTask(input, existing, accountId) {
  const task = { ...existing, ...input }
  if (typeof task.name !== 'string' || !task.name.trim()) throw new Error('请填写任务名称')
  if (typeof task.content !== 'string' || !task.content.trim()) throw new Error('请填写到点发送给 Bot 的任务内容')
  const schedule = { ...existing?.schedule, ...input.schedule }
  if (!TIME.test(schedule.time || '') || !['daily', 'weekly'].includes(schedule.repeat)) {
    throw new Error('请选择执行时间与重复方式')
  }
  const weekdays = schedule.repeat === 'daily' ? [] : [...new Set(schedule.weekdays || [])]
  if (schedule.repeat === 'weekly' && (!weekdays.length
    || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7))) {
    throw new Error('请至少选择一个有效的星期')
  }
  const publication = { mode: task.publication?.mode || 'confirm' }
  if (!['confirm', 'publish', 'mass'].includes(publication.mode)) throw new Error('请选择有效的定时发表方式')
  return {
    id: existing?.id || uid('t'), accountId, type: 'assistant', name: task.name.trim(),
    content: task.content.trim(), publication, schedule: { time: schedule.time, repeat: schedule.repeat, weekdays: weekdays.sort() },
    enabled: task.enabled !== false, createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }
}

function normalizeShortcut(input, existing, accountId) {
  const shortcut = { ...existing, ...input }
  if (typeof shortcut.name !== 'string' || !shortcut.name.trim()) throw new Error('请填写快捷语句名称')
  if (typeof shortcut.content !== 'string' || !shortcut.content.trim()) throw new Error('请填写快捷语句内容')
  return {
    id: existing?.id || uid('shortcut'), accountId, name: shortcut.name.trim(),
    content: shortcut.content.trim(), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }
}

// 文章模板：一篇排好版的范文（字号、颜色、行距、缩进等都在范文里）和结构要求；Bot 写稿时照着写、照着排
function templateHtml(value) {
  const html = cleanTemplateHtml(value)
  if (!templateText(html) && !/<img\s/i.test(html)) throw new Error('请在模板里写一篇范文或添加配图')
  return html
}

function normalizeTemplate(input, existing, accountId) {
  const value = { ...existing, ...input }
  const field = key => String(value[key] || '').trim()
  const name = field('name')
  if (!name) throw new Error('请填写模板名称')
  return {
    id: existing?.id || uid('tpl'), accountId, name, description: field('description'),
    html: templateHtml(value.html), structure: String(value.structure || '').trim(), isDefault: value.isDefault === true,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }
}

function latestAssistantSlot(task, now = Date.now()) {
  for (let daysBack = 0; daysBack <= 7; daysBack += 1) {
    const day = new Date(now)
    day.setDate(day.getDate() - daysBack)
    const slot = timeOnDay(task.schedule.time, day)
    if (slot > now) continue
    if (task.schedule.repeat === 'weekly' && !task.schedule.weekdays.includes(new Date(slot).getDay() || 7)) continue
    if (slot < Math.max(task.createdAt || 0, task.updatedAt || 0)) return null
    return { slot, expired: now - slot > 24 * 60 * 60 * 1000 }
  }
  return null
}

function normalizeSource(input, existing, accountId) {
  const source = { ...existing, ...input }
  let target = String(source.url || source.target || '').trim()
  if (!target) throw new Error('请填写资讯网址或 RSS 地址')
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`
  const url = publicUrl(target)
  return {
    id: existing?.id || uid('s'), accountId, name: String(source.name || new URL(url).hostname),
    url, target: url, kind: /rss|feed|\.xml/i.test(url) ? 'RSS' : '网页', enabled: source.enabled !== false,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }
}

function timeOnDay(time, date) {
  const day = new Date(date)
  const [hour, minute] = time.split(':').map(Number)
  day.setHours(hour, minute, 0, 0)
  return day.getTime()
}

function dueSlot(task, now) {
  const slot = timeOnDay(task.schedule.prepareAt, now)
  const weekday = new Date(slot).getDay() || 7
  if (task.schedule.repeat === 'weekly' && weekday !== task.schedule.weekday) return null
  if (slot > now || now - slot > 2 * 60 * 1000) return null
  if (Math.max(task.createdAt, task.updatedAt || 0) > slot) return null
  return slot
}

function publicationTime(task, startedAt) {
  const planned = timeOnDay(task.schedule.publishAt, startedAt)
  const prepare = timeOnDay(task.schedule.prepareAt, startedAt)
  if (planned >= prepare) return planned
  const next = new Date(planned)
  next.setDate(next.getDate() + 1)
  return next.getTime()
}

module.exports = {
  normalizeTask, normalizeSource, normalizeCover, normalizeShortcut, normalizeTemplate, latestAssistantSlot, dueSlot, publicationTime,
}
