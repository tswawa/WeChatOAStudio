// 汇总真实公众号数据与本地运营记录，持久缓存并逐项展示同步失败原因。
const Database = require('better-sqlite3');
const { createMessageCache } = require('./message-cache.cjs');
const { mergeIncome } = require('./mp/income.cjs');
const { publicationVersion } = require('./mp/publications.cjs');

const CACHE_TTL = 60000;
const PAGE_SECTIONS = {
  home: ['drafts', 'published', 'comments', 'data', 'income'],
  income: ['income'],
  assistant: ['drafts', 'data'],
  bot: [],
  tasks: [],
  drafts: ['drafts'],
  templates: [],
  materials: ['materials'],
  published: ['published'],
  data: ['data'],
  comments: ['comments'],
  messages: ['messages'],
  autoReply: ['autoReply'],
  menu: ['menu'],
  users: ['users'],
  account: ['account'],
  members: ['members'],
  api: [],
  // 后台定时检查：无论停留在哪个页面，都更新新私信和新留言
  watch: ['messages', 'comments'],
};

function sectionKeys(section = 'home') {
  const name = { 'auto-reply': 'autoReply', 'dev-api': 'api', editor: 'drafts' }[section] || section;
  if (!Object.hasOwn(PAGE_SECTIONS, name)) throw new Error('不支持的同步页面');
  return PAGE_SECTIONS[name];
}

function emptyWorkspace() {
  return {
    drafts: [], published: [], materials: [], comments: [], messages: [], members: [], tags: [], users: [],
    followers: null, yesterday: { reads: null, shares: null, newFollowers: null, lost: null },
    weekReads: [], income: { channels: [], updatedAt: null }, autoReply: { follow: '', fallback: '', keywords: [] }, menu: [],
    api: { connected: false, appId: '' }, errors: {}, syncedSections: {}, lastSyncedAt: null,
  };
}

