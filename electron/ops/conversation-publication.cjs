const { createHash } = require('node:crypto')
const { resolveAuthorAuthorization } = require('./author-authorization.cjs')
const { publicationVersion } = require('../mp/publications.cjs')

const articleVersion = message => createHash('sha256').update(JSON.stringify([message.card.action, message.card.payload])).digest('hex')

function createConversationPublication({ store, localArticle, findDraft, propose, confirm }) {
  const refresh = (accountId, message) => { message.card = store.get('messages', accountId, message.id).card }
  function annotate(accountId, message, authorization) {
    const current = store.get('messages', accountId, message.id)
    if (current.card.state !== 'open') throw new Error('作者已处理或取消这篇稿件，未继续自动发送')
    current.card.automaticallyConfirmed = true
    current.card.authorization = { source: 'author_message', messageId: authorization.sourceMessageId }
    store.put('messages', accountId, current)
    message.card = current.card
  }
  function source(accountId, messageId, sessionId) {
    const message = store.get('messages', accountId, messageId)
    if (!message || message.sessionId !== sessionId || !['draft.create','draft.update'].includes(message.card?.action)
      || !['open','done'].includes(message.card.state) || !message.card.payload?.html) {
      throw new Error('目标文章不在当前会话、已经取消或状态需要核实，未执行保存或发表')
    }
    return message
  }
  async function authorize(accountId, context) {
    const latest = localArticle(accountId, context.sessionId)
    const usableLatest = latest && ['open','done'].includes(latest.card.state) ? latest : null
    const decision = await resolveAuthorAuthorization(context.settings, { ...context,
      targets: { focusedDraft: Boolean(context.focusDraftId), latestArticle: Boolean(usableLatest) } })
    if (!decision) return null
    context.signal.throwIfAborted()
    const authorization = { ...decision, accountId, sessionId: context.sessionId, sourceMessageId: context.currentMessageId,
      active: true, remaining: decision.count, attempted: new Set() }
    if (decision.scope === 'latest_article') {
      authorization.article = { messageId: usableLatest.id, version: articleVersion(usableLatest) }
      if (usableLatest.card.state === 'done') authorization.draftId = usableLatest.card.savedDraftId || usableLatest.card.payload.id
    }
    if (decision.scope === 'focused_draft') authorization.draftId = String(context.focusDraftId)
    if (authorization.draftId) authorization.version = publicationVersion(await findDraft(accountId, authorization.draftId))
    context.signal.throwIfAborted()
    return authorization
  }
  async function execute(accountId, proposal, context) {
    const grant = context.authorization
    if (!grant?.active || grant.accountId !== accountId || grant.sessionId !== context.sessionId
      || grant.sourceMessageId !== context.currentMessageId || grant.remaining < 1) return null
    const action = proposal.card.action, payload = proposal.card.payload
    const newArticle = action === 'draft.create' && grant.scope === 'new_article'
    if (!newArticle && action !== 'draft.publish') return null
    if (newArticle && !payload.cover?.url && !payload.cover?.mediaId) return null
    if (!newArticle) {
      if (payload.mode !== grant.transport || payload.massNotify !== grant.massNotify) return null
      if (grant.scope === 'new_article') return null
      if (grant.scope === 'latest_article') {
        const original = source(accountId, grant.article.messageId, context.sessionId)
        if (articleVersion(original) !== grant.article.version) throw new Error('本次指令后文章已经变化，未沿用原授权发送，请核对当前稿件')
        if (payload.sourceMessageId !== original.id && String(payload.id) !== String(grant.draftId || '')) return null
      }
      if (grant.draftId && (String(payload.id) !== String(grant.draftId) || payload.expectedVersion !== grant.version)) return null
    }
    const fingerprint = newArticle ? articleVersion(proposal) : JSON.stringify([payload.id, payload.sourceMessageId, payload.expectedVersion])
    if (grant.attempted.has(fingerprint)) throw new Error('本轮已经处理过相同稿件，不自动重放，请核对先前实际结果')
    context.signal.throwIfAborted()
    grant.attempted.add(fingerprint)
    grant.remaining -= 1
    annotate(accountId, proposal, grant)
    let publication = proposal
    try {
      if (newArticle) {
        const saved = await confirm(accountId, proposal.id, undefined, { signal: context.signal })
        context.signal.throwIfAborted()
        publication = await propose(accountId, { action: 'draft.publish',
          title: grant.massNotify ? '按本次指令发表并群发通知' : '按本次指令发表文章',
          detail: `${grant.transport === 'api' ? '接口发送' : '普通发送'}；${grant.massNotify ? '通知全部粉丝，占用实际群发次数' : '不群发通知'}。仅作用于本次新建的文章。`,
          payload: { id: String(saved.result.id), mode: grant.transport, massNotify: grant.massNotify } }, context.sessionId, context.text)
        context.created.push(publication)
        annotate(accountId, publication, grant)
      }
      context.signal.throwIfAborted()
      const sent = await confirm(accountId, publication.id, undefined, { signal: context.signal })
      return { executed: true, transport: sent.result?.transport || grant.transport, massNotify: sent.result?.massNotify ?? grant.massNotify, result: sent.result,
        remainingArticles: grant.remaining, message: sent.result?.reused ? '该版本已有发送记录，未重复发送、切换方式或补发通知'
          : sent.result?.status === 'succeeded' ? '微信已确认成功'
          : ['preparing','prepared','submitting'].includes(sent.result?.status) ? '正在内部执行微信正常发送流程，尚未取得提交回执；没有要求作者重复确认'
            : sent.result?.status === 'cancelled' ? '本次发送已取消，未提交微信'
              : ['waiting_verification','waiting_confirmation'].includes(sent.result?.status) ? '已暂停在微信确认步骤，请在微信窗口完成；没有绕过验证'
                : '已按本次明确指令提交，最终结果以微信回执为准；没有切换发送方式或通知范围' }
    } finally {
      refresh(accountId, proposal)
      if (publication !== proposal) refresh(accountId, publication)
    }
  }
  return { authorize, execute, source, articleVersion }
}

module.exports = { createConversationPublication, articleVersion }
