// 运营任务的执行方式、时间与运行状态文案：任务页、首页和聊天卡片共用
import { nextOccurrence, fmtDateTime } from '../utils/time.js'

export const TASK_MODES = {
  draft_only: { label: '只存草稿', desc: '写好后放进草稿箱，什么时候发由你决定' },
  draft_notify: { label: '存草稿并提醒扫码', desc: '写好后提醒你扫码；扫码时默认定时到发表时间' },
  auto_publish: { label: '到点自动发表', desc: '通过官方接口提交，权限与安全验证以微信返回为准' },
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export function scheduleText(schedule) {
  if (schedule.time) {
    const day = schedule.repeat === 'daily' ? '每天'
      : (schedule.weekdays || []).map((value) => '周' + WEEKDAYS[value - 1]).join('、')
    return `${day} ${schedule.time}`
  }
  const day = schedule.repeat === 'daily' ? '每天' : '每周' + WEEKDAYS[schedule.weekday - 1]
  return `${day} ${schedule.prepareAt} 准备，${schedule.publishAt} 发表`
}

export function nextRunText(task) {
  if (!task.enabled) return '已暂停'
  if (task.type === 'assistant') {
    const schedule = task.schedule
    const days = schedule.repeat === 'daily' ? [null] : schedule.weekdays || []
    const next = days.map((day) => nextOccurrence(schedule.time, day))
    return next.length ? '下次 ' + fmtDateTime(Math.min(...next)) : '未设置重复时间'
  }
  return '下次 ' + fmtDateTime(nextOccurrence(task.schedule.prepareAt, task.schedule.weekday))
}

export const RUN_STATUS = {
  running: { label: '执行中', tone: 'info' },
  waiting_scan: { label: '等待扫码', tone: 'warning' },
  scheduled: { label: '已定时', tone: 'info' },
  succeeded: { label: '已发表', tone: 'success' },
  drafted: { label: '已存草稿', tone: 'success' },
  skipped: { label: '已跳过', tone: 'muted' },
  cancelled: { label: '已停止', tone: 'muted' },
  failed: { label: '执行失败', tone: 'danger' },
  submitted: { label: '已提交微信', tone: 'info' },
  not_submitted: { label: '未提交发表', tone: 'warning' },
  waiting_verification: { label: '等待微信确认', tone: 'warning' },
  uncertain: { label: '结果待核实', tone: 'warning' },
  waiting_confirmation: { label: '等待确认', tone: 'warning' },
}

export function runStatus(run) {
  if (run?.type === 'assistant' && run.status === 'succeeded') return { label: '已完成', tone: 'success' }
  return RUN_STATUS[run?.status] || { label: '等待执行', tone: 'muted' }
}

export function taskModeText(task) {
  return task.type === 'assistant' ? '定时任务' : TASK_MODES[task.mode]?.label || '运营任务'
}
