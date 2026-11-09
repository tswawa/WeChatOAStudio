// 任务执行：按「采集 → 去重筛选 → 撰写排版 → 存入草稿箱 → 发表」逐步推进（原型里每步是模拟延时）。
// 到点执行按任务的执行方式收尾；手动试写只存草稿。runInChat 是到点、试写共用的入口，过程显示在聊天里
import { db, addRun, saveDraft, newDraftShell, apiPublishOf, publishDraft, plannedPublishAt, massQuota } from '../store/workspace.js'
import { dailyBriefHtml, guideHtml, plainText } from '../store/seed/articles.js'
import { pushBot, pushCard } from './chatStore.js'
import { TASK_MODES } from '../store/taskModes.js'
import { uid } from '../utils/time.js'
import { executeAction } from '../store/workspace.js'
import { isDesktop } from '../services/desktop.js'
import { toast } from '../store/ui.js'

const STEP_DELAY = 900

// 演示内容：两个演示账号各写各的题材（接入模型后由模型按任务设置生成）
const DEMO_CONTENT = {
  a1: { html: dailyBriefHtml, select: '保留 4 条，跳过 5 条已写过的旧闻', cover: ['#0f9d58', '#34a0a4'] },
  a2: { html: guideHtml, select: '选中 1 个高频问题，跳过已写过的 3 个', cover: ['#13c2c2', '#73e0e0'] },
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function usesApi(task) {
  return task.mode === 'auto_publish' && apiPublishOf(task.accountId).ready
}

function buildSteps(task, trial) {
  const publishLabel = trial || task.mode === 'draft_only' ? '发表' : usesApi(task) ? '接口发表' : '扫码发表'
  const labels = ['采集资讯', '去重筛选', '撰写排版', '存入草稿箱', publishLabel]
  return ['collect', 'select', 'write', 'draft', 'publish'].map((key, index) => ({
    key,
    label: labels[index],
    state: 'pending',
    note: '',
  }))
}

function stepNotes(task) {
  const sources = db.data[task.accountId].sources.filter((item) => task.sourceIds.includes(item.id))
  const content = DEMO_CONTENT[task.accountId]
  return {
    collect: `${sources.length} 个来源，${28 + sources.length * 4} 条`,
    select: content.select,
    write: `${plainText(content.html()).length} 字，排版检查通过`,
    draft: '已保存到草稿箱',
  }
}

function createDraft(task) {
  const draft = newDraftShell(task.accountId)
  const day = new Date()
  const content = DEMO_CONTENT[task.accountId]
  Object.assign(draft, {
    title: `${task.name}｜${day.getMonth() + 1}月${day.getDate()}日`,
    digest: task.topic,
    html: content.html(),
    cover: { from: content.cover[0], to: content.cover[1], label: task.name.slice(0, 6) },
    origin: 'bot',
    taskId: task.id,
    massNotify: task.massNotify,
  })
  return saveDraft(draft, task.accountId)
}

function finish(run, task, draft, trial) {
  const publish = run.steps[4]
  if (trial || task.mode === 'draft_only') {
    run.status = 'drafted'
    Object.assign(publish, { state: 'skipped', note: trial ? '试写，只存草稿' : '按设置只存草稿' })
    return
  }
  // 接口发表：定时到任务的发表时间，不需要扫码；群发次数用完时只发表不推送
  if (usesApi(task)) {
    const planned = plannedPublishAt(run)
    const massNotify = task.massNotify && massQuota(task.accountId, planned).left > 0
    run.quotaFull = task.massNotify && !massNotify
    run.status = 'drafted'
    if (planned <= Date.now()) publishDraft(draft.id, { mode: 'now', massNotify }, task.accountId)
    else publishDraft(draft.id, { mode: 'schedule', scheduledAt: planned, massNotify, via: 'app' }, task.accountId)
    return
  }
  run.status = 'waiting_scan'
  Object.assign(publish, { state: 'pending', note: '等待管理员或运营者扫码' })
}

// 停止：当前步骤和后面的步骤都标为跳过，不生成草稿
function stop(run, current) {
  Object.assign(current, { state: 'skipped', note: '已停止' })
  run.steps.filter((step) => step.state === 'pending').forEach((step) => (step.state = 'skipped'))
  run.status = 'cancelled'
  return run
}

export function requestStop(run) {
  if (isDesktop) {
    return executeAction('run.stop', { id: run.id }, run.accountId).catch((error) => {
      toast(error.message, 'warn')
      console.error('停止任务失败：', error)
    })
  }
  run.stopRequested = true
}

export function isRunning(taskId) {
  return db.runs.some((run) => run.taskId === taskId && run.status === 'running')
}

async function execute(run, task, trial) {
  const notes = stepNotes(task)
  for (const step of run.steps.slice(0, 4)) {
    step.state = 'active'
    await wait(STEP_DELAY)
    if (run.stopRequested) return stop(run, step)
    Object.assign(step, { state: 'done', note: notes[step.key] })
  }
  const draft = createDraft(task)
  run.draftId = draft.id
  finish(run, task, draft, trial)
  return run
}

const RESULT_TEXT = {
  waiting_scan: '写好了，已存入草稿箱。发表需要管理员或运营者扫码，点卡片里的「去发表」，默认定时到任务的发表时间。',
  scheduled: '写好了，到发表时间会通过开发接口自动发表，不用扫码。到时需要应用在运行。',
  succeeded: '已通过开发接口发表，可以在「发表记录」里看到。',
  drafted: '写好了，已存入草稿箱。要发表就点「去发表」，需要管理员或运营者扫码。',
  cancelled: '已停止，没有生成草稿。',
}

function resultText(run) {
  return RESULT_TEXT[run.status] + (run.quotaFull ? '群发次数已用完，这次只发表不推送。' : '')
}

// 在任务所属公众号的会话里开一张运行卡片并执行；trial = 手动试写
export async function runInChat(task, { trial = false } = {}) {
  if (isDesktop) return executeAction('task.run', { id: task.id, trial }, task.accountId)
  if (isRunning(task.id)) {
    pushBot(`「${task.name}」正在执行，等这次结束再试。`, task.accountId)
    return null
  }
  const intro = trial
    ? `按「${task.name}」的设置试写一篇。写好放进草稿箱，不会自动发表。`
    : `到准备时间了，开始执行「${task.name}」（${TASK_MODES[task.mode].label}）。`
  pushBot(intro, task.accountId)
  const run = addRun({
    id: uid('r'),
    taskId: task.id,
    accountId: task.accountId,
    startedAt: Date.now(),
    status: 'running',
    steps: buildSteps(task, trial),
  })
  pushCard({ type: 'run', runId: run.id }, task.accountId)
  await execute(run, task, trial)
  pushBot(resultText(run), task.accountId)
  return run
}
