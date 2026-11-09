// 通过微信确认的原草稿编号收敛手动扫码发表结果，不根据标题推测且不重复通知。
function reconcilePublished(store, accountId, published, notify) {
  if (!Array.isArray(published)) throw new Error('发表记录格式无效')
  const confirmed = new Map(published
    .filter((item) => item.publishConfirmed === true && item.deleted !== true
      && item.id !== null && item.id !== undefined && String(item.id)
      && item.sourceDraftId !== null && item.sourceDraftId !== undefined && String(item.sourceDraftId))
    .map((item) => [String(item.sourceDraftId), item]))
  const updated = store.transaction(() => {
    const changed = []
    for (const run of store.list('runs', accountId)) {
      if (!['waiting_scan', 'drafted'].includes(run.status) || !run.draftId) continue
      const publication = confirmed.get(String(run.draftId))
      if (!publication) continue
      run.status = 'succeeded'
      run.publishedId = String(publication.id)
      run.finishedAt = Date.now()
      run.error = ''
      const step = run.steps.find((item) => item.key === 'publish')
      if (step) Object.assign(step, { state: 'done', note: '微信已确认扫码发表成功' })
      store.put('runs', accountId, run)
      store.message(accountId, {
        role: 'bot', text: `微信已确认「${run.name || '运营任务'}」对应的文章发表成功。`,
        event: 'published', runId: run.id, publishedId: run.publishedId,
      })
      changed.push(run)
    }
    return changed
  })
  if (updated.length) notify(accountId)
  return { updated }
}

module.exports = { reconcilePublished }
