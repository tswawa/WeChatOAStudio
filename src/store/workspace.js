// 业务数据：各公众号的内容与互动数据、发表规则（群发次数、接口发表条件）、运营任务与运行记录
import { reactive, computed, watch } from 'vue'
import { accounts, session } from './session.js'
import { aiObserverData } from './seed/aiObserver.js'
import { demoTechData } from './seed/demoTech.js'
import { seedTasks, seedRuns } from './seed/tasks.js'
import { uid, fmtDateTime, onDayOf } from '../utils/time.js'
import { isDesktop } from '../services/desktop.js'
import { invokeAction, subscribeWorkspace } from '../services/workspace.js'
import { emptyWorkspace } from './emptyWorkspace.js'
import { settings } from './settings.js'

export const db = reactive({
  data: isDesktop ? {} : { a1: aiObserverData(), a2: demoTechData() },
  tasks: isDesktop ? [] : seedTasks(),
  runs: isDesktop ? [] : seedRuns(),
})

const empty = emptyWorkspace()
export const ws = computed(() => db.data[session.accountId] || empty)
export const workspaceState = reactive({ loading: false, error: '', revision: 0 })
const loadingAccounts = new Map()

const PAGE_SECTIONS = {
  home: ['drafts', 'published', 'comments', 'data', 'income'],
  income: ['income'],
  assistant: ['drafts', 'data'],
  bot: [],
  tasks: [],
  drafts: ['drafts'],
  templates: [],
  materials: ['materials'],
  published: ['published'],
  data: ['data'],
  comments: ['comments'],
  messages: ['messages'],
  autoReply: ['autoReply'],
  menu: ['menu'],
  users: ['users'],
  account: ['account'],
  members: ['members'],
  api: [],
}

export function workspaceSection(path = '/home') {
  const name = path.split('/').filter(Boolean)[0] || 'home'
  return { 'auto-reply': 'autoReply', 'dev-api': 'api', editor: 'drafts' }[name] || name
}

export function sectionSyncing(section) {
  const busy = ws.value.syncingSections || []
  return (PAGE_SECTIONS[section] || []).some((key) => busy.includes(key))
}

export async function loadWorkspace(accountId = session.accountId) {
  if (!isDesktop || !accountId) return
  if (loadingAccounts.has(accountId)) return loadingAccounts.get(accountId)
  if (!db.data[accountId]) db.data[accountId] = emptyWorkspace()
  workspaceState.loading = true
  const request = invokeAction('workspace.get', {}, accountId).then((snapshot) => {
    const { tasks = [], runs = [], ...data } = snapshot
    Object.assign(db.data[accountId], data, { loaded: true })
    if (data.settings) {
      Object.assign(settings.model, data.settings.model, { apiKey: '' })
      Object.assign(settings.bot, data.settings.bot)
      Object.assign(settings.images, data.settings.images)
      Object.assign(settings.search, data.settings.search)
    }
    db.tasks = [...db.tasks.filter((item) => item.accountId !== accountId), ...tasks]
    db.runs = [...db.runs.filter((item) => item.accountId !== accountId), ...runs]
    if (session.accountId === accountId) workspaceState.error = ''
    workspaceState.revision += 1
  }).catch((error) => {
    if (session.accountId === accountId) workspaceState.error = error.message
    console.error('读取工作区失败：', error)
  }).finally(() => {
    loadingAccounts.delete(accountId)
    workspaceState.loading = loadingAccounts.size > 0
  })
  loadingAccounts.set(accountId, request)
  return request
}

export async function refreshWorkspace(section = 'home', { force = true, accountId = session.accountId } = {}) {
  if (!isDesktop || !accountId) return
  const result = await invokeAction('content.refresh', { section, force }, accountId)
  await loadWorkspace(accountId)
  return result
}

export async function executeAction(action, payload = {}, accountId = session.accountId) {
  const result = await invokeAction(action, payload, accountId)
  if (loadingAccounts.has(accountId)) await loadingAccounts.get(accountId)
  await loadWorkspace(accountId)
  return result
}

if (isDesktop) {
  watch(() => session.accountId, (id) => loadWorkspace(id), { immediate: true })
  const refreshTimers = new Map()
  subscribeWorkspace(({ accountId }) => {
    clearTimeout(refreshTimers.get(accountId))
    refreshTimers.set(accountId, setTimeout(() => {
      refreshTimers.delete(accountId)
      loadWorkspace(accountId)
    }, 80))
  })
}

