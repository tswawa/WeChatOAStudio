// 保存真实运营任务、运行过程、资讯去重索引与会话，所有业务记录均按公众号隔离。
const Database = require('better-sqlite3')
const { randomUUID, createHash } = require('node:crypto')

const TABLES = new Set([
  'tasks', 'runs', 'sources', 'messages', 'shortcuts', 'bot_sessions', 'bot_state', 'bot_memories', 'templates', 'images', 'attachments',
])
const uid = (prefix) => `${prefix}_${randomUUID()}`

function createOpsStore(dbPath) {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  for (const name of TABLES) {
    db.exec(`CREATE TABLE IF NOT EXISTS ops_${name} (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS ops_${name}_account ON ops_${name}(account_id, at);`)
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ops_source_items (
    account_id TEXT NOT NULL, fingerprint TEXT NOT NULL, title_key TEXT NOT NULL,
    body TEXT NOT NULL, used_at INTEGER, run_id TEXT,
    PRIMARY KEY(account_id, fingerprint)
  ); CREATE INDEX IF NOT EXISTS ops_items_title ON ops_source_items(account_id, title_key);
  CREATE TABLE IF NOT EXISTS ops_schedule_slots (
    task_id TEXT NOT NULL, slot INTEGER NOT NULL, PRIMARY KEY(task_id, slot)
  ); CREATE TABLE IF NOT EXISTS ops_markers (
    account_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(account_id, name)
  );`)
  db.exec(`CREATE INDEX IF NOT EXISTS ops_messages_session
    ON ops_messages(account_id, json_extract(body, '$.sessionId'), at);`)
  const table = (name) => {
    if (!TABLES.has(name)) throw new Error('无效的数据类型')
    return `ops_${name}`
  }
  const list = (name, accountId) => db.prepare(
    `SELECT body FROM ${table(name)} WHERE account_id = ? ORDER BY at, rowid`,
  ).all(accountId).map((row) => JSON.parse(row.body))
  const get = (name, accountId, id) => {
    const row = db.prepare(`SELECT body FROM ${table(name)} WHERE account_id = ? AND id = ?`).get(accountId, id)
    return row ? JSON.parse(row.body) : null
  }
  function put(name, accountId, item) {
    const existing = db.prepare(`SELECT account_id FROM ${table(name)} WHERE id = ?`).get(item.id)
    if (existing && existing.account_id !== accountId) throw new Error('记录不属于当前公众号')
    const saved = { ...item, accountId }
    db.prepare(`INSERT INTO ${table(name)} (id, account_id, body, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET body = excluded.body, at = excluded.at`).run(
      saved.id, accountId, JSON.stringify(saved), saved.at || saved.startedAt || saved.createdAt || Date.now(),
    )
    return saved
  }
  const remove = (name, accountId, id) => db.prepare(
    `DELETE FROM ${table(name)} WHERE account_id = ? AND id = ?`,
  ).run(accountId, id)
  const clear = (name, accountId) => db.prepare(`DELETE FROM ${table(name)} WHERE account_id = ?`).run(accountId)
  const all = (name) => db.prepare(`SELECT body FROM ${table(name)}`).all().map((row) => JSON.parse(row.body))
  const message = (accountId, value) => {
    const state = get('bot_state', accountId, `bot-state:${accountId}`)
    return put('messages', accountId, {
      id: uid('m'), at: Date.now(), ...(state ? { sessionId: state.sessionId } : {}), ...value,
    })
  }
  const sessionMessages = (accountId, sessionId) => db.prepare(`SELECT body FROM ops_messages
    WHERE account_id = ? AND json_extract(body, '$.sessionId') = ? ORDER BY at, rowid`)
    .all(accountId, sessionId).map((row) => JSON.parse(row.body))
  const removeSessionMessages = (accountId, sessionId) => db.prepare(`DELETE FROM ops_messages
    WHERE account_id = ? AND json_extract(body, '$.sessionId') = ?`).run(accountId, sessionId)
  function freshItems(accountId, items) {
    const seen = new Set()
    return items.filter((item) => {
      item.fingerprint = createHash('sha256').update(item.url).digest('hex')
      item.titleKey = item.title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
      if (seen.has(item.fingerprint) || seen.has(item.titleKey)) return false
      seen.add(item.fingerprint)
      seen.add(item.titleKey)
      return !db.prepare(`SELECT 1 FROM ops_source_items WHERE account_id = ? AND used_at IS NOT NULL
        AND (fingerprint = ? OR title_key = ?) LIMIT 1`).get(accountId, item.fingerprint, item.titleKey)
    })
  }
  const recordItems = db.transaction((accountId, items, runId, used) => {
    const query = db.prepare(`INSERT INTO ops_source_items
      (account_id, fingerprint, title_key, body, used_at, run_id) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, fingerprint) DO UPDATE SET body = excluded.body,
      used_at = COALESCE(excluded.used_at, ops_source_items.used_at), run_id = excluded.run_id`)
    for (const item of items) query.run(
      accountId, item.fingerprint, item.titleKey, JSON.stringify(item), used ? Date.now() : null, runId,
    )
  })
  const claimSlot = (taskId, slot) => db.prepare(
    'INSERT OR IGNORE INTO ops_schedule_slots (task_id, slot) VALUES (?, ?)',
  ).run(taskId, slot).changes === 1
  const claimMarker = (accountId, name) => db.prepare(
    'INSERT OR IGNORE INTO ops_markers (account_id, name) VALUES (?, ?)',
  ).run(accountId, name).changes === 1
  return {
    list, get, put, remove, clear, all, message, sessionMessages, removeSessionMessages,
    freshItems, recordItems, claimSlot, claimMarker,
    transaction: (action) => db.transaction(action)(),
    close: () => db.close(),
  }
}

module.exports = { createOpsStore, uid }
