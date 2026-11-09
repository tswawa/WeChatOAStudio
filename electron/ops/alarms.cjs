// 主进程闹钟把已授权任务文本发送给助手，持久去重并仅补最近 24 小时内的一次到期。
const { uid } = require('./store.cjs')
const { latestAssistantSlot } = require('./tasks.cjs')

function createAlarmScheduler({ store, chat, notify, getAccount, mp = {} }) {
  const active = new Map()
  const queues = new Map()
  let closed = false
  let ticking = false
  function update(run) {
    store.put('runs', run.accountId, run)
    notify(run.accountId)
  }
  for (const run of store.all('runs')) {
    if (run.type !== 'assistant' || run.status !== 'running') continue
    run.status = 'failed'
    run.error = '上次应用退出时定时任务未完成；本次不自动重试，请查看任务记录后决定是否重新执行'
    run.finishedAt = Date.now()
    for (const step of run.steps) {
      if (step.state === 'active' || step.state === 'pending') Object.assign(step, { state: 'failed', note: run.error })
    }
    store.put('runs', run.accountId, run)
  }
  async function execute(run, task, controller) {
    try {
      const previous = queues.get(run.accountId)
      const pending = (async () => {
        await previous?.catch(() => undefined)
        controller.signal.throwIfAborted()
        Object.assign(run.steps[0], { state: 'done', note: '已发送任务内容给 Bot' })
        Object.assign(run.steps[1], { state: 'active', note: 'Bot 正在执行任务' })
        update(run)
        return chat.sendScheduled(run.accountId, {
          text: task.content, taskId: task.id, taskName: task.name, runId: run.id,
          slot: run.slot, signal: controller.signal, publication: run.trial ? { mode: 'confirm' } : task.publication || { mode: 'confirm' }, taskVersion: task.updatedAt,
        })
      })()
      queues.set(run.accountId, pending)
      const result = await pending
      const cards = result.messages.filter((message) => message.role === 'card')
      const open = cards.filter((message) => message.card.state === 'open')
      const failures = cards.filter((message) => message.card.state === 'failed')
      const publications = cards.filter(message => message.card.action === 'draft.publish' && message.card.apiResult)
      const waitingVerification = failures.some(message => message.card.outcome === 'verification_required')
      const uncertain = failures.some(message => message.card.outcome === 'uncertain')
      if (!publications.length && !uncertain) {
        if (result.stopped) controller.abort(new Error('Bot 已停止执行本次任务'))
        controller.signal.throwIfAborted()
        if (result.limited) throw new Error('本次任务达到模型调用次数上限，已保留执行记录')
      }
      if (queues.get(run.accountId) === pending) queues.delete(run.accountId)
      run.messageIds = result.messages.map((message) => message.id)
      const notSubmitted = !run.trial && ['publish','mass'].includes(task.publication?.mode) && !publications.length && !failures.length && !open.length
      run.status = publications.length ? 'submitted' : waitingVerification ? 'waiting_verification' : uncertain ? 'uncertain' : failures.length ? 'failed' : open.length ? 'waiting_confirmation' : notSubmitted ? 'not_submitted' : 'succeeded'
      if (publications.length) {
        run.publishResult = publications[0].card.apiResult
        run.publishMessageId = publications[0].id
      }
      run.error = notSubmitted ? '本次未提交文章，可能尚未生成可发送新稿或发表授权已变化；请查看 Bot 执行记录与保留草稿' : failures.map((message) => message.card.error).filter(Boolean).join('；')
      run.finishedAt = Date.now()
      Object.assign(run.steps[1], {
        state: failures.length ? 'failed' : 'done',
        note: failures.length || notSubmitted ? run.error : publications.length ? '已提交微信，等待平台回执' : open.length ? '任务已交给 Bot，部分操作等待你确认' : 'Bot 已完成本次任务',
      })
      update(run)
    } catch (error) {
      console.error('助手闹钟任务失败', run.id, error.name)
      run.status = controller.signal.aborted ? 'cancelled' : 'failed'
      run.error = error.message
      run.finishedAt = Date.now()
      Object.assign(run.steps[1], { state: run.status === 'cancelled' ? 'skipped' : 'failed', note: run.error })
      update(run)
    } finally {
      active.delete(run.id)
    }
  }
  function start(accountId, task, { slot = null, expired = false, trial = false } = {}) {
    if (closed) throw new Error('应用正在关闭')
    if (store.list('runs', accountId).some((run) => run.taskId === task.id && run.status === 'running')) {
      throw new Error('这个任务正在执行，请等待本次完成')
    }
    const run = {
      id: uid('r'), type: 'assistant', accountId, taskId: task.id, name: task.name, slot, trial,
      startedAt: Date.now(), finishedAt: expired ? Date.now() : null,
      status: expired ? 'skipped' : 'running',
      error: expired ? '最近一次计划时间已超过 24 小时，本次已跳过，等待下次闹钟' : '',
      steps: [
        { key: 'send', label: '发送任务', state: expired ? 'skipped' : 'active', note: '' },
        { key: 'assistant', label: 'Bot 执行', state: expired ? 'skipped' : 'pending', note: '' },
      ],
    }
    store.put('runs', accountId, run)
    store.message(accountId, {
      role: 'card', sessionId: chat.scheduledSession(accountId).id,
      card: { type: 'run', kind: 'run', runId: run.id, state: 'done' },
      text: expired ? run.error : `定时任务「${task.name}」`,
    })
    notify(accountId)
    if (!expired) {
      const entry = { controller: new AbortController(), promise: null }
      active.set(run.id, entry)
      entry.promise = execute(run, structuredClone(task), entry.controller)
    }
    return run
  }
  function tick(now = Date.now()) {
    if (closed || ticking) return
    ticking = true
    try {
      for (const task of store.all('tasks')) {
        if (task.type !== 'assistant' || !task.enabled || !getAccount(task.accountId)) continue
        const due = latestAssistantSlot(task, now)
        if (!due) continue
        if (store.list('runs', task.accountId).some((run) => run.taskId === task.id && run.status === 'running')) continue
        store.transaction(() => {
          if (!store.claimSlot(task.id, due.slot)) return
          start(task.accountId, task, due)
        })
      }
    } finally {
      ticking = false
    }
  }
  const timer = setInterval(() => {
    try { tick() } catch (error) { console.error('助手闹钟检查失败', error.name) }
  }, 1000)
  timer.unref()
  queueMicrotask(() => {
    try { tick() } catch (error) { console.error('启动闹钟恢复失败', error.name) }
  })
  let pollPromise = null
  async function pollPublications() {
    for (const run of store.all('runs')) {
      if (closed) break
      if (run.type !== 'assistant' || run.status !== 'submitted' || !run.publishResult || !mp.getPublishStatus) continue
      try {
        const result = await mp.getPublishStatus(run.accountId, run.publishResult)
        if (!['succeeded', 'failed'].includes(result.status)) continue
        run.status = result.status
        run.publishResult = { ...run.publishResult, ...result }
        run.error = result.status === 'failed' ? '微信确认发送失败，请查看公众平台' : ''
        run.finishedAt = Date.now()
        run.steps[1].note = run.error || '微信已确认发送成功'
        const message = store.get('messages', run.accountId, run.publishMessageId)
        if (message) {
          message.card.apiResult = run.publishResult
          message.card.result = run.error || '微信已确认发送成功'
          store.put('messages', run.accountId, message)
        }
        update(run)
      } catch (error) { console.warn('查询定时发表回执失败', error.code || error.name) }
    }
  }
  const statusTimer = setInterval(() => { if (!closed && !pollPromise) pollPromise = pollPublications().finally(() => { pollPromise = null }) }, 30000)
  statusTimer.unref()
  return {
    start, tick, pollPublications,
    stop(accountId, runId) {
      const run = store.get('runs', accountId, runId)
      if (!run || !active.has(runId)) throw new Error('这次定时任务已经结束')
      active.get(runId).controller.abort(new Error('定时任务已停止；已完成的操作保留'))
      return { ...run, stopRequested: true }
    },
    async close() {
      closed = true
      clearInterval(timer)
      clearInterval(statusTimer)
      await pollPromise
      for (const entry of active.values()) entry.controller.abort(new Error('应用正在关闭'))
      await Promise.allSettled([...active.values()].map((entry) => entry.promise))
    },
  }
}

module.exports = { createAlarmScheduler }
