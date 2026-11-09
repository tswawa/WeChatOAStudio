// 用独立会话的单层浏览器窗口显示微信页面，加载失败时给出可重试状态。
const { BrowserWindow, session } = require('electron');
const { MP_ORIGIN, isMpUrl } = require('./identity.cjs');

const configured = new Set();

function getMpSession(partition) {
  if (!/^persist:mp-[a-f0-9-]{36}$/.test(partition)) throw new Error('账号会话标识无效');
  const current = session.fromPartition(partition);
  if (!configured.has(partition)) {
    current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    current.setPermissionCheckHandler(() => false);
    current.on('will-download', (event) => event.preventDefault());
    configured.add(partition);
  }
  return current;
}

function failurePage(message) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <html lang="zh-CN"><meta charset="utf-8"><title>微信公众平台</title>
    <style>
      body{margin:0;background:#f6f7f8;color:#17232b;font:16px/1.7 "Microsoft YaHei",sans-serif;}
      main{max-width:460px;margin:18vh auto;padding:36px;background:#fff;border-radius:8px;}
      h1{margin:0 0 12px;font-size:22px;}p{margin:0 0 24px;color:#66727d;}
      a{display:inline-block;padding:9px 22px;border-radius:6px;background:#07a861;color:#fff;text-decoration:none;}
    </style><main><h1>微信页面暂时无法打开</h1><p>${message}</p>
    <a href="${MP_ORIGIN}/">重新加载</a></main></html>`);
}

function createMpWindow({ partition, parent, show = false, title = '微信公众平台' }) {
  const mpSession = getMpSession(partition);
  const window = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title,
    parent,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: mpSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const contents = window.webContents;
  let timeout = null;
  let failed = false;
  let displayingFailure = false;
  let lastUrl = `${MP_ORIGIN}/`;

  function cancelTimeout() {
    clearTimeout(timeout);
    timeout = null;
  }

  function displayFailure(message, reason) {
    cancelTimeout();
    failed = true;
    if (contents.isDestroyed() || window.isDestroyed() || displayingFailure) return;
    console.warn('微信窗口加载失败', reason);
    if (!show) return;
    displayingFailure = true;
    window.setTitle(`${title} · 加载失败`);
    void contents.loadURL(failurePage(message)).catch((error) => {
      console.warn('微信窗口提示加载失败', error.code || error.name);
    }).finally(() => { displayingFailure = false; });
  }

  function restrictNavigation(event, oldUrl) {
    const url = event.url || oldUrl;
    if (!isMpUrl(url)) {
      event.preventDefault();
      console.warn('已阻止非公众平台页面导航');
    }
  }
  contents.on('will-navigate', restrictNavigation);
  contents.on('will-redirect', restrictNavigation);
  contents.on('did-start-navigation', (event, oldUrl, _inPlace, oldMainFrame) => {
    const url = event.url || oldUrl;
    if (!(event.isMainFrame ?? oldMainFrame) || !isMpUrl(url)) return;
    lastUrl = url;
    failed = false;
    cancelTimeout();
    if (show) {
      window.setTitle(`${title} · 正在加载`);
      timeout = setTimeout(() => {
        contents.stop();
        displayFailure('加载超时，请检查连接后重新加载。', 'timeout');
      }, 20000);
    }
  });
  contents.on('dom-ready', () => {
    if (!isMpUrl(contents.getURL())) return;
    cancelTimeout();
    failed = false;
    if (!window.isDestroyed()) window.setTitle(title);
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    displayFailure('连接微信公众平台失败，请检查连接后重新加载。', code);
  });
  contents.on('render-process-gone', (_event, details) => {
    displayFailure('微信页面显示异常，请重新加载。', details.reason);
  });
  window.on('page-title-updated', (event) => event.preventDefault());
  window.on('closed', cancelTimeout);
  contents.setWindowOpenHandler(({ url }) => {
    if (isMpUrl(url)) {
      void contents.loadURL(url).catch((error) => {
        console.warn('公众平台页面打开失败', error.code || error.name);
      });
    }
    return { action: 'deny' };
  });
  if (show) {
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show();
    });
  }
  return {
    window,
    contents,
    session: mpSession,
    url: `${MP_ORIGIN}/`,
    needsReload: () => failed || (!contents.isLoadingMainFrame() && !isMpUrl(contents.getURL())),
    reload: () => contents.loadURL(lastUrl),
  };
}

async function clearMpSession(partition) {
  const current = getMpSession(partition);
  await current.clearStorageData();
  await current.clearCache();
  await current.closeAllConnections();
}

module.exports = { getMpSession, createMpWindow, clearMpSession };
