// 持久保存公众号资料、会话分区映射和当前账号，不保存密码、Cookie 或令牌。
const { mkdirSync } = require('node:fs')
const { dirname } = require('node:path')
const Database = require('better-sqlite3')

const STATUSES = new Set(['ready', 'checking', 'expired', 'error', 'unknown'])
const PARTITION = /^persist:mp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value.trim()
}

function optionalText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function checkedTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效`)
  return value
}

function checkedStatus(value) {
  if (!STATUSES.has(value)) throw new Error('账号状态无效')
  return value
}

function accountFromRow(row) {
  if (!row) return null
  return { ...row, verified: row.verified === null ? null : row.verified === 1 }
}

function createAccountStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  const database = new Database(dbPath)
  if (database.pragma('user_version', { simple: true }) > 1) {
    database.close()
    throw new Error('账号数据库版本高于当前应用，请使用更新的应用版本')
  }

  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      initial TEXT NOT NULL,
      color TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      verified INTEGER CHECK (verified IN (0, 1) OR verified IS NULL),
      originalId TEXT NOT NULL UNIQUE,
      avatar TEXT NOT NULL,
      status TEXT NOT NULL,
      lastCheckedAt INTEGER NOT NULL,
      partition TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `)

  const queries = {
    list: database.prepare('SELECT * FROM accounts ORDER BY createdAt, id'),
    find: database.prepare('SELECT * FROM accounts WHERE id = ?'),
    original: database.prepare('SELECT * FROM accounts WHERE originalId = ?'),
    partition: database.prepare('SELECT * FROM accounts WHERE partition = ?'),
    active: database.prepare("SELECT value FROM app_settings WHERE key = 'active_account_id'"),
    setActive: database.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('active_account_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    clearActive: database.prepare("DELETE FROM app_settings WHERE key = 'active_account_id'"),
    remove: database.prepare('DELETE FROM accounts WHERE id = ?'),
    status: database.prepare('UPDATE accounts SET status = ?, lastCheckedAt = ? WHERE id = ?'),
    partitionUpdate: database.prepare('UPDATE accounts SET partition = ? WHERE id = ?'),
    save: database.prepare(`
      INSERT INTO accounts (
        id, name, initial, color, type, subject, verified, originalId,
        avatar, status, lastCheckedAt, partition, createdAt
      ) VALUES (
        @id, @name, @initial, @color, @type, @subject, @verified, @originalId,
        @avatar, @status, @lastCheckedAt, @partition, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        initial = excluded.initial,
        color = excluded.color,
        type = excluded.type,
        subject = excluded.subject,
        verified = excluded.verified,
        avatar = excluded.avatar,
        status = excluded.status,
        lastCheckedAt = excluded.lastCheckedAt
    `),
  }

  function find(id) {
    return accountFromRow(queries.find.get(requiredText(id, '账号标识')))
  }

  function findByOriginalId(originalId) {
    return accountFromRow(queries.original.get(requiredText(originalId, '公众号原始标识')))
  }

  function list() {
    return {
      accounts: queries.list.all().map(accountFromRow),
      activeAccountId: queries.active.get()?.value || null,
    }
  }

  function requireAccount(id) {
    const account = find(id)
    if (!account) throw new Error('账号不存在，请重新登录')
    return account
  }

  function normalizeProfile(profile) {
    const id = requiredText(profile.id, '账号标识')
    const existing = find(id)
    const originalId = requiredText(profile.originalId ?? existing?.originalId, '公众号原始标识')
    const partition = requiredText(profile.partition ?? existing?.partition, '会话分区')
    if (!PARTITION.test(partition)) throw new Error('会话分区无效')
    if (existing && (existing.partition !== partition || existing.originalId !== originalId)) {
      throw new Error('不能覆盖已有账号的身份或会话分区')
    }
    if (queries.original.get(originalId)?.id !== id && queries.original.get(originalId)) {
      throw new Error('这个公众号已保存，请使用已有账号')
    }
    if (queries.partition.get(partition)?.id !== id && queries.partition.get(partition)) {
      throw new Error('会话分区已属于其他账号')
    }

    const merged = { ...existing, ...profile }
    const verified = merged.verified ?? null
    if (verified !== null && typeof verified !== 'boolean') throw new Error('认证状态无效')
    const name = requiredText(merged.name, '公众号名称')
    return {
      id,
      name,
      initial: optionalText(merged.initial) || Array.from(name)[0],
      color: optionalText(merged.color) || '#07c160',
      type: optionalText(merged.type),
      subject: optionalText(merged.subject),
      verified: verified === null ? null : Number(verified),
      originalId,
      avatar: optionalText(merged.avatar),
      status: checkedStatus(merged.status ?? 'unknown'),
      lastCheckedAt: checkedTime(merged.lastCheckedAt ?? 0, '验证时间'),
      partition,
      createdAt: existing?.createdAt ?? checkedTime(profile.createdAt ?? Date.now(), '创建时间'),
    }
  }

  const save = database.transaction((profile) => {
    const account = normalizeProfile(profile)
    queries.save.run(account)
    if (!queries.active.get()) queries.setActive.run(account.id)
    return find(account.id)
  })

  const setActive = database.transaction((id) => {
    const account = requireAccount(id)
    queries.setActive.run(account.id)
    return list()
  })

  const setStatus = database.transaction((id, status, lastCheckedAt = Date.now()) => {
    const account = requireAccount(id)
    queries.status.run(checkedStatus(status), checkedTime(lastCheckedAt, '验证时间'), account.id)
    return list()
  })

  const remove = database.transaction((id) => {
    const account = requireAccount(id)
    queries.remove.run(account.id)
    if (queries.active.get()?.value === account.id) {
      const next = queries.list.get()
      if (next) queries.setActive.run(next.id)
      else queries.clearActive.run()
    }
    return list()
  })

  // 仅供主进程确认新分区已登录同一公众号后调用，普通资料保存不能换绑分区。
  const replacePartition = database.transaction((id, newPartition) => {
    const account = requireAccount(id)
    const partition = requiredText(newPartition, '会话分区')
    if (!PARTITION.test(partition)) throw new Error('会话分区无效')
    const owner = queries.partition.get(partition)
    if (owner && owner.id !== account.id) throw new Error('会话分区已属于其他账号')
    queries.partitionUpdate.run(partition, account.id)
    return list()
  })

  return {
    list,
    find,
    findByOriginalId,
    save,
    setActive,
    setStatus,
    remove,
    replacePartition,
    close: () => database.close(),
  }
}

module.exports = { createAccountStore }
