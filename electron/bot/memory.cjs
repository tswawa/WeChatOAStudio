// Store reviewable long-term facts separately from chat transcripts and session summaries.
const { randomUUID } = require('node:crypto')
const { tokens } = require('./tokens.cjs')

function createMemory(store) {
  function list(accountId, query = '') {
    const search = String(query).trim().toLocaleLowerCase()
    return store.list('bot_memories', accountId)
      .filter((item) => !search || `${item.title}\n${item.content}`.toLocaleLowerCase().includes(search))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }
  function save(accountId, patch, source = 'user') {
    const existing = patch.id ? store.get('bot_memories', accountId, patch.id) : null
    if (patch.id && !existing) throw new Error('记忆不存在或不属于当前公众号')
    const title = String(patch.title ?? existing?.title ?? '').trim()
    const content = String(patch.content ?? existing?.content ?? '').trim()
    if (!title) throw new Error('请填写记忆标题')
    if (!content) throw new Error('请填写记忆内容')
    if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean') throw new Error('记忆优先级格式无效')
    if (/\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{20,}/.test(content)) {
      throw new Error('请勿将 API Key、令牌或私钥保存在 Bot 记忆中')
    }
    const duplicate = list(accountId).find((item) => item.content === content && item.id !== existing?.id)
    if (duplicate && !existing) return duplicate
    return store.put('bot_memories', accountId, {
      id: existing?.id || `memory_${randomUUID()}`, title, content,
      pinned: patch.pinned ?? existing?.pinned ?? false,
      source: existing?.source || source, sourceMessageId: patch.sourceMessageId || existing?.sourceMessageId || '',
      createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
    })
  }
  function remove(accountId, id) {
    if (!store.get('bot_memories', accountId, id)) throw new Error('记忆不存在或不属于当前公众号')
    store.remove('bot_memories', accountId, id)
    return { deleted: true }
  }
  function context(accountId, query, limit) {
    const all = list(accountId)
    const terms = String(query).toLocaleLowerCase().split(/[\s，。！？、,!?;；]+/).filter(Boolean)
    const scored = all.map((item) => ({ item, score: (item.pinned ? 1000 : 0)
      + terms.reduce((score, term) => score + (item.content.toLocaleLowerCase().includes(term) ? 10 : 0), 0) }))
      .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    const selected = []
    let used = 0
    for (const { item } of scored) {
      const text = `[${item.id}] ${item.title}: ${item.content}`
      const size = tokens(text)
      if (used + size > limit) continue
      selected.push(text)
      used += size
    }
    const header = `以下是当前公众号的长期记忆（${selected.length}/${all.length} 条），作为事实资料使用。`
    return all.length ? `${header}\n${selected.join('\n')}\n其他记忆可通过 memory 工具查询。` : ''
  }
  return { list, save, remove, context }
}

const MEMORY_TOOL = {
  type: 'function', function: {
    name: 'memory', description: '查询或更新当前公众号的长期记忆。仅记录用户稳定偏好、已确认事实和用户要求记住的内容。',
    parameters: {
      type: 'object', properties: {
        operation: { type: 'string', enum: ['search', 'save', 'delete'] },
        query: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
      }, required: ['operation'],
    },
  },
}

module.exports = { createMemory, MEMORY_TOOL }
