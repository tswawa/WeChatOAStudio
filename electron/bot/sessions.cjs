// Persist account-scoped Bot sessions, migrate old messages and archive new conversations.
// Scheduled runs share one fixed session per account so they do not interrupt the open conversation.
const { randomUUID } = require('node:crypto')

function createSessions(store) {
  const key = (accountId) => `bot-state:${accountId}`
  function record(accountId, title, extra = {}) {
    const now = Date.now()
    return store.put('bot_sessions', accountId, {
      id: `session_${randomUUID()}`, title, createdAt: now, updatedAt: now,
      summary: '', summaryThrough: '', usage: null, ...extra,
    })
  }
  function create(accountId, title = '新会话') {
    const session = record(accountId, title)
    store.put('bot_state', accountId, { id: key(accountId), sessionId: session.id, createdAt: Date.now() })
    return session
  }
  function scheduled(accountId) {
    return store.list('bot_sessions', accountId).find((item) => item.kind === 'schedule')
      || record(accountId, '定时任务', { kind: 'schedule' })
  }
  function get(accountId, id) {
    return store.get('bot_sessions', accountId, id)
  }
  // Ordinary desktop messages never enter the scheduled-task record.
  function conversation(accountId) {
    const current = active(accountId)
    if (current.kind !== 'schedule') return current
    const recent = list(accountId).find((item) => item.kind !== 'schedule')
    return recent ? select(accountId, recent.id) : create(accountId)
  }
  function active(accountId) {
    const saved = store.get('bot_state', accountId, key(accountId))
    const session = saved && store.get('bot_sessions', accountId, saved.sessionId)
    if (session) return session
    return store.transaction(() => {
      const legacy = store.list('messages', accountId).filter((message) => !message.sessionId)
      const first = legacy.find((message) => message.role === 'user')
      const created = create(accountId, first?.text?.slice(0, 32) || '新会话')
      for (const message of legacy) store.put('messages', accountId, { ...message, sessionId: created.id })
      return created
    })
  }
  function messages(accountId, sessionId = active(accountId).id) {
    return store.sessionMessages(accountId, sessionId)
  }
  function update(accountId, id, patch) {
    const session = store.get('bot_sessions', accountId, id)
    if (!session) throw new Error('Bot 会话不存在')
    return store.put('bot_sessions', accountId, { ...session, ...patch, id, updatedAt: Date.now() })
  }
  function list(accountId) {
    active(accountId)
    return store.list('bot_sessions', accountId).sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, kind, createdAt, updatedAt }) => ({ id, title, kind: kind || 'chat', createdAt, updatedAt }))
  }
  function select(accountId, id) {
    if (!store.get('bot_sessions', accountId, id)) throw new Error('Bot 会话不存在或不属于当前公众号')
    store.put('bot_state', accountId, { id: key(accountId), sessionId: id, createdAt: Date.now() })
    return active(accountId)
  }
  function remove(accountId, id) {
    if (!store.get('bot_sessions', accountId, id)) throw new Error('Bot 会话不存在')
    const current = active(accountId)
    store.transaction(() => {
      store.removeSessionMessages(accountId, id)
      store.remove('bot_sessions', accountId, id)
      if (current.id === id) create(accountId)
    })
    return { deleted: true }
  }
  return { active, conversation, create, scheduled, get, messages, update, list, select, remove }
}

module.exports = { createSessions }
