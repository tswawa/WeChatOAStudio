// Ordinary publication owns its hidden page, progress and durable receipt independently of the Bot turn.
const { createHash, randomUUID } = require('node:crypto')
const { publicationVersion } = require('./publications.cjs')
const { createNativePublicationPage } = require('./web-publish-page.cjs')
const PENDING = new Set(['submitting','uncertain','waiting_verification','waiting_confirmation'])
function createWebPublicationService({ getAccount, getDraft, getMassQuota, listPublished, transport, journal, locks = new Set(), notify = () => {},
  createPage = options => createNativePublicationPage({ ...options, transport }), responseWait = 12000, lifetime = 10 * 60 * 1000 }) {
  const active = new Map(), jobs = new Set()
  let closed = false
  function requireAccount(id) { if (!getAccount(id)) throw new Error('公众号不存在') }
  function save(account, item) { const value = journal.put(account, item); notify(account); return value }
  function publicResult(entry) { return { ...entry.result, transport: 'web', publicationId: entry.id, status: entry.state,
    massNotify: entry.kind === 'mass', message: entry.error || entry.result?.message || '', code: entry.code || '', diagnostics: entry.diagnostics } }
  function cleanDiagnostics(value = {}) {
    const result = {}
    for (const [key, allowed] of Object.entries({ phase: ['open','settings','confirm','observe'], identity: ['verified','unavailable','login_required','mismatch'],
      dialog: ['none','settings','confirmation','processing','security','unknown'] })) if (allowed.includes(value[key])) result[key] = value[key]
    for (const key of ['requestReleased','requiresNativeRetry','settingsVisible','confirmationVisible','unknownDialog']) if (typeof value[key] === 'boolean') result[key] = value[key]
    if (typeof value.notification === 'boolean' || value.notification === null) result.notification = value.notification
    return result
  }
  async function status(account, id) {
    requireAccount(account)
    const entry = journal.get(account, id)
    if (!entry || entry.transport !== 'web') throw new Error('普通发送记录不存在或不属于当前公众号')
    if (['succeeded','cancelled'].includes(entry.state)) return publicResult(entry)
    if (active.has(id) && ['preparing','submitting','waiting_verification','waiting_confirmation'].includes(entry.state)) return publicResult(entry)
    const candidates = await listPublished(account)
    const match = candidates.find(item => item.publishConfirmed === true && !item.deleted && item.mass === (entry.kind === 'mass')
      && (String(item.sourceDraftId || '') === entry.draftId || entry.result?.nativeMessageId && String(item.id).split('_')[0] === entry.result.nativeMessageId)
      && Number(item.at) >= entry.createdAt - 60000)
    if (match) {
      const next = save(account, { ...entry, state: 'succeeded', error: '', result: { ...entry.result, status: 'succeeded', publishedId: String(match.id), message: '微信已确认发送成功' } })
      void active.get(id)?.finish()
      return publicResult(next)
    }
    const knownUnsent = !active.has(id) && entry.state === 'uncertain' && entry.stage === 'native_window'
      && entry.diagnostics?.requestReleased === false && !entry.dispatchedAt && !entry.result?.nativeMessageId
      && !candidates.some(item => !item.deleted && String(item.sourceDraftId || '') === entry.draftId)
    if (knownUnsent) return publicResult(save(account, { ...entry, state: 'failed', code: 'WX_NOT_SUBMITTED',
      previousError: entry.error || '', resolvedAsUnsentAt: Date.now(), error: '已核实本次最终请求未放行，且微信发表记录中没有该稿件；尚未发送，可重新明确发起',
      result: { ...entry.result, status: 'failed' } }))
    if (!active.has(id) && PENDING.has(entry.state) && entry.state !== 'uncertain') return publicResult(save(account, { ...entry, state: 'uncertain',
      error: '微信窗口已不在本次进程中，请核对公众平台结果；不会自动重发' }))
    return publicResult(entry)
  }
  function publish(account, input) {
    if (closed) return Promise.reject(new Error('应用正在关闭'))
    const job = begin(account, input).finally(() => jobs.delete(job)); jobs.add(job); return job
  }
  async function begin(account, { draftId, massNotify = false, expectedVersion, signal } = {}) {
    signal?.throwIfAborted()
    requireAccount(account)
    if (!/^\d+$/.test(String(draftId || '')) || typeof massNotify !== 'boolean' || !/^[a-f0-9]{64}$/.test(expectedVersion || '')) throw new Error('请先检查草稿，并明确选择普通发表或群发通知')
    const key = `${account}:${draftId}`
    if (locks.has(key)) throw new Error('这篇文章正在发送或等待微信确认，请先查询结果')
    locks.add(key)
    let entry, page, resolveResult, firstTimer, expiry, finishing, retained = false, settled = false, interrupted = false
    const result = new Promise(resolve => { resolveResult = resolve })
    const settle = () => { if (!settled) { settled = true; clearTimeout(firstTimer); resolveResult(publicResult(entry)) } }
    const update = patch => { entry = save(account, { ...entry, ...patch }); return entry }
    const finish = () => finishing ||= (async () => {
      signal?.removeEventListener('abort', aborted); clearTimeout(expiry); clearTimeout(firstTimer)
      // Keep the lock until the dedicated page has stopped and cannot release another request.
      if (page) await page.close()
      active.delete(entry?.id); locks.delete(key)
    })()
    const failed = failure => {
      if (interrupted || !entry || ['submitted','succeeded'].includes(entry.state)) return
      interrupted = true
      const knownUnsent = failure.nativeDispatchAttempted === false && !entry.diagnostics?.requestReleased
      const state = knownUnsent ? 'failed' : 'uncertain'
      const patch = { state, error: failure.message, code: failure.code || '',
        diagnostics: cleanDiagnostics(failure.diagnostics || entry.diagnostics), result: { ...entry.result, status: state } }
      try { update(patch) } catch { entry = { ...entry, state: 'uncertain', error: '本地回执无法更新，请核对微信结果，不会自动重发' }; console.error('普通发送回执无法更新，保留原提交状态') }
      settle(); void finish()
    }
    const cancelled = () => {
      if (interrupted || !entry || ['submitted','succeeded'].includes(entry.state)) return
      interrupted = true
      const uncertain = Boolean(entry.dispatchedAt || entry.diagnostics?.requestReleased)
      update({ state: uncertain ? 'uncertain' : 'cancelled', code: 'WX_AUTHOR_CANCELLED',
        error: uncertain ? '已停止后续步骤；请求可能已发出，请核对微信结果，不会自动重发' : '作者已取消本次发送，未提交微信',
        result: { ...entry.result, status: uncertain ? 'uncertain' : 'cancelled' } })
      settle(); void finish()
    }
    const aborted = () => cancelled()
    try {
      const draft = await getDraft(account, String(draftId)), version = publicationVersion(draft)
      signal?.throwIfAborted()
      if (closed) throw new Error('应用正在关闭')
      if (version !== expectedVersion) throw new Error('文章在确认后已修改，请重新检查后发送')
      const previous = journal.list(account).filter(item => item.draftId === String(draftId))
      const accepted = previous.find(item => item.version === version && item.result && ['submitted','succeeded'].includes(item.state))
      if (accepted) return { ...accepted.result, status: accepted.state, publicationId: accepted.id, transport: accepted.transport || 'api', reused: true, message: '该版本已有发送记录，未重复发送' }
      if (previous.some(item => PENDING.has(item.state))) throw new Error('这篇文章已有待核实提交，请先查询结果，不能切换方式重发')
      if (massNotify) { const quota = await getMassQuota(account); if (!Number.isSafeInteger(quota?.left) || quota.left <= 0) throw new Error('群发剩余次数未知或不足，未执行群发，不会自动改为普通发表') }
      const id = createHash('sha256').update(JSON.stringify([account,'web',String(draftId),version,massNotify,randomUUID()])).digest('hex')
      signal?.throwIfAborted()
      entry = save(account, { id, draftId: String(draftId), version, title: draft.title, kind: massNotify ? 'mass' : 'publish', transport: 'web', state: 'preparing', createdAt: Date.now(),
        result: { transport: 'web', publicationId: id, massNotify, message: '正在通过微信正常流程准备发送，尚未取得提交回执' } })
      signal?.addEventListener('abort', aborted, { once: true })
      page = await createPage({ accountId: account, draftId: String(draftId), massNotify, signal,
        beforeDispatch: async () => {
          signal?.throwIfAborted()
          if (closed || interrupted || Date.now() - entry.createdAt > lifetime) throw new Error('本次普通发送已停止或超时，未继续提交')
          requireAccount(account)
          if (publicationVersion(await getDraft(account, String(draftId))) !== version) throw new Error('发送前复核发现草稿已变化，已停止请求，请重新核对')
          if (massNotify) { const quota = await getMassQuota(account); if (!Number.isSafeInteger(quota?.left) || quota.left <= 0) throw new Error('最终提交前群发次数未知或不足，已停止发送') }
          signal?.throwIfAborted()
          if (closed || interrupted) throw new Error('本次发送已停止')
          update({ state: 'submitting', error: '', code: '', dispatchedAt: Date.now() })
        },
        onProgress: observation => {
          if (interrupted || ['submitted','succeeded'].includes(entry.state)) return
          const diagnostics = cleanDiagnostics(observation)
          if (JSON.stringify(diagnostics) === JSON.stringify(entry.diagnostics)) return
          update({ diagnostics, ...(['waiting_confirmation','waiting_verification'].includes(entry.state) ? { state: 'submitting', error: '', code: '' } : {}) })
        },
        onResult: async outcome => {
          if (outcome.accepted) {
            try { update({ state: 'submitted', error: '', code: '', result: { ...entry.result, status: 'submitted', nativeMessageId: outcome.nativeMessageId, message: '已通过微信页面提交，等待平台结果' } }) }
            catch { failed(new Error('微信已接收请求，但本地回执保存异常；请核对结果，不会重发')); return }
            settle(); void finish()
          } else update({ state: 'waiting_confirmation', error: `微信未接受发送（${outcome.code}），请在微信窗口核对` })
        },
        onManual: state => {
          if (interrupted || ['submitted','succeeded'].includes(entry.state)) return
          const changed = entry.state !== state.state || entry.error !== state.message || entry.code !== state.code
          const diagnostics = cleanDiagnostics(state.diagnostics)
          if (changed || JSON.stringify(entry.diagnostics) !== JSON.stringify(diagnostics)) update({ state: state.state, error: state.message, code: state.code || '', diagnostics })
          if (changed) page?.focus()
          settle()
        },
        onInterrupted: failed,
      })
      signal?.throwIfAborted()
      if (closed || interrupted) throw new Error('本次发送已停止或应用正在关闭')
      if (publicationVersion(await page.currentDraft()) !== version) throw new Error('微信窗口中的草稿与本次确认不一致，未自动发送')
      signal?.throwIfAborted()
      update({ state: 'submitting', error: '', stage: 'native_window' })
      active.set(id, { account, finish, cancel: cancelled, stop: () => failed(new Error('应用已退出，请核对微信结果，不自动重发')), focus: () => page.focus() }); retained = true
      firstTimer = setTimeout(settle, responseWait)
      expiry = setTimeout(() => failed(new Error('微信窗口等待已超时，请核对平台结果，不会自动重发')), lifetime)
      expiry.unref(); page.start()
      return await result
    } catch (failure) {
      if (entry && !retained && !['cancelled','uncertain'].includes(entry.state)) { try { update({ state: 'failed', error: failure.message }) } catch { console.error('保存普通发送准备失败记录异常') } }
      if (page && !retained) await page.close()
      throw failure
    } finally { if (!retained) { signal?.removeEventListener('abort', aborted); locks.delete(key) } }
  }
  return { publish, status,
    focus(account, id) { requireAccount(account); const entry = active.get(id); if (!entry || entry.account !== account) throw new Error('该微信发送窗口已关闭'); entry.focus(); return { opened: true } },
    async cancel(account, id) {
      requireAccount(account); const entry = active.get(id)
      if (!entry || entry.account !== account) throw new Error('该发送已不在当前进程中，不能取消，请查询微信结果')
      entry.cancel(); await entry.finish(); return publicResult(journal.get(account, id))
    },
    async close() { closed = true; for (const item of [...active.values()]) { item.stop(); await item.finish() } await Promise.allSettled([...jobs]) },
  }
}
module.exports = { createWebPublicationService }