function createWorkspaceService({ dbPath, mp, ops, accounts, notify }) {
  const database = new Database(dbPath);
  database.exec(`CREATE TABLE IF NOT EXISTS mp_cache (
    account_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS drafts_meta (
    account_id TEXT NOT NULL, draft_id TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY(account_id, draft_id)
  );`);
  const query = database.prepare('SELECT body FROM mp_cache WHERE account_id = ?');
  const save = database.prepare(`INSERT INTO mp_cache VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`);
  const metaList = database.prepare('SELECT draft_id, body FROM drafts_meta WHERE account_id = ?');
  const metaSave = database.prepare(`INSERT INTO drafts_meta VALUES (?, ?, ?)
    ON CONFLICT(account_id,draft_id) DO UPDATE SET body=excluded.body`);
  const messageCache = createMessageCache(database);
  const cache = new Map();
  const pending = new Map();
  let closed = false;

  function data(id) {
    if (!cache.has(id)) {
      const saved = query.get(id);
      cache.set(id, { ...emptyWorkspace(), ...(saved ? JSON.parse(saved.body) : {}) });
      const state = cache.get(id);
      state.syncedSections ||= {};
      if (state.account?.avatar && !/^https:\/\/[^/?]*(?:qpic|qlogo)\.cn\//.test(state.account.avatar)) {
        state.account.avatar = '';
      }
    }
    return cache.get(id);
  }

  function persist(id) {
    save.run(id, JSON.stringify(data(id)), Date.now());
    notify(id);
  }

  function snapshot(id) {
    if (!accounts.find(id)) throw new Error('公众号不存在');
    const content = data(id);
    const local = ops.snapshot(id);
    const meta = new Map(metaList.all(id).map((row) => [row.draft_id, JSON.parse(row.body)]));
    return { ...content, ...local, messages: content.messages, chatMessages: local.messages,
      api: mp.getApiConfig(id), apiPublications: mp.getApiPublications?.(id) || [], syncing: Boolean(pending.get(id)?.size),
      syncingSections: [...(pending.get(id)?.keys() || [])],
      drafts: content.drafts.map((draft) => ({ ...draft, ...meta.get(draft.id) })),
    };
  }

  async function readSection(id, key) {
    if (key === 'drafts') return { drafts: await mp.listDrafts(id) };
    if (key === 'materials') return { materials: await mp.listMaterials(id) };
    if (key === 'published') return { published: await mp.listPublished(id) };
    if (key === 'data') return mp.getStats(id);
    if (key === 'income') return mp.getIncome(id);
    return mp.getInteractionPart(id, key);
  }

  function refreshSection(id, key, force) {
    const state = data(id);
    if (pending.get(id)?.has(key)) return pending.get(id).get(key);
    const ttl = key === 'income' ? 5 * CACHE_TTL : CACHE_TTL;
    if (!force && Date.now() - (state.syncedSections[key] || 0) < ttl) {
      return Promise.resolve();
    }
    if (!pending.has(id)) pending.set(id, new Map());
    const busy = pending.get(id);
    const job = Promise.resolve().then(async () => {
      try {
        const { errors, ...values } = await readSection(id, key);
        if (key === 'income') values.income = mergeIncome(state.income, values.income);
        Object.assign(state, values);
        const failures = Array.isArray(errors) ? errors.filter(Boolean) : Object.values(errors || {}).filter(Boolean);
        if (failures.length) {
          state.errors[key] = failures.join('；');
        } else {
          delete state.errors[key];
          state.syncedSections[key] = Date.now();
          state.lastSyncedAt = state.syncedSections[key];
        }
        if (key === 'published') ops.reconcilePublished?.(id, values.published);
      } catch (error) {
        state.errors[key] = error.message;
        console.warn('工作区同步失败', key, error.code || error.name);
      } finally {
        busy.delete(key);
        if (!busy.size) pending.delete(id);
        if (!closed) persist(id);
      }
    });
    busy.set(key, job);
    notify(id);
    return job;
  }

  async function refresh(id, { section = 'home', force = true } = {}) {
    if (closed) throw new Error('应用正在关闭');
    if (!accounts.find(id)) throw new Error('请先登录公众号');
    const keys = sectionKeys(section);
    await Promise.all(keys.map((key) => refreshSection(id, key, force)));
    const errors = Object.fromEntries(keys.filter((key) => data(id).errors[key])
      .map((key) => [key, data(id).errors[key]]));
    return { refreshed: true, section, errors };
  }

  async function savedDraft(id, draft) {
    metaSave.run(id, String(draft.id), JSON.stringify({ origin: draft.origin || 'manual', taskId: draft.taskId }));
    const state = data(id);
    state.drafts = [draft, ...state.drafts.filter((item) => item.id !== draft.id)];
    state.syncedSections.drafts = Date.now();
    persist(id);
    return draft;
  }

  async function handle(action, id, payload = {}) {
    if (closed) throw new Error('应用正在关闭');
    if (!accounts.find(id)) throw new Error('请先登录公众号');
    if (action === 'workspace.get') return snapshot(id);
    if (action === 'content.refresh') return refresh(id, payload);
    if (action === 'content.drafts') return mp.listDrafts(id);
    if (action === 'content.getDraft') return mp.getDraft(id, payload.draftId);
    if (action === 'content.saveDraft') return savedDraft(id, await mp.saveDraft(id, payload.draft));
    if (action === 'content.deleteDraft') {
      const result = await mp.deleteDraft(id, payload.draftId);
      data(id).drafts = data(id).drafts.filter((item) => item.id !== String(payload.draftId));
      persist(id);
      return result;
    }
    if (action === 'content.materials') return mp.listMaterials(id);
    if (action === 'content.uploadMaterial') {
      const result = await mp.uploadMaterial(id, payload);
      data(id).materials.unshift(result);
      persist(id);
      return result;
    }
    if (action === 'content.deleteMaterial') {
      const result = await mp.deleteMaterial(id, payload.id || payload.materialId);
      data(id).materials = data(id).materials.filter((item) => item.id !== String(payload.id || payload.materialId));
      persist(id);
      return result;
    }
    if (action === 'content.published') return mp.listPublished(id);
    if (action === 'content.openEditor') return mp.openEditor(id, payload.draftId);
    if (action === 'content.openPublish') return mp.openPublish(id, payload.draftId);
    if (action === 'data.get') return mp.getStats(id);
    if (action === 'income.get') return mp.getIncome(id);
    if (action === 'income.open') return mp.openIncome(id, payload.source);
    if (action === 'users.get') return mp.getInteractionPart(id, 'users');
    if (action === 'interaction.get') return payload.section
      ? mp.getInteractionPart(id, payload.section) : mp.getInteraction(id);
    // 私信本地缓存：先显示已保存的会话列表和对话，再静默向公众平台刷新
    if (action === 'interaction.cachedMessages') {
      const thread = payload.contactId ? messageCache.thread(id, payload.contactId) : null;
      return { lists: messageCache.lists(id), thread };
    }
    if (action === 'interaction.conversation') {
      const value = await mp.interactionAction(action, id, payload);
      return messageCache.mergeThread(id, value, { older: Boolean(payload.before) });
    }
    if (action === 'interaction.listMessages') {
      const value = await mp.interactionAction(action, id, payload);
      const key = `${payload.unread ? 1 : 0}-${Number(payload.day ?? 7)}-${Number(payload.sort ?? 0)}`;
      if (!payload.before && !payload.offset) messageCache.saveList(id, key, value.conversations);
      return value;
    }
    // 已收藏的人保存在本机，下次进入私信页直接显示；收藏或取消收藏后同步更新
    if (action === 'interaction.starredUsers') {
      const value = await mp.interactionAction(action, id, payload);
      messageCache.saveList(id, 'star', value);
      return value;
    }
    if (action === 'interaction.starUser') {
      const value = await mp.interactionAction(action, id, payload);
      const others = (messageCache.lists(id).star || []).filter((user) => user.id !== value.user.id);
      messageCache.saveList(id, 'star', value.starred ? [value.user, ...others] : others);
      // 用户管理页“星标用户”的人数已变化，下次进入时重新读取
      delete data(id).syncedSections.users;
      return value;
    }
    if (action === 'interaction.deleteConversation') messageCache.removeThread(id, payload.id);
    // 只读的私信查询直接返回，不触发整页重新同步
    if (['interaction.searchMessages',
      'interaction.messageMedia', 'interaction.saveMessageMedia',
      'interaction.saveMessageSettings', 'interaction.messageFile', 'interaction.downloadMessageFile'].includes(action)) {
      return mp.interactionAction(action, id, payload);
    }
    if (action.startsWith('interaction.')) {
      const result = await mp.interactionAction(action, id, payload);
      const section = action === 'interaction.saveAutoReply' ? 'autoReply'
        : action === 'interaction.saveMenu' ? 'menu'
          : action === 'interaction.readMessage' || payload.kind === 'message'
            || /Message|Conversation/.test(action) ? 'messages' : 'comments';
      await refresh(id, { section });
      return result;
    }
    if (action === 'settings.account' || action === 'settings.members') {
      return mp.openSection(id, action === 'settings.account' ? 'account' : 'members');
    }
    if (action === 'publication.quota') {
      try { const quota = await mp.getMassQuota(id); data(id).massQuota = quota; persist(id); return quota; }
      catch (error) { data(id).massQuota = { ...data(id).massQuota, stale: true, error: error.message }; persist(id); throw error; }
    }
    if (action === 'publication.preview') {
      const draft = await mp.getDraft(id, payload.draftId);
      let quota;
      try { quota = await mp.getMassQuota(id); data(id).massQuota = quota; persist(id); }
      catch (error) { quota = { left: null, total: null, period: '当前周期', error: error.message }; }
      return { draft, expectedVersion: publicationVersion(draft), api: mp.getApiConfig(id), quota,
        activePublication: mp.getApiPublications?.(id).find(item => item.draftId === String(payload.draftId) && ['submitting','uncertain','waiting_verification','waiting_confirmation'].includes(item.state)) };
    }
    if (action === 'publication.submit') {
      if (!['publish', 'mass'].includes(payload.mode) || !/^[a-f0-9]{64}$/.test(payload.expectedVersion || '')) throw new Error('请先检查完整草稿并明确选择发表或群发');
      const method = payload.transport ?? 'api';
      if (!['api','web'].includes(method)) throw new Error('请选择普通发送或接口发送');
      const result = await (method === 'web' ? mp.publishOrdinary : mp.publishOfficial)(id, { draftId: payload.draftId, massNotify: payload.mode === 'mass', expectedVersion: payload.expectedVersion });
      notify(id); return result;
    }
    if (action === 'publication.window') return mp.showPublicationWindow(id, payload.id);
    if (action === 'publication.cancel') { const result = await mp.cancelPublication(id, payload.id); notify(id); return result; }
    if (action === 'publication.status') {
      const record = mp.getApiPublications(id).find(item => item.id === payload.id);
      if (!record?.result) throw new Error('该提交尚无可查询的任务编号，请先在公众平台核对');
      const result = await mp.getPublishStatus(id, record.result); notify(id); return result;
    }
    if (action === 'settings.api.get') return mp.getApiConfig(id);
    if (action === 'settings.api.save') { const value = mp.saveApiConfig(id, payload); notify(id); return value; }
    if (action === 'settings.api.test') { const value = await mp.testApi(id); notify(id); return value; }
    return ops.handle(action, id, payload);
  }

  async function close() {
    closed = true;
    await Promise.allSettled([...pending.values()].flatMap((sections) => [...sections.values()]));
    database.close();
  }
  return { handle, snapshot, refresh, savedDraft, close };
}

module.exports = { createWorkspaceService };