// 稿件已写好、还没发表的运行状态
const OPEN_RUN = ['waiting_scan', 'scheduled', 'drafted']

const accountOf = (accountId) => accounts.find((item) => item.id === accountId)

// 群发通知次数：公众号每天 1 次，服务号每月 4 次，按发表日期所在的天/月计算。
// 已群发的文章和已定时且开启群发的草稿都占次数；关闭群发通知的发表不占次数
// excludeDraftId：正在发表的这篇本身已定时的话，不算进已用次数
export function massQuota(accountId, ts = Date.now(), excludeDraftId = null) {
  if (isDesktop) {
    return db.data[accountId]?.massQuota || { total: '—', left: '—', period: '以公众平台为准' }
  }
  if (!accountOf(accountId)) return { total: 0, left: 0, period: '' }
  const monthly = accountOf(accountId).type === '服务号'
  const key = (time) => {
    const date = new Date(time)
    return monthly ? `${date.getFullYear()}-${date.getMonth()}` : date.toDateString()
  }
  const data = db.data[accountId]
  const used = [
    ...data.published.filter((item) => item.mass).map((item) => item.at),
    ...data.drafts
      .filter((item) => item.scheduledAt && item.massNotify && item.id !== excludeDraftId)
      .map((item) => item.scheduledAt),
  ].filter((time) => key(time) === key(ts)).length
  const total = monthly ? 4 : 1
  const sameAsNow = key(ts) === key(Date.now())
  const period = monthly ? (sameAsNow ? '本月' : '当月') : sameAsNow ? '今日' : '当天'
  return { total, left: Math.max(0, total - used), period }
}

// API readiness follows the configured connection and observed WeChat response, not a local subject guess.
export function apiPublishOf(accountId) {
  const account = accountOf(accountId)
  if (!account) return { eligible: false, ready: false, massReady: false }
  const api = db.data[accountId]?.api || {}
  const permits = kind => !['denied', 'verification_required'].includes(api.capabilities?.[kind]?.state)
  return { eligible: true, connected: api.connected === true, ready: api.connected === true && permits('publish'),
    massReady: api.connected === true && permits('mass'), capabilities: api.capabilities || {} }
}

function publishStep(run) {
  return run.steps.find((item) => item.key === 'publish')
}

function openRunOf(draftId) {
  return db.runs.find((item) => item.draftId === draftId && OPEN_RUN.includes(item.status))
}

// 发表：mode = 'now' | 'schedule'。扫码验证在弹窗里完成后再调用；定时发表到点由 releaseDueDrafts 发出
// via：'mp' 扫码后在公众平台定时，应用关闭也会发出；'app' 由本应用到点通过开发接口发表，需要应用在运行
export function publishDraft(draftId, { mode, scheduledAt, massNotify, via = 'mp' }, accountId = session.accountId) {
  const data = db.data[accountId]
  const draft = data.drafts.find((item) => item.id === draftId)
  const run = openRunOf(draftId)
  if (mode === 'schedule') {
    Object.assign(draft, { scheduledAt, massNotify, scheduledVia: via })
    if (run) {
      if (run.status !== 'scheduled') run.restStatus = run.status
      run.status = 'scheduled'
      const by = via === 'app' ? '由应用通过接口发表' : '由公众平台发表'
      const note = `已定时 ${fmtDateTime(scheduledAt)} ${by}` + (massNotify ? '，群发通知' : '')
      Object.assign(publishStep(run), { state: 'active', note })
    }
    return
  }
  data.drafts = data.drafts.filter((item) => item.id !== draftId)
  data.published.unshift({
    id: uid('p'),
    title: draft.title,
    at: Date.now(),
    mass: massNotify,
    reads: 0,
    likes: 0,
    shares: 0,
    comments: 0,
    origin: draft.origin,
    cover: draft.cover,
  })
  if (!run) return
  Object.assign(run, { status: 'succeeded', publishedId: data.published[0].id })
  Object.assign(publishStep(run), { state: 'done', note: '已发表' + (massNotify ? '，群发通知' : '，不推送') })
}

// 到点的定时草稿自动发表（验证已在设置定时时完成）；由页面计时器每分钟调用
export function releaseDueDrafts() {
  accounts.forEach((account) => {
    db.data[account.id].drafts
      .filter((item) => item.scheduledAt && item.scheduledAt <= Date.now())
      .forEach((item) => publishDraft(item.id, { mode: 'now', massNotify: item.massNotify }, account.id))
  })
}

