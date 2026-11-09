// 复用公众号会话；明确鉴权失效时静默复核，仅只读请求允许重试一次。
const { createMpWindow } = require('./windows.cjs');
const { createBackgroundPage } = require('./background-page.cjs');
const { readIdentity, normalizeIdentity, MP_ORIGIN } = require('./identity.cjs');

const AUTH_CODES = new Set([200003, 200004, 42001]);
const isAuthError = (error) => ['MP_LOGIN_REQUIRED', 'MP_AUTH_STALE'].includes(error.code);

function createMpTransport({ accounts, parent, onSessionReady, recoverSession }) {
  const pages = new Map();
  const opening = new Map();
  const queues = new Map();
  const closing = new Set();
  const requests = new Map();
  const recovering = new Map();
  const generations = new Map();
  const keyOf = (id, lane) => `${id}:${lane}`;
  let closed = false;
  let writeSequence = 0;

  function ready(page, id) {
    if (closed || closing.has(id) || page.generation !== (generations.get(id) || 0)
      || accounts.find(id)?.partition !== page.partition) return;
    if (onSessionReady) onSessionReady(id, page.partition);
    else accounts.setStatus(id, 'ready');
  }

  function authError(page, code, observedAt = Date.now()) {
    const error = new Error(code === 'MP_LOGIN_REQUIRED' ? '微信已确认需要重新登录，请完成微信验证' : '微信会话凭据需要更新');
    Object.assign(error, { code, page, observedAt });
    return error;
  }

  async function identity(page, id) {
    const observedAt = Date.now();
    const deadline = observedAt + 8000;
    do {
      let timer;
      const result = await Promise.race([
        readIdentity(page.contents).catch(() => null),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); }),
      ]).finally(() => clearTimeout(timer));
      const profile = normalizeIdentity(result);
      if (profile) {
        if (profile.id !== id) {
          const error = new Error('当前微信账号与所选公众号不一致，请重新选择正确账号');
          error.code = 'MP_ACCOUNT_MISMATCH';
          throw error;
        }
        ready(page, id);
        return;
      }
      if (result?.loginRequired) throw authError(page, 'MP_LOGIN_REQUIRED', observedAt);
      if (closed || closing.has(id) || page.contents.isDestroyed()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    const error = new Error('暂时无法读取微信身份，请稍后重试');
    error.code = 'MP_IDENTITY_UNAVAILABLE';
    throw error;
  }

  function invalidate(id, source) {
    if (source && source.generation !== (generations.get(id) || 0)) return false;
    generations.set(id, (generations.get(id) || 0) + 1);
    for (const [key, page] of pages) {
      if (!key.startsWith(`${id}:`)) continue;
      page.close();
      pages.delete(key);
      opening.delete(key);
    }
    return true;
  }

  async function recover(id, error) {
    if (closed || closing.has(id) || !accounts.find(id)) return false;
    if (error.page && accounts.find(id).partition !== error.page.partition) return false;
    if (!invalidate(id, error.page)) return recovering.get(id) || accounts.find(id).status === 'ready';
    if (!recoverSession) {
      if (error.code === 'MP_LOGIN_REQUIRED') accounts.setStatus(id, 'expired');
      return false;
    }
    if (!recovering.has(id)) {
      const pending = Promise.resolve().then(() => recoverSession(id, {
        confirmedExpired: error.code === 'MP_LOGIN_REQUIRED', observedAt: error.observedAt,
      })).finally(() => recovering.delete(id));
      recovering.set(id, pending);
    }
    return recovering.get(id);
  }

  async function withRecovery(id, action, retry = true) {
    try {
      return await action();
    } catch (error) {
      if (!isAuthError(error)) throw error;
      const restored = await recover(id, error);
      if (closed || closing.has(id) || !accounts.find(id)) throw new Error('账号已退出或应用正在关闭');
      if (!restored) {
        const message = accounts.find(id).status === 'expired'
          ? '微信已确认需要重新登录，请完成微信验证' : '微信会话正在复核，请稍后重试';
        throw new Error(message);
      }
      if (!retry) throw new Error('微信会话已恢复，本次操作未自动重试，请核对后重新提交');
      try {
        return await action();
      } catch (next) {
        if (isAuthError(next)) await recover(id, next);
        throw next;
      }
    }
  }

  async function navigate(page, path, source = page) {
    const url = new URL(path, MP_ORIGIN);
    if (url.origin !== MP_ORIGIN) throw new Error('公众号页面地址无效');
    const previous = new URL(source.contents.getURL() || MP_ORIGIN);
    if (!url.searchParams.has('token') && previous.searchParams.has('token')) {
      url.searchParams.set('token', previous.searchParams.get('token'));
    }
    url.searchParams.set('lang', 'zh_CN');
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        page.contents.removeListener('dom-ready', ready);
        page.contents.removeListener('destroyed', destroyed);
        error ? reject(error) : resolve();
      };
      const ready = () => finish();
      const destroyed = () => finish(new Error('微信数据窗口已关闭'));
      const timer = setTimeout(() => finish(new Error('微信页面加载超时，请重试')), 15000);
      page.contents.once('dom-ready', ready);
      page.contents.once('destroyed', destroyed);
      void page.contents.loadURL(url.href).catch((error) => {
        if (!settled) {
          console.warn('微信页面加载失败', url.pathname, error.code || error.name);
          finish(new Error('微信页面加载失败，请检查网络后重试'));
        }
      });
    });
  }

  async function pageFor(id, lane = 'session') {
    if (recovering.has(id)) await recovering.get(id);
    const account = accounts.find(id);
    if (!account || closed || closing.has(id)) throw new Error('公众号不存在或正在退出');
    const key = keyOf(id, lane);
    if (opening.has(key)) return opening.get(key);
    const old = pages.get(key);
    if (old && !old.contents.isDestroyed() && old.partition === account.partition) return old;
    old?.close();
    const page = { ...createBackgroundPage({ partition: account.partition }),
      partition: account.partition, generation: generations.get(id) || 0 };
    pages.set(key, page);
    const promise = (async () => {
      if (lane === 'session') {
        await navigate(page, '/');
        await identity(page, id);
      }
      return page;
    })();
    opening.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      page.close();
      if (pages.get(key) === page) pages.delete(key);
      throw error;
    } finally { if (opening.get(key) === promise) opening.delete(key); }
  }

  function exclusive(id, lane, action) {
    if (closed || closing.has(id)) throw new Error('账号正在退出');
    const key = keyOf(id, lane);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }

  async function fetchJson(id, path, { method = 'GET', fields = null, file = null } = {}) {
    const page = await pageFor(id);
    const observedAt = Date.now();
    const url = new URL(path, MP_ORIGIN);
    if (url.origin !== MP_ORIGIN) throw new Error('接口地址无效');
    url.searchParams.set('token', new URL(page.contents.getURL()).searchParams.get('token'));
    url.searchParams.set('lang', 'zh_CN');
    url.searchParams.set('f', 'json');
    url.searchParams.set('ajax', '1');
    const options = { method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(25000) };
    if (file) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields || {})) form.set(key, String(value));
      form.set('file', new Blob([file.bytes], { type: file.mimeType }), file.name);
      options.body = form;
    } else if (fields) options.body = new URLSearchParams(fields);
    options.headers = { Referer: page.contents.getURL() };
    let response;
    try {
      response = await page.session.fetch(url.href, options);
    } catch (error) {
      console.warn('微信接口请求失败', url.pathname, error.name);
      throw new Error('微信接口请求失败，请检查网络后重试');
    }
    if (!response.ok) throw new Error(`微信接口返回 HTTP ${response.status}`);
    let value;
    try { value = await response.json(); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('微信接口暂未返回有效数据，请稍后重试');
    }
    const code = Number(value.base_resp?.ret ?? value.errcode ?? value.ret ?? 0);
    if (AUTH_CODES.has(code)) throw authError(page, 'MP_AUTH_STALE', observedAt);
    if (code !== 0) {
      const error = new Error(`微信接口未完成操作（${code}）：${value.base_resp?.err_msg || value.errmsg || '请重试'}`);
      error.code = code;
      throw error;
    }
    ready(page, id);
    return value;
  }

  function request(id, path, options = {}) {
    const readonly = (!options.method || options.method.toUpperCase() === 'GET') && !options.fields && !options.file;
    const key = readonly ? `${id}:GET:${path}` : `${id}:write:${++writeSequence}`;
    if (readonly && requests.has(key)) return requests.get(key);
    const pending = withRecovery(id, () => fetchJson(id, path, options), readonly);
    requests.set(key, pending);
    pending.finally(() => { if (requests.get(key) === pending) requests.delete(key); }).catch(() => {});
    return pending;
  }

  async function readBinary(id, path, { maxBytes = 50 * 1024 * 1024 } = {}) {
    const page = await pageFor(id);
    const observedAt = Date.now();
    const url = new URL(path, MP_ORIGIN);
    if (url.origin !== MP_ORIGIN) throw new Error('接口地址无效');
    url.searchParams.set('token', new URL(page.contents.getURL()).searchParams.get('token'));
    url.searchParams.set('lang', 'zh_CN');
    let response;
    try {
      response = await page.session.fetch(url.href, {
        credentials: 'include', redirect: 'follow', signal: AbortSignal.timeout(60000),
        headers: { Referer: page.contents.getURL() },
      });
    } catch (error) {
      console.warn('微信文件读取失败', url.pathname, error.name);
      throw new Error('微信文件读取失败，请检查网络后重试');
    }
    if (!response.ok) throw new Error(`微信文件返回 HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('这条消息的文件已过期或不可下载');
    if (bytes.length > maxBytes) throw new Error('文件过大，请在公众平台下载');
    if (/json/.test(type)) {
      let value;
      try { value = JSON.parse(bytes.toString('utf8')); } catch {}
      if (AUTH_CODES.has(Number(value?.base_resp?.ret ?? value?.errcode ?? value?.ret))) {
        throw authError(page, 'MP_AUTH_STALE', observedAt);
      }
    }
    if (/json|text\/html/.test(type)) throw new Error('这条消息的文件已过期或不可下载');
    ready(page, id);
    const disposition = response.headers.get('content-disposition') || '';
    const name = decodeURIComponent((disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1] || '');
    return { bytes, type, name };
  }

  function fetchBinary(id, path, options) {
    return withRecovery(id, () => readBinary(id, path, options));
  }

  function readPage(id, path, expression) {
    const url = new URL(path, MP_ORIGIN);
    const editor = url.pathname === '/cgi-bin/appmsg' && url.searchParams.get('action') === 'edit';
    const lane = editor ? (url.searchParams.get('isNew') === '1' ? 'upload' : 'editor') : 'read';
    return exclusive(id, lane, () => withRecovery(id, async () => {
      const context = await pageFor(id);
      const page = await pageFor(id, lane);
      await navigate(page, path, context);
      await identity(page, id);
      let timer;
      try {
        return await Promise.race([
          page.contents.executeJavaScript(expression, false),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('微信数据读取超时，请重试')), 15000); }),
        ]);
      } finally { clearTimeout(timer); }
    }));
  }

  function open(id, path) {
    return withRecovery(id, async () => {
      const context = await pageFor(id);
      const page = createMpWindow({ partition: context.partition, parent: parent(), show: true });
      try {
        await navigate(page, path, context);
        return { opened: true };
      } catch (error) {
        if (!page.window.isDestroyed()) page.window.close();
        throw error;
      }
    });
  }

  async function openForAutomation(id, path) {
    return withRecovery(id, async () => {
      const context = await pageFor(id);
      const page = createMpWindow({ partition: context.partition, parent: parent(), show: false, title: '微信公众平台 · 普通发送' });
      try {
        await navigate(page, path, context);
        await identity(page, id);
        return page;
      } catch (error) {
        if (!page.window.isDestroyed()) page.window.close();
        throw error;
      }
    });
  }

  async function release(id) {
    closing.add(id);
    const pending = [...opening, ...queues, ...requests, ...recovering]
      .filter(([key]) => key === id || key.startsWith(`${id}:`));
    await Promise.allSettled(pending.map(([, promise]) => promise));
    invalidate(id);
    generations.delete(id);
    closing.delete(id);
  }

  async function close() {
    closed = true;
    const ids = new Set([...pages.keys(), ...requests.keys(), ...queues.keys()]
      .map((key) => key.slice(0, key.indexOf(':'))));
    await Promise.allSettled([...ids].map(release));
  }

  return { request, readPage, fetchBinary, open, openForAutomation, release, close };
}

module.exports = { createMpTransport };
