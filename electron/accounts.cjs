// 管理真实登录、会话复核与有界恢复；微信会话和密码始终留在主进程。
const { randomUUID } = require('node:crypto');
const { createMpWindow, clearMpSession } = require('./mp/windows.cjs');
const { createBackgroundPage } = require('./mp/background-page.cjs');
const { readIdentity, normalizeIdentity, isMpUrl } = require('./mp/identity.cjs');
const { fillPasswordLogin, readSubmittedState } = require('./mp/password-login.cjs');

const CHECK_INTERVAL = 60 * 1000;
const HEALTH_INTERVAL = 5 * 60 * 1000;
const MAX_BACKOFF = 15 * 60 * 1000;
const HANDOVER_COOLDOWN = 10 * 60 * 1000;

function bounded(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  })]).finally(() => clearTimeout(timer));
}

function createAccountService({ store, parent, changed, status, credentials = null }) {
  const windows = new Map();
  const checks = new Map();
  const autoLogins = new Map();
  const handovers = new Map();
  const health = new Map();
  const proofs = new Map();
  const background = new Map();
  const loggingOut = new Set();
  let timer = null;
  let waking = false;
  let shuttingDown = false;

  function snapshot() {
    const saved = store.list();
    return {
      activeAccountId: saved.activeAccountId,
      accounts: saved.accounts.map(({ partition, ...account }) => ({
        ...account,
        autoLogin: credentials ? credentials.status(account.id) : { saved: false },
        avatar: /^https:\/\/[^/?]*(?:qpic|qlogo)\.cn\//.test(account.avatar || '') ? account.avatar : '',
      })),
    };
  }

  function emit() {
    const value = snapshot();
    if (!shuttingDown) changed(value);
    return value;
  }

  function getAccount(id) {
    if (typeof id !== 'string') throw new Error('请选择公众号');
    const account = store.find(id);
    if (!account) throw new Error('公众号不存在，请重新登录');
    return account;
  }

  const live = (account) => !shuttingDown && !loggingOut.has(account.id)
    && store.find(account.id)?.partition === account.partition;

  function report(message, error) {
    console.warn(message, error?.code || error?.name || '');
    if (!shuttingDown) status({ message, kind: 'error' });
  }

  function backgroundPage(account, url) {
    const page = createBackgroundPage({ partition: account.partition });
    const close = page.close;
    if (!background.has(account.id)) background.set(account.id, new Set());
    background.get(account.id).add(page);
    page.url = url || page.url;
    page.close = () => {
      background.get(account.id)?.delete(page);
      close();
    };
    return page;
  }

  function closeBackground(id) {
    for (const page of background.get(id) || []) page.close();
    background.delete(id);
  }

  async function cleanPartition(partition) {
    try {
      await clearMpSession(partition);
    } catch (error) {
      report('清理公众号会话失败，请重试退出账号', error);
      throw new Error('清理公众号会话失败，请重试');
    }
  }

  function closePartition(partition) {
    const record = windows.get(partition);
    if (record && !record.window.isDestroyed()) record.window.close();
  }

  function confirmSession(id, partition) {
    const account = store.find(id);
    if (!account || account.partition !== partition || !live(account)) return false;
    proofs.set(id, (proofs.get(id) || 0) + 1);
    health.set(id, { checkedAt: Date.now(), nextAt: Date.now() + HEALTH_INTERVAL, failures: 0 });
    const wasReady = account.status === 'ready';
    if (!wasReady || Date.now() - account.lastCheckedAt >= CHECK_INTERVAL) {
      store.setStatus(id, 'ready');
      if (!wasReady) emit();
    }
    return true;
  }

  function saveIdentity(identity, partition, expectedId, activate) {
    if (expectedId && identity.id !== expectedId) {
      const error = new Error('当前登录的公众号与所选账号不同，请重新登录正确的公众号');
      error.code = 'MP_ACCOUNT_MISMATCH';
      throw error;
    }
    const existing = store.findByOriginalId(identity.originalId);
    const oldPartition = existing?.partition;
    if (existing && oldPartition !== partition) {
      closePartition(oldPartition);
      store.replacePartition(existing.id, partition);
    }
    const account = store.save({
      ...existing, ...identity,
      type: identity.type || existing?.type || '',
      subject: identity.subject || existing?.subject || '',
      verified: identity.verified ?? existing?.verified ?? null,
      partition, status: 'ready', lastCheckedAt: Date.now(),
    });
    proofs.set(account.id, (proofs.get(account.id) || 0) + 1);
    health.set(account.id, { checkedAt: Date.now(), nextAt: Date.now() + HEALTH_INTERVAL, failures: 0 });
    if (activate) store.setActive(account.id);
    emit();
    if (oldPartition && oldPartition !== partition) {
      void cleanPartition(oldPartition).catch((error) => console.warn('旧会话清理未完成', error.name));
    }
    return account;
  }

  function login(id, { autofill = false, url } = {}) {
    const account = id ? getAccount(id) : null;
    if (shuttingDown || (account && loggingOut.has(id))) return { opened: false };
    const partition = account?.partition || `persist:mp-${randomUUID()}`;
    const existing = account ? windows.get(partition) : [...windows.values()].find((entry) => entry.newLogin);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.focus();
      if (existing.needsReload()) {
        void existing.reload().catch((error) => report('微信登录页加载失败，请重新加载', error));
      }
      return { opened: true };
    }
    const page = createMpWindow({ partition, parent: parent(), show: true, title: '登录微信公众平台' });
    const record = { ...page, newLogin: !account, completed: false, inspecting: false, rejected: false,
      autofill: autofill && account ? credentials?.get(account.id) : null };
    windows.set(partition, record);
    const inspect = async () => {
      if (record.inspecting || record.completed || record.rejected || page.contents.isDestroyed()
        || shuttingDown || (account && !live(account))) return;
      record.inspecting = true;
      try {
        const identity = normalizeIdentity(await readIdentity(page.contents));
        if (shuttingDown || (account && !live(account))) return;
        if (!identity && record.autofill && !page.contents.isDestroyed()) {
          if (await fillPasswordLogin(page.contents, record.autofill) === 'submitted') record.autofill = null;
          return;
        }
        if (!identity || page.contents.isDestroyed() || !windows.has(partition)) return;
        if (account && identity.id !== account.id) {
          record.rejected = true;
          store.setStatus(account.id, 'error');
          emit();
          status({ message: '登录了不同的公众号，请重新登录所选公众号', kind: 'error' });
          return;
        }
        saveIdentity(identity, partition, account?.id, true);
        record.completed = true;
        if (account) handovers.delete(account.id);
        await page.session.flushStorageData();
        await page.session.cookies.flushStore();
        status({ message: '公众号登录成功', kind: 'success' });
        if (!page.window.isDestroyed()) page.window.close();
        parent()?.focus();
      } catch (error) {
        if (!page.contents.isDestroyed()) report('读取公众号信息失败，可关闭登录窗口后重试', error);
      } finally { record.inspecting = false; }
    };
    const inspectTimer = setInterval(inspect, 1200);
    page.contents.on('did-finish-load', inspect);
    page.contents.on('did-navigate-in-page', inspect);
    page.window.on('closed', () => {
      clearInterval(inspectTimer);
      if (windows.get(partition) === record) windows.delete(partition);
      if (!record.completed && !shuttingDown && (!account || !loggingOut.has(id))) {
        status({ message: '登录窗口已关闭', kind: 'info' });
        if (record.newLogin || record.rejected) {
          void cleanPartition(partition).catch((error) => console.warn('登录会话清理失败', error.name));
        }
      }
    });
    void page.contents.loadURL(url && isMpUrl(url) ? url : page.url).catch((error) => {
      if (!page.contents.isDestroyed()) report('微信登录页加载失败，请检查网络后重新打开', error);
    });
    return { opened: true };
  }

  async function checkAccount(id) {
    const account = getAccount(id);
    if (!live(account)) return snapshot();
    const proof = proofs.get(id) || 0;
    store.setStatus(id, 'checking');
    emit();
    // 已打开窗口中的 token 仅用于本账号的官方页面导航，不向界面或磁盘导出。
    const visible = windows.get(account.partition);
    let url;
    if (visible && !visible.contents.isDestroyed() && !visible.needsReload()) {
      const identity = normalizeIdentity(await bounded(readIdentity(visible.contents), 5000, '微信身份读取超时').catch(() => null));
      if (identity?.id === id && isMpUrl(visible.contents.getURL())) url = visible.contents.getURL();
    }
    if (!live(account) || (proofs.get(id) || 0) !== proof) return snapshot();
    const page = backgroundPage(account, url);
    let loadError = null;
    let finished = false;
    page.contents.on('dom-ready', () => { finished = true; });
    void page.contents.loadURL(page.url).catch((error) => { loadError = error; });
    try {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline && live(account)) {
        if ((proofs.get(id) || 0) !== proof) return snapshot();
        if (loadError) throw loadError;
        if (finished) {
          const inspected = await bounded(readIdentity(page.contents), 5000, '微信身份读取超时');
          if (!live(account) || (proofs.get(id) || 0) !== proof) return snapshot();
          const identity = normalizeIdentity(inspected);
          if (identity) {
            saveIdentity(identity, account.partition, id, false);
            return snapshot();
          }
          if (inspected?.loginRequired) {
            store.setStatus(id, 'expired');
            emit();
            page.close();
            return autoLogin(id);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (live(account) && (proofs.get(id) || 0) === proof) {
        store.setStatus(id, 'error');
        emit();
      }
    } catch (error) {
      if (live(account) && (proofs.get(id) || 0) === proof) {
        store.setStatus(id, 'error');
        emit();
        console.warn('公众号会话暂时无法验证', error.code || error.name);
      }
    } finally { page.close(); }
    return snapshot();
  }

  function autoLogin(id) {
    if (!autoLogins.has(id)) {
      autoLogins.set(id, Promise.resolve().then(() => runAutoLogin(id)).finally(() => autoLogins.delete(id)));
    }
    return autoLogins.get(id);
  }

  async function runAutoLogin(id) {
    const account = getAccount(id);
    if (!live(account) || !credentials?.status(id).saved || credentials.status(id).failure
      || windows.has(account.partition) || Date.now() - (handovers.get(id) || 0) < HANDOVER_COOLDOWN
      || (credentials.canAttempt && !credentials.canAttempt(id))) return snapshot();
    const saved = credentials.get(id);
    if (!saved) return snapshot();
    const page = backgroundPage(account);
    const proof = proofs.get(id) || 0;
    try {
      await bounded(page.contents.loadURL(page.url), 25000, '微信登录页加载超时');
      const deadline = Date.now() + 30000;
      let submitted = false;
      let reserved = false;
      let loginRequired = false;
      while (Date.now() < deadline && live(account) && credentials.status(id).saved) {
        if ((proofs.get(id) || 0) !== proof) return snapshot();
        const inspected = await bounded(readIdentity(page.contents), 5000, '微信身份读取超时');
        if (!live(account) || !credentials.status(id).saved || (proofs.get(id) || 0) !== proof) return snapshot();
        const identity = normalizeIdentity(inspected);
        if (identity) {
          if (identity.id !== id) {
            credentials.markFailed(id, '保存的账号登录了其他公众号，请更新登录资料');
            throw new Error('保存的账号登录了其他公众号');
          }
          saveIdentity(identity, account.partition, id, false);
          credentials.clearFailure(id);
          await page.session.flushStorageData();
          await page.session.cookies.flushStore();
          return snapshot();
        }
        loginRequired ||= Boolean(inspected?.loginRequired);
        if (!submitted && loginRequired) {
          if (!reserved) {
            if (credentials.claimAttempt && !credentials.claimAttempt(id)) return snapshot();
            reserved = true;
          }
          const result = await fillPasswordLogin(page.contents, saved);
          submitted = result === 'submitted';
        } else if (submitted) {
          const state = await readSubmittedState(page.contents);
          if (!live(account) || !credentials.status(id).saved) return snapshot();
          if (state.error) {
            credentials.markFailed(id, state.error);
            store.setStatus(id, 'expired');
            emit();
            return snapshot();
          }
          if (state.verify) {
            const url = page.contents.getURL();
            store.setStatus(id, 'expired');
            emit();
            handovers.set(id, Date.now());
            page.close();
            // 不重新填密码；扫码、验证码与手机确认只由用户在微信官方页完成。
            login(id, { url });
            status({ message: `「${account.name}」需要在微信完成安全验证`, kind: 'info' });
            return snapshot();
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (live(account) && (proofs.get(id) || 0) === proof) {
        store.setStatus(id, submitted || loginRequired ? 'expired' : 'error');
        emit();
      }
    } catch (error) {
      if (live(account) && (proofs.get(id) || 0) === proof) {
        store.setStatus(id, 'error');
        emit();
        console.warn('自动登录未完成，已停止本次尝试', error.code || error.name);
      }
    } finally { page.close(); }
    return snapshot();
  }

  function saveLogin(id, value) {
    getAccount(id);
    if (!credentials) throw new Error('当前环境不支持保存密码');
    credentials.save(id, value || {});
    handovers.delete(id);
    return emit();
  }

  function forgetLogin(id) {
    getAccount(id);
    credentials?.remove(id);
    return emit();
  }

  function refresh(id, { automatic = false, recovery = false } = {}) {
    const account = getAccount(id);
    if (!live(account)) return Promise.resolve(snapshot());
    if (checks.has(id)) return checks.get(id);
    const previous = health.get(id);
    const due = (recovery || account.status !== 'ready') && previous?.failures === 0
      ? previous.checkedAt + CHECK_INTERVAL : previous?.nextAt;
    if (automatic && due && Date.now() < due) return Promise.resolve(snapshot());
    const pending = Promise.resolve().then(() => checkAccount(id)).finally(() => {
      checks.delete(id);
      if (!live(account)) return;
      const ready = store.find(id).status === 'ready';
      const failures = ready ? 0 : Math.min((previous?.failures || 0) + 1, 5);
      health.set(id, { checkedAt: Date.now(), failures,
        nextAt: Date.now() + (ready ? HEALTH_INTERVAL : Math.min(MAX_BACKOFF, CHECK_INTERVAL * 2 ** (failures - 1))) });
    });
    checks.set(id, pending);
    return pending;
  }

  async function recover(id, { confirmedExpired = false, observedAt = 0 } = {}) {
    const account = store.find(id);
    if (!account || !live(account)) return false;
    if (confirmedExpired && account.lastCheckedAt <= observedAt && !checks.has(id)) {
      store.setStatus(id, 'expired');
      emit();
    }
    await refresh(id, { automatic: true, recovery: true });
    return live(account) && store.find(id)?.status === 'ready';
  }

  async function wake() {
    if (shuttingDown || waking) return;
    waking = true;
    try {
      const saved = store.list();
      for (const account of saved.accounts) {
        if (!live(account)) continue;
        if (account.id !== saved.activeAccountId && account.status === 'ready') continue;
        const previous = health.get(account.id);
        if (!previous && account.status === 'ready' && Date.now() - account.lastCheckedAt < HEALTH_INTERVAL) continue;
        await refresh(account.id, { automatic: true });
      }
    } catch (error) {
      if (!shuttingDown) console.warn('微信会话后台复核未完成', error.code || error.name);
    } finally { waking = false; }
  }

  function switchAccount(id) {
    getAccount(id);
    store.setActive(id);
    void wake();
    return emit();
  }

  async function logout(id, beforeClear = async () => {}) {
    const account = getAccount(id);
    loggingOut.add(id);
    try {
      closePartition(account.partition);
      closeBackground(id);
      await Promise.allSettled([checks.get(id), autoLogins.get(id)]);
      await beforeClear();
      await cleanPartition(account.partition);
      credentials?.remove(id);
      store.remove(id);
      health.delete(id);
      proofs.delete(id);
      return emit();
    } finally { loggingOut.delete(id); }
  }

  function openPlatform(id) {
    const account = getAccount(id);
    const existing = windows.get(account.partition);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.focus();
      if (existing.needsReload()) {
        void existing.reload().catch((error) => report('公众平台加载失败，请重新加载', error));
      }
      return { opened: true };
    }
    const page = createMpWindow({ partition: account.partition, parent: parent(), show: true });
    windows.set(account.partition, page);
    let inspecting = false;
    const inspect = async () => {
      if (inspecting || !live(account) || page.contents.isDestroyed()) return;
      inspecting = true;
      try {
        const identity = normalizeIdentity(await readIdentity(page.contents));
        if (!identity || !live(account) || page.contents.isDestroyed()) return;
        if (identity.id === id) saveIdentity(identity, account.partition, id, false);
        else {
          store.setStatus(id, 'error');
          emit();
        }
      } catch (error) {
        if (live(account)) console.warn('公众平台身份暂时无法读取', error.code || error.name);
      } finally { inspecting = false; }
    };
    page.contents.on('did-finish-load', inspect);
    page.contents.on('did-navigate-in-page', inspect);
    page.window.on('focus', () => {
      if (live(account)) void refresh(id, { automatic: true }).catch((error) => console.warn('公众号状态更新失败', error.name));
    });
    page.window.on('closed', () => {
      if (windows.get(account.partition) === page) windows.delete(account.partition);
      if (live(account)) void refresh(id, { automatic: true }).catch((error) => console.warn('公众号状态更新失败', error.name));
    });
    void page.contents.loadURL(page.url).catch((error) => report('公众平台打开失败，请检查网络后重试', error));
    return { opened: true };
  }

  function prepareRestore() {
    for (const account of store.list().accounts) store.setStatus(account.id, 'checking', account.lastCheckedAt);
  }

  async function restore() {
    for (const account of store.list().accounts) {
      if (shuttingDown) break;
      await refresh(account.id);
    }
    if (!timer && !shuttingDown) {
      timer = setInterval(() => { void wake(); }, CHECK_INTERVAL);
      timer.unref();
    }
  }

  async function close() {
    shuttingDown = true;
    clearInterval(timer);
    for (const id of background.keys()) closeBackground(id);
    for (const record of windows.values()) {
      if (!record.window.isDestroyed()) record.window.close();
    }
    await Promise.allSettled([...checks.values(), ...autoLogins.values()]);
  }

  return {
    snapshot, login, refresh, switchAccount, logout, openPlatform, prepareRestore, restore, close,
    saveLogin, forgetLogin, autoLogin, confirmSession, recover, wake,
  };
}

module.exports = { createAccountService };
