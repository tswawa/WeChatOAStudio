// 指令处理：根据识别出的意图回复文字或卡片。改动类操作一律先出确认卡，用户点确认才执行
import { pushBot, pushCard, chat } from './chatStore.js'
import { detectIntent } from './intents.js'
import { runInChat } from './runner.js'
import { ws, tasksOfAccount, apiPublishOf } from '../store/workspace.js'
import { session, currentAccount } from '../store/session.js'
import { scheduleText, nextRunText } from '../store/taskModes.js'
import { plainText } from '../store/seed/articles.js'
import { fmtNumber } from '../utils/time.js'

const helpText = () => [
  '我可以做这些：',
  `· 建运营任务：“${currentAccount.value.example}”`,
  '· 试写一篇（只存草稿）：“现在写一篇试试”',
  '· 改稿：“标题换个更吸引人的”“缩短到 800 字”“生成摘要”',
  '· 发表前检查：“检查一下排版”',
  '· 发表：“把这篇发了”（需要扫码验证）',
  '· 管理任务：“有哪些任务”“暂停日报”“恢复日报”“删除日报任务”',
  '· 看数据：“昨天数据怎么样”',
].join('\n')

function defaultMode() {
  return apiPublishOf(session.accountId).ready ? 'auto_publish' : 'draft_notify'
}

