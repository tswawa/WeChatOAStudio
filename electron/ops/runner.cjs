// 执行真实采集、写稿、存草稿与定时发表，持久记录步骤并支持停止和重启恢复。
const { uid } = require('./store.cjs')
const { collectSources, renderArticle } = require('./content.cjs')
const { writeArticle } = require('./model.cjs')
const { dueSlot, publicationTime } = require('./tasks.cjs')
const { publicationVersion } = require('../mp/publications.cjs')

function createRunner({ store, settings, mp, notify, getAccount, network }) {
  const active = new Map()
  let closed = false
  let ticking = false
  let tickPromise = null
  const pollAfter = new Map()
  const update = (run) => {
    store.put('runs', run.accountId, run)
    notify(run.accountId)
  }
  const say = (accountId, text) => {
    store.message(accountId, { role: 'bot', text })
    notify(accountId)
  }
  for (const run of store.all('runs')) {
    if (run.type === 'assistant') continue
    if (run.status !== 'running') continue
    run.status = 'failed'
    run.error = '上次应用退出时任务未完成，请检查公众平台草稿及发表记录后手动重试'
    run.finishedAt = Date.now()
    for (const step of run.steps) {
      if (step.state === 'active') Object.assign(step, { state: 'failed', note: run.error })
    }
    store.put('runs', run.accountId, run)
  }

  async function publish(run) {
    const step = run.steps.find((item) => item.key === 'publish')
    if (!run.draftVersion) throw new Error('这条旧待发表记录缺少草稿版本，请核对后重新执行；本次未提交发表')
    Object.assign(step, { state: 'active', note: '正在提交官方发表接口' })
    run.status = 'running'
    update(run)
    const result = await mp.publishOfficial(run.accountId, {
      draftId: run.draftId, massNotify: run.massNotify, expectedVersion: run.draftVersion,
    })
    if (!result) throw new Error('发表接口没有返回结果，请在公众平台核对')
    run.publishResult = result
    run.status = result.status === 'succeeded' || result.succeeded === true ? 'succeeded' : 'submitted'
    run.finishedAt = Date.now()
    Object.assign(step, {
      state: 'done', note: run.status === 'succeeded' ? '已确认发表成功' : '已提交微信，最终发表结果以公众平台为准',
    })
    update(run)
    say(run.accountId, run.status === 'succeeded' ? '文章已发表。' : '文章已提交微信，等待平台处理，请查看发表记录。')
  }

  async function execute(run, task, controller) {
    const signal = controller.signal
    const step = async (key, action) => {
      signal.throwIfAborted()
      const item = run.steps.find((entry) => entry.key === key)
      Object.assign(item, { state: 'active', note: '' })
      update(run)
      const result = await action(item)
      item.state = 'done'
      update(run)
      return result
    }
    try {
      const sources = store.list('sources', run.accountId)
        .filter((source) => source.enabled && task.sourceIds.includes(source.id))
      if (!sources.length) throw new Error('任务没有启用的资讯来源')
      const collected = await step('collect', async (item) => {
        const result = await collectSources(sources, signal, { network })
        item.note = `${sources.length} 个来源，采集 ${result.items.length} 条`
          + (result.failures.length ? `；${result.failures.join('；')}` : '')
        return result.items
      })
      const items = await step('select', async (item) => {
        const fresh = store.freshItems(run.accountId, collected)
        if (!fresh.length) throw new Error('采集到的资讯都已经写过，本次未生成重复文章')
        store.recordItems(run.accountId, fresh, run.id, false)
        item.note = `保留 ${fresh.length} 条未使用资讯`
        return fresh
      })
      const content = await step('write', async (item) => {
        const article = await writeArticle(settings, task, items, signal)
        article.html = await renderArticle(article.markdown, items)
        item.note = `已生成「${article.title}」，依据 ${items.length} 条采集资料`
        run.generatedArticle = article
        return article
      })
      await step('draft', async (item) => {
        signal.throwIfAborted()
        const saved = await mp.saveDraft(run.accountId, {
          title: content.title, digest: content.digest, html: content.html,
          author: getAccount(run.accountId)?.name || '', cover: task.cover || null,
          origin: 'bot', taskId: task.id,
        })
        const draftId = saved?.id || saved?.draft?.id || saved?.media_id || saved?.appmsgid
        if (!draftId) throw new Error('微信未返回草稿编号，不能确认保存成功，请到公众平台核对')
        run.draftId = String(draftId)
        run.draftVersion = publicationVersion(saved.draft || saved)
        delete run.generatedArticle
        store.recordItems(run.accountId, items, run.id, true)
        item.note = '已保存到公众平台草稿箱'
      })
      signal.throwIfAborted()
      const publishStep = run.steps[4]
      if (run.trial || task.mode === 'draft_only') {
        run.status = 'drafted'
        Object.assign(publishStep, { state: 'skipped', note: run.trial ? '试写只保存草稿' : '按设置只保存草稿' })
        say(run.accountId, `「${content.title}」已存入公众平台草稿箱。`)
      } else if (task.mode === 'draft_notify') {
        run.status = 'waiting_scan'
        run.scheduledAt = publicationTime(task, run.startedAt)
        publishStep.note = '等待管理员或运营者扫码发表'
        say(run.accountId, `「${content.title}」已存入草稿箱，等待你在电脑上扫码发表。`)
      } else {
        run.scheduledAt = publicationTime(task, run.startedAt)
        run.massNotify = task.massNotify
        run.status = 'scheduled'
        publishStep.note = '等待发表时间；需要应用保持运行'
        if (run.scheduledAt <= Date.now()) await publish(run)
        else say(run.accountId, `「${content.title}」已存入草稿箱，将在设定时间通过接口发表。`)
      }
      if (!['scheduled', 'waiting_scan'].includes(run.status)) run.finishedAt = Date.now()
      update(run)
    } catch (error) {
      console.error('运营任务执行失败', run.id, error.name)
      run.status = signal.aborted ? 'cancelled' : 'failed'
      run.error = signal.aborted
        ? `任务已停止${run.draftId ? '，已保存的草稿保留' : '；若停止前正在存草稿，请核对公众平台'}`
        : error.message
      run.finishedAt = Date.now()
      for (const item of run.steps) {
        if (item.state === 'active') Object.assign(item, { state: signal.aborted ? 'skipped' : 'failed', note: run.error })
        else if (item.state === 'pending') item.state = 'skipped'
      }
      update(run)
      say(run.accountId, run.error)
    } finally {
      active.delete(run.id)
    }
  }

  function start(accountId, task, { trial = true } = {}) {
    if (closed) throw new Error('应用正在关闭')
    if (!settings.private().model.apiKey || !settings.private().model.name) {
      throw new Error('请先配置模型服务再执行写稿任务')
    }
    if (!task.cover?.url && !task.cover?.mediaId) throw new Error('请先在任务设置中选择封面图片，再开始写稿')
    if (store.list('runs', accountId).some((run) => run.taskId === task.id
      && ['running', 'scheduled', 'submitted'].includes(run.status))) {
      throw new Error('这个任务正在执行、等待定时发表或等待微信处理结果')
    }
    if (!getAccount(accountId) || getAccount(accountId).status !== 'ready') throw new Error('请先恢复公众号登录')
    const run = {
      id: uid('r'), taskId: task.id, accountId, name: task.name, trial, status: 'running',
      startedAt: Date.now(), finishedAt: null, draftId: null, error: '',
      steps: ['collect', 'select', 'write', 'draft', 'publish'].map((key, index) => ({
        key, label: ['采集资讯', '去重筛选', '撰写排版', '存入草稿箱', '发表'][index], state: 'pending', note: '',
      })),
    }
    update(run)
    store.message(accountId, { role: 'card', card: { type: 'run', kind: 'run', runId: run.id, state: 'done' } })
    const controller = new AbortController()
    const entry = { controller, promise: null }
    active.set(run.id, entry)
    entry.promise = execute(run, structuredClone(task), controller)
    notify(accountId)
    return run
  }

  function stop(accountId, runId) {
    const run = store.get('runs', accountId, runId)
    if (!run) throw new Error('运行记录不存在')
    if (active.has(runId)) {
      if (run.steps[4].state === 'active') throw new Error('发表请求已经提交，无法撤回，请到公众平台核对')
      active.get(runId).controller.abort(new Error('任务已停止'))
      return { ...run, stopRequested: true }
    }
    if (run.status === 'scheduled') {
      run.status = 'cancelled'
      run.finishedAt = Date.now()
      Object.assign(run.steps[4], { state: 'skipped', note: '已取消自动发表，草稿保留' })
      update(run)
      return run
    }
    throw new Error('这次任务已经结束')
  }

  async function tick() {
    if (closed || ticking) return
    ticking = true
    try {
      for (const run of store.all('runs')) {
        if (closed) break
        if (run.type === 'assistant') continue
        if (run.status === 'submitted' && typeof mp.getPublishStatus === 'function'
          && (pollAfter.get(run.id) || 0) <= Date.now()) {
          pollAfter.set(run.id, Date.now() + 60000)
          try {
            const result = await mp.getPublishStatus(run.accountId, run.publishResult)
            if (['succeeded', 'failed'].includes(result?.status)) {
              run.status = result.status
              run.publishResult = { ...run.publishResult, ...result }
              run.finishedAt = Date.now()
              run.error = result.status === 'failed' ? '微信确认发表失败，请到公众平台查看具体原因' : ''
              Object.assign(run.steps[4], {
                state: result.status === 'succeeded' ? 'done' : 'failed',
                note: run.error || '微信已确认发表成功',
              })
              update(run)
              say(run.accountId, run.error || '微信已确认文章发表成功。')
            }
          } catch (error) {
            console.warn('查询发表结果失败', run.id, error.name)
          }
          continue
        }
        if (run.status !== 'scheduled' || run.scheduledAt > Date.now()) continue
        if (!getAccount(run.accountId)) continue
        try {
          await publish(run)
        } catch (error) {
          console.error('定时发表失败', run.id, error.name)
          run.status = 'failed'
          run.error = `定时发表未确认成功：${error.message}。请核对公众平台后再操作`
          run.finishedAt = Date.now()
          Object.assign(run.steps[4], { state: 'failed', note: run.error })
          update(run)
          say(run.accountId, run.error)
        }
      }
      for (const task of store.all('tasks')) {
        if (closed) break
        if (task.type === 'assistant') continue
        if (!task.enabled || !getAccount(task.accountId)) continue
        const slot = dueSlot(task, Date.now())
        if (!slot || !store.claimSlot(task.id, slot)) continue
        try {
          start(task.accountId, task, { trial: false })
        } catch (error) {
          console.error('定时任务启动失败', task.id, error.name)
          say(task.accountId, `「${task.name}」本次未执行：${error.message}`)
        }
      }
    } finally {
      ticking = false
    }
  }
  const timer = setInterval(() => {
    if (closed || ticking) return
    tickPromise = tick().catch((error) => console.error('运营调度检查失败', error.name))
  }, 30000)
  timer.unref()
  return {
    start, stop, tick,
    async close() {
      closed = true
      clearInterval(timer)
      for (const entry of active.values()) entry.controller.abort(new Error('应用正在关闭'))
      await Promise.allSettled([...active.values()].map((entry) => entry.promise))
      await tickPromise
    },
  }
}

module.exports = { createRunner }
