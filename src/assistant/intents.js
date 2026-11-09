// 意图识别：原型用关键词规则模拟大模型对指令的理解，输出要做的操作和参数。
// 接入真实模型后用工具调用替换这一层，确认卡和执行逻辑不变
const TIME_RE = /(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*(?:[:：点])\s*(\d{1,2}|半)?/g
const WEEK_RE = /每(?:周|星期)([一二三四五六日天])/
const URL_RE = /https?:\/\/[^\s，。]+/g

const WEEK_INDEX = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

function toHHMM(period, hourText, minuteText) {
  let hour = Number(hourText)
  if (['下午', '晚上'].includes(period) && hour < 12) hour += 12
  const minute = minuteText === '半' ? 30 : Number(minuteText || 0)
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

// 后一个时间没写“上午/晚上”时沿用前一个，例如“晚上 8 点准备，9 点发”是 20:00 和 21:00
export function parseTimes(text) {
  let period = ''
  return [...text.replace(URL_RE, '').matchAll(TIME_RE)].map((match) => {
    period = match[1] || period
    return toHHMM(period, match[2], match[3])
  })
}

function shiftHour(hhmm, delta) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return String((hours + delta + 24) % 24).padStart(2, '0') + ':' + String(minutes).padStart(2, '0')
}

// 只说了一个时间时，把它当发表时间，提前 1 小时准备
function parseSchedule(text) {
  const times = parseTimes(text)
  const week = text.match(WEEK_RE)
  const publishAt = times[1] || times[0] || '09:00'
  const prepareAt = times[1] ? times[0] : shiftHour(publishAt, -1)
  return { repeat: week ? 'weekly' : 'daily', weekday: week ? WEEK_INDEX[week[1]] : null, prepareAt, publishAt }
}

function parseTopic(text) {
  const match = text.match(/(?:整理|搜集|收集|采集|写|做|发)(?:一?[篇份期个])?(.{2,24}?)(?:资讯|新闻|动态|日报|周报|文章|内容)/)
  return match ? match[1].trim().replace(/^(过去|最新|当天|每天|今天)/, '').trim() : ''
}

function parseMode(text) {
  if (/自动发|直接发|不用我|全自动/.test(text)) return 'auto_publish'
  if (/只存草稿|先存草稿|只放草稿|我自己发/.test(text)) return 'draft_only'
  return null
}

// 规则按顺序匹配，靠前的优先
const RULES = [
  { intent: 'help', test: /你能做什么|怎么用|帮助|help/i },
  { intent: 'list_tasks', test: /(有哪些|查看|列出|看看).*(任务|安排)|任务列表/ },
  { intent: 'delete_task', test: /删(除|掉).*(任务|日报|周报)/ },
  { intent: 'pause_task', test: /(暂停|停掉|关掉).*(任务|日报|周报|推送)|^暂停/ },
  { intent: 'resume_task', test: /(恢复|重新开启|继续).*(任务|日报|周报)/ },
  { intent: 'run_now', test: /(现在|马上|立即|立刻).{0,24}(写|跑|执行|生成)|试(跑|写)一(篇|次)/ },
  { intent: 'stats', test: /(数据|阅读量?|涨粉|粉丝|表现|效果)(怎么样|如何)|昨天.{0,6}(数据|阅读|表现|怎么样)|看(看)?数据/ },
  { intent: 'create_task', test: /(每天|每日|每周|每星期|每晚|每早).*\d/ },
  { intent: 'check', test: /检查|排版.*(问题|规范)/ },
  { intent: 'digest', test: /摘要/ },
  { intent: 'shorten', test: /(缩短|精简|压缩|太长|删减)/ },
  { intent: 'retitle', test: /标题/ },
  { intent: 'publish', test: /(发表|发布|发出去|推送)|发了/ },
]

export function detectIntent(text) {
  const rule = RULES.find((item) => item.test.test(text))
  const intent = rule ? rule.intent : 'unknown'
  if (intent === 'create_task') {
    return {
      intent,
      schedule: parseSchedule(text),
      topic: parseTopic(text),
      mode: parseMode(text),
      urls: text.match(URL_RE) || [],
      raw: text,
    }
  }
  if (intent === 'shorten') {
    const words = text.match(/(\d{3,4})\s*字/)
    return { intent, target: words ? Number(words[1]) : null, raw: text }
  }
  return { intent, raw: text }
}
