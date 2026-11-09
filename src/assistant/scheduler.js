// 到点执行：页面开着时定期检查，准备时间刚到的任务开始执行。
// 同一个时间点只执行一次；任务在这个时间点之后才创建或修改的，从下一个时间点开始
import { db } from '../store/workspace.js'
import { runInChat } from './runner.js'
import { onDayOf } from '../utils/time.js'

const WINDOW = 2 * 60 * 1000

function slotOf(task, now) {
  const slot = onDayOf(now, task.schedule.prepareAt)
  const weekday = new Date(slot).getDay() || 7
  if (task.schedule.repeat === 'weekly' && weekday !== task.schedule.weekday) return null
  return slot <= now ? slot : null
}

export function runDueTasks(now = Date.now()) {
  db.tasks.forEach((task) => {
    const slot = slotOf(task, now)
    if (!task.enabled || !slot || now - slot > WINDOW || task.lastSlot === slot) return
    if (Math.max(task.createdAt, task.updatedAt || 0) > slot) return
    task.lastSlot = slot
    runInChat(task)
  })
}