// 当前稿件：从编辑器交过来的那篇优先，否则取最近修改的草稿
function currentDraft() {
  const drafts = ws.value.drafts
  return drafts.find((item) => item.id === chat.value.focusDraftId) || [...drafts].sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

// 按名称或名称里的关键字（如“日报”）找任务；只有一个任务时直接用它
function findTask(text) {
  const list = tasksOfAccount.value
  const keyword = (task) => ['日报', '周报', '技巧'].some((word) => task.name.includes(word) && text.includes(word))
  return list.find((task) => text.includes(task.name) || keyword(task)) || (list.length === 1 ? list[0] : null)
}

function withDraft(handle) {
  const draft = currentDraft()
  if (!draft) return pushBot('草稿箱里没有文章。')
  return handle(draft)
}

function confirmTaskAction(action, text, parsed, describe) {
  const task = findTask(parsed.raw)
  if (!task) return pushBot(`要${text}哪个任务？说一下任务名称。`)
  return pushCard({ type: 'action_confirm', action, taskId: task.id, text: describe(task) })
}

const HANDLERS = {
  help() {
    pushBot(helpText())
  },
  create_task(parsed) {
    const topic = parsed.topic || '行业'
    let mode = parsed.mode || defaultMode()
    let note = ''
    if (mode === 'auto_publish' && !apiPublishOf(session.accountId).ready) {
      mode = 'draft_notify'
      note = '这个号还不能通过接口发表，先按“存草稿并提醒扫码”设置。'
    }
    if (parsed.urls.length) note += `识别到 ${parsed.urls.length} 个新来源，确认后加入资讯来源。`
    pushBot('按你的意思整理了一个运营任务，确认后生效。' + note)
    pushCard({
      type: 'task_confirm',
      pendingUrls: parsed.urls,
      draft: {
        name: topic + (parsed.schedule.repeat === 'weekly' ? '周报' : '日报'),
        topic: `${topic}相关的最新资讯与动态`,
        sourceIds: ws.value.sources.filter((item) => item.enabled).map((item) => item.id),
        style: '约 1200 字，选 3～5 条',
        schedule: parsed.schedule,
        mode,
        massNotify: true,
      },
    })
  },
  run_now(parsed) {
    const list = tasksOfAccount.value
    if (!list.length) return pushBot(`还没有运营任务。先告诉我写什么、什么时间发，比如“${currentAccount.value.example}”。`)
    const task = findTask(parsed.raw)
    if (task) return runInChat(task, { trial: true })
    pushBot('要按哪个任务试写？')
    return pushCard({
      type: 'quick',
      options: list.map((item) => ({ label: item.name, text: `试写「${item.name}」`, trialTaskId: item.id })),
    })
  },
  list_tasks() {
    const list = tasksOfAccount.value
    if (!list.length) return pushBot('这个号还没有运营任务。')
    pushBot(`这个号有 ${list.length} 个运营任务：`)
    return list.forEach((task) => pushCard({ type: 'task', taskId: task.id }))
  },
  pause_task: (parsed) =>
    confirmTaskAction('pause', '暂停', parsed, (task) => `暂停「${task.name}」？暂停后不再自动执行，已存的草稿不受影响。`),
  resume_task: (parsed) =>
    confirmTaskAction('resume', '恢复', parsed, (task) => `恢复「${task.name}」？${scheduleText(task.schedule)}。`),
  delete_task: (parsed) =>
    confirmTaskAction('delete', '删除', parsed, (task) => `删除「${task.name}」？运行记录一起删除，已写好的草稿保留。`),
  retitle: () =>
    withDraft((draft) => {
      // 标题形如「栏目｜主题」时围绕主题改写；主题是日期或没有时用栏目名
      const [column, rest = ''] = draft.title.split('｜')
      const subject = !rest || /^\d+月\d+日$/.test(rest) ? column : rest
      pushBot('想了 3 个标题，选一个替换：')
      pushCard({
        type: 'edit_proposal',
        draftId: draft.id,
        field: 'title',
        options: [
          { label: 'a', value: `一文看懂：${subject}` },
          { label: 'b', value: `${subject}，3 分钟读完` },
          { label: 'c', value: `${column}｜今天最值得关注的几件事` },
        ],
      })
    }),
  shorten: (parsed) =>
    withDraft((draft) => {
      const before = plainText(draft.html).length
      if (parsed.target && before <= parsed.target) {
        return pushBot(`正文现在 ${before} 字，已经在 ${parsed.target} 字以内，不用缩短。`)
      }
      // 原型里按小节精简：保留开头和前 60% 的小节；接入模型后按目标字数改写
      const sections = draft.html.split(/(?=<h2)/)
      if (sections.length < 3) return pushBot('这篇小节太少，原型里演示不了精简；接入大模型后可以按字数改写。')
      const keep = Math.max(1, Math.floor((sections.length - 1) * 0.6))
      const shorter = sections.slice(0, 1 + keep).join('')
      const after = plainText(shorter).length
      pushBot(`精简了一版：保留前 ${keep} 个小节，从 ${before} 字减到 ${after} 字。`)
      return pushCard({
        type: 'edit_proposal',
        draftId: draft.id,
        field: 'html',
        options: [{ label: 'short', value: shorter, note: `${after} 字` }],
      })
    }),
  digest: () =>
    withDraft((draft) => {
      pushBot('写了一段摘要，会显示在分享卡片和消息列表里：')
      pushCard({
        type: 'edit_proposal',
        draftId: draft.id,
        field: 'digest',
        options: [{ label: 'digest', value: plainText(draft.html).slice(0, 54) }],
      })
    }),
  check: () => withDraft((draft) => pushCard({ type: 'check', draftId: draft.id })),
  publish: () => withDraft((draft) => pushCard({ type: 'publish', draftId: draft.id })),
  stats() {
    const data = ws.value
    const best = [...data.published].sort((a, b) => b.reads - a.reads)[0]
    const tasks = tasksOfAccount.value.map((task) => `「${task.name}」${nextRunText(task)}`).join('，')
    pushBot([
      `昨天：阅读 ${fmtNumber(data.yesterday.reads)}，分享 ${data.yesterday.shares}，`
        + `新增关注 ${data.yesterday.newFollowers}，取消关注 ${data.yesterday.lost}。`,
      best ? `近期阅读最高的是「${best.title}」（${fmtNumber(best.reads)}）。` : '',
      tasks ? `运营任务：${tasks}。` : '',
    ].filter(Boolean).join('\n'))
  },
  unknown() {
    pushBot(`这句我还没理解。可以说“${currentAccount.value.example}”，或者输入“帮助”看我能做什么。`)
  },
}

export function handleInput(text) {
  const parsed = detectIntent(text)
  HANDLERS[parsed.intent](parsed)
}
