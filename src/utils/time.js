// 时间工具：相对今天生成时间点、格式化显示、计算下一次运行时间
const DAY = 24 * 60 * 60 * 1000

const pad = (value) => String(value).padStart(2, '0')

export function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 以今天为基准的时间戳：at(-1, '19:53') 表示昨天 19:53
export function at(dayOffset, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.getTime() + dayOffset * DAY
}

export function fmtTime(ts) {
  const date = new Date(ts)
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

export function fmtDay(ts) {
  const diff = Math.round((startOfDay(ts) - startOfDay(Date.now())) / DAY)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  const date = new Date(ts)
  return date.getMonth() + 1 + '月' + date.getDate() + '日'
}

export function fmtDateTime(ts) {
  return fmtDay(ts) + ' ' + fmtTime(ts)
}

export function fmtDateInput(ts) {
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${fmtTime(ts)}`
}

function startOfDay(ts) {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// 下一次到达 hh:mm 的时间；weekday 为 1-7（周一至周日）时按周计算
export function nextOccurrence(hhmm, weekday = null) {
  for (let offset = 0; offset <= 7; offset += 1) {
    const ts = at(offset, hhmm)
    const day = new Date(ts).getDay() || 7
    if (ts > Date.now() && (weekday === null || day === weekday)) return ts
  }
  return at(1, hhmm)
}

export function fmtNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '未获取'
  return value >= 10000 ? (value / 10000).toFixed(1) + '万' : String(value)
}

// 最近一次已经过去的 hh:mm（今天已过则为今天，否则为昨天）
export function lastOccurrence(hhmm) {
  const today = at(0, hhmm)
  return today <= Date.now() ? today : at(-1, hhmm)
}

// ts 所在那一天的 hh:mm
export function onDayOf(ts, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const date = new Date(ts)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}