export function cancelSchedule(draftId) {
  if (isDesktop) return invokeAction('content.openPublish', { draftId })
  const draft = ws.value.drafts.find((item) => item.id === draftId)
  Object.assign(draft, { scheduledAt: null, scheduledVia: null })
  const run = db.runs.find((item) => item.draftId === draftId && item.status === 'scheduled')
  if (!run) return
  run.status = run.restStatus
  const step = run.status === 'drafted'
    ? { state: 'skipped', note: '已取消定时，草稿保留' }
    : { state: 'pending', note: '定时已取消，等待扫码发表' }
  Object.assign(publishStep(run), step)
}

// 删除草稿：对应的运行记录改为已跳过
export function deleteDraft(draftId) {
  if (isDesktop) return executeAction('content.deleteDraft', { draftId })
  ws.value.drafts = ws.value.drafts.filter((item) => item.id !== draftId)
  const run = openRunOf(draftId)
  if (!run) return
  run.status = 'skipped'
  Object.assign(publishStep(run), { state: 'skipped', note: '草稿已删除' })
}

export function saveDraft(draft, accountId = session.accountId) {
  if (isDesktop) return executeAction('content.saveDraft', { draft }, accountId)
  const list = db.data[accountId].drafts
  const index = list.findIndex((item) => item.id === draft.id)
  const next = { ...draft, updatedAt: Date.now() }
  if (index === -1) list.unshift(next)
  else list[index] = next
  return next
}

export function newDraftShell(accountId = session.accountId) {
  return {
    id: uid('d'),
    title: '',
    author: accountOf(accountId).name,
    digest: '',
    html: '',
    cover: { from: '#9aa5b1', to: '#c9d1d9', label: '封面' },
    origin: 'manual',
    updatedAt: Date.now(),
    scheduledAt: null,
    massNotify: false,
  }
}

export const tasksOfAccount = computed(() => db.tasks.filter((item) => item.accountId === session.accountId))

export function runsOfTask(taskId) {
  return db.runs.filter((item) => item.taskId === taskId).sort((a, b) => b.startedAt - a.startedAt)
}

export const pendingScans = computed(() =>
  db.runs.filter((run) => run.accountId === session.accountId && run.status === 'waiting_scan'),
)

export function addTask(task) {
  if (isDesktop) return executeAction('task.save', task)
  db.tasks.push({ ...task, id: uid('t'), accountId: session.accountId, enabled: true, createdAt: Date.now() })
  return db.tasks[db.tasks.length - 1]
}

// updatedAt 让到点执行跳过修改之前的时间点（例如 8:01 把准备时间改成 8:00，不会立刻补跑）
export function updateTask(taskId, patch) {
  if (isDesktop) {
    if ('enabled' in patch) return executeAction('task.toggle', { id: taskId, enabled: patch.enabled })
    return executeAction('task.save', { ...db.tasks.find((item) => item.id === taskId), ...patch, id: taskId })
  }
  const task = db.tasks.find((item) => item.id === taskId)
  if (task) Object.assign(task, patch, { updatedAt: Date.now() })
}

// 删除任务连同它的运行记录；已写好的草稿留在草稿箱
export function removeTask(taskId) {
  if (isDesktop) return executeAction('task.delete', { id: taskId })
  db.tasks = db.tasks.filter((item) => item.id !== taskId)
  db.runs = db.runs.filter((item) => item.taskId !== taskId)
}

// 等待扫码的稿件原定的发表时间：任务设置的发表时间，早于准备时间则算第二天
export function plannedPublishAt(run) {
  const task = db.tasks.find((item) => item.id === run.taskId)
  if (!task) return null
  const planned = onDayOf(run.startedAt, task.schedule.publishAt)
  return planned < run.startedAt ? planned + 24 * 60 * 60 * 1000 : planned
}

// 添加资讯来源：网址里带 rss / feed / .xml 的按 RSS 处理，其余按网页
export function addSource(url, name = '') {
  if (isDesktop) return executeAction('source.save', { url, name })
  const target = url.trim().replace(/^https?:\/\//, '')
  const kind = /rss|feed|\.xml/i.test(target) ? 'RSS' : '网页'
  const item = { id: uid('s'), name: name.trim() || target.split('/')[0], kind, target, enabled: true }
  ws.value.sources.push(item)
  return item
}

export function addRun(run) {
  db.runs.unshift(run)
  return db.runs[0]
}
