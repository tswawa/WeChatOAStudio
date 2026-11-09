// Durable publication receipts prevent retries after an ambiguous network response or restart.
const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync } = require('node:fs')
const { dirname } = require('node:path')
const { createHash } = require('node:crypto')

function publicationVersion(draft) {
  const article = value => {
    const fields = [value.id || '', value.title || '', value.digest || '', value.html || value.content || '',
      value.cover || null, value.author || '', value.sourceUrl || '', value.itemShowType || 0,
      value.copyrightType || 0, value.canReward === true, value.isPaySubscribe === true,
      value.needOpenComment === true, value.onlyFansCanComment === true]
    if (Number(value.itemShowType) === 8) fields.push((value.images || []).map(image => [image.fileId, image.url, image.width, image.height]))
    return fields
  }
  return createHash('sha256').update(JSON.stringify(draft.articles?.length ? draft.articles.map(article) : article(draft))).digest('hex')
}

function createPublicationJournal(filename) {
  let records = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {}
  if (!records || typeof records !== 'object' || Array.isArray(records)
    || Object.entries(records).some(([id,record]) => !record || record.id !== id || typeof record.accountId !== 'string' || typeof record.state !== 'string')) throw new Error('发表回执文件结构异常，已停止发送以防重复；请保留文件并检查')
  function put(accountId, record) {
    if (records[record.id] && records[record.id].accountId !== accountId) throw new Error('发表记录不属于当前公众号')
    const saved = { ...record, accountId, updatedAt: Date.now() }
    const next = { ...records, [record.id]: saved }
    mkdirSync(dirname(filename), { recursive: true })
    const fd = openSync(`${filename}.tmp`, 'w', 0o600)
    try { writeFileSync(fd, JSON.stringify(next, null, 2)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(`${filename}.tmp`, filename)
    records = next
    return saved
  }
  const get = (accountId, id) => records[id]?.accountId === accountId ? structuredClone(records[id]) : null
  const list = accountId => Object.values(records).filter(record => record.accountId === accountId)
    .sort((a,b) => b.updatedAt - a.updatedAt).map(record => structuredClone(record))
  return { get, put, list }
}

module.exports = { publicationVersion, createPublicationJournal }
