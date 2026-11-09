// 私信本地持久缓存：按公众号和联系人保存已读取的完整对话，按公众号和筛选条件保存会话列表和已收藏的人，重启后可直接显示。
const MAX_THREAD_ITEMS = 2000;

function createMessageCache(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS message_threads (
    account_id TEXT NOT NULL, contact_id TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id, contact_id)
  ); CREATE TABLE IF NOT EXISTS message_lists (
    account_id TEXT NOT NULL, filter_key TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id, filter_key)
  );`);
  const threadGet = database.prepare('SELECT body FROM message_threads WHERE account_id = ? AND contact_id = ?');
  const threadSave = database.prepare(`INSERT INTO message_threads VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, contact_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
  const listAll = database.prepare('SELECT filter_key, body FROM message_lists WHERE account_id = ?');
  const listSave = database.prepare(`INSERT INTO message_lists VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, filter_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
  const threadRemove = database.prepare('DELETE FROM message_threads WHERE account_id = ? AND contact_id = ?');

  function read(row) {
    try {
      return row ? JSON.parse(row.body) : null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  function thread(accountId, contactId) {
    return read(threadGet.get(accountId, String(contactId)));
  }

  // 合并最新读取的一页：同一条消息以新数据为准，保留更早的已缓存消息；
  // older=true 时这一页是更早的历史，接在前面，不改变“是否还有更早消息”以外的会话资料
  function mergeThread(accountId, value, { older = false } = {}) {
    if (!value?.id) return value;
    const cached = thread(accountId, value.id);
    let merged = value;
    if (cached?.items?.length) {
      const fresh = new Map(value.items.map((item) => [item.id, item]));
      // 刷新最新一页时保留比这一页更早的缓存消息；比这一页更新的缓存消息来自更晚返回的请求，也保留，
      // 避免先发出、后返回的旧请求把新消息覆盖掉
      const oldest = value.items[0]?.at ?? Infinity;
      const newest = value.items.at(-1)?.at ?? -Infinity;
      const kept = cached.items.filter((item) => !fresh.has(item.id)
        && (older || item.at < oldest || item.at > newest));
      const items = [...kept, ...value.items].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
      const base = older ? { ...cached, hasMore: value.hasMore }
        : { ...value, hasMore: kept.length ? cached.hasMore : value.hasMore };
      merged = { ...base, items };
    }
    merged = { ...merged, items: merged.items.slice(-MAX_THREAD_ITEMS) };
    threadSave.run(accountId, String(value.id), JSON.stringify(merged), Date.now());
    return merged;
  }

  function lists(accountId) {
    return Object.fromEntries(listAll.all(accountId).map((row) => [row.filter_key, read(row)])
      .filter(([, value]) => value));
  }

  // filterKey 为筛选条件（未读-私信状态-排序），star 为已收藏的人
  function saveList(accountId, filterKey, conversations) {
    if (!/^(?:[01]-\d{1,2}-\d|star)$/.test(filterKey)) return;
    listSave.run(accountId, filterKey, JSON.stringify(conversations), Date.now());
  }

  // 删除聊天后清掉这个联系人的缓存，避免已删除的消息再次显示
  function removeThread(accountId, contactId) {
    threadRemove.run(accountId, String(contactId));
  }

  return { thread, mergeThread, lists, saveList, removeThread };
}

module.exports = { createMessageCache };
