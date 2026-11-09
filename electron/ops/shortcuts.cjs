// 仅在每个公众号首次迁移时添加原有六条快捷语句，删除后不再补回。
const { normalizeShortcut } = require('./tasks.cjs')

const DEFAULT_SHORTCUTS = [
  '每天8点整理行业资讯9点提醒我发表',
  '现在写一篇试试',
  '检查一下排版',
  '把这篇发了',
  '有哪些任务',
  '昨天数据怎么样',
]

function initializeShortcuts(store, accountId) {
  return store.transaction(() => {
    if (!store.claimMarker(accountId, 'default-shortcuts-v1')) return false
    const existing = new Set(store.list('shortcuts', accountId).map((item) => item.content))
    for (const content of DEFAULT_SHORTCUTS) {
      if (!existing.has(content)) {
        store.put('shortcuts', accountId, normalizeShortcut({ name: content, content }, null, accountId))
      }
    }
    return true
  })
}

module.exports = { initializeShortcuts, DEFAULT_SHORTCUTS }
