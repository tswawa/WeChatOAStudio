// 桌面应用入口：本地 Vue 窗口、受限 IPC、账号 SQLite 与微信会话生命周期。
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, powerMonitor, session } = require('electron');
const { join, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
require('./logging.cjs').installLogging(join(app.getPath('appData'), 'mp-ops-desktop', 'logs', 'main.log'));
const { createAccountStore } = require('./store/accounts.cjs');
const { createAccountService } = require('./accounts.cjs');
const { createCredentialStore } = require('./store/credentials.cjs');
const { createMpService } = require('./mp/index.cjs');
const { createOpsService } = require('./ops/index.cjs');
const { createWorkspaceService } = require('./workspace.cjs');
const brand = require('./brand.cjs');

// Windows 下避免 GPU 合成出现网页已加载但窗口仍黑屏的显示异常。
if (process.platform === 'win32') app.disableHardwareAcceleration();
app.setName(brand.name);
app.setAppUserModelId('local.mp-ops.desktop');
app.setPath('userData', join(app.getPath('appData'), 'mp-ops-desktop'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'mp-ops', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow = null;
let accountService = null;
let accountStore = null;
let quitting = false;
let mpService = null;
let opsService = null;
let workspace = null;

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, value);
  }
}

function bind(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame
      || !event.senderFrame.url.startsWith('mp-ops://app/')) {
      return { ok: false, message: '请求来源无效' };
    }
    try {
      return { ok: true, value: await handler(...args) };
    } catch (error) {
      console.error('业务操作失败', channel, error.code || error.name, error.message);
      const message = /^[\u4e00-\u9fff]/.test(error.message)
        ? error.message : '操作失败，请稍后重试';
      return { ok: false, message };
    }
  });
}

async function start() {
  const dataDirectory = app.getPath('userData');
  const dbPath = join(dataDirectory, 'accounts.sqlite3');
  accountStore = createAccountStore(dbPath);
  protocol.handle('mp-ops', async (request) => {
    const url = new URL(request.url);
    if (url.host === 'app' && /^\/images\/img_[0-9a-f-]+\.png$/i.test(url.pathname)) {
      const id = url.pathname.slice('/images/'.length, -4);
      const accountId = accountStore.list().activeAccountId;
      if (request.method !== 'GET' || !opsService || !accountId) return new Response('Not found', { status: 404 });
      try {
        const image = await opsService.imageFile(accountId, id);
        return new Response(image.bytes, { headers: { 'Content-Type': 'image/png',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    if (url.host === 'app' && /^\/attachments\/att_[0-9a-f-]+\.png$/i.test(url.pathname)) {
      const id = url.pathname.slice('/attachments/'.length, -4), accountId = accountStore.list().activeAccountId;
      if (request.method !== 'GET' || !opsService || !accountId) return new Response('Not found', { status: 404 });
      try {
        const file = await opsService.attachmentFile(accountId, id);
        if (file.record.kind !== 'image') return new Response('Not found', { status: 404 });
        return new Response(file.bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    if (url.host !== 'app' || !['/', '/index.html'].includes(url.pathname)) {
      return new Response('Not found', { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(join(__dirname, '../dist/index.html')).href);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
    ].join('; '));
    return new Response(response.body, { status: response.status, headers });
  });
  mainWindow = new BrowserWindow({
    title: brand.name,
    icon: join(__dirname, 'assets/app-icon.png'),
    width: 1360,
    height: 900,
    minWidth: 1060,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f8',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 最小化时仍按时检查新私信和留言
      backgroundThrottling: false,
    },
  });
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('preload-error', (_event, _path, error) => {
    console.error('桌面桥接加载失败', error.name);
    dialog.showErrorBox('启动失败', '桌面组件未能加载，请重新启动应用。');
    app.quit();
  });
  accountService = createAccountService({
    store: accountStore,
    parent: () => mainWindow?.isDestroyed() ? undefined : mainWindow,
    changed: (value) => send('accounts:changed', value),
    status: (value) => send('desktop:status', value),
    credentials: createCredentialStore(join(dataDirectory, 'mp-logins.json')),
  });
  accountService.prepareRestore();
  const notify = (accountId) => send('workspace:changed', { accountId });
  mpService = createMpService({
    accounts: accountStore, parent: () => mainWindow, dataDirectory,
    getImageProxy: (url) => session.defaultSession.resolveProxy(url),
    onSessionReady: accountService.confirmSession,
    recoverSession: accountService.recover,
    onPublicationChanged: notify,
    onAccountsChanged: () => send('accounts:changed', accountService.snapshot()),
  });
  const wake = () => { void accountService.wake(); };
  mainWindow.on('focus', wake);
  powerMonitor.on('resume', wake);
  app.once('before-quit', () => powerMonitor.removeListener('resume', wake));
  opsService = createOpsService({
    dbPath, settingsPath: join(dataDirectory, 'settings.json'),
    imageDirectory: join(app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath(), 'ArticleImages'),
    legacyImageDirectory: join(app.getPath('pictures'), 'WeChatOAStudio', 'ArticleImages'),
    getImageProxy: (url) => session.defaultSession.resolveProxy(url), mp: {
      ...mpService,
      async saveDraft(id, draft) {
        const saved = await mpService.saveDraft(id, draft);
        if (workspace) await workspace.savedDraft(id, saved);
        return saved;
      },
    }, notify, getAccount: (id) => accountStore.find(id),
  });
  workspace = createWorkspaceService({ dbPath, mp: mpService, ops: opsService, accounts: accountStore, notify });
  bind('accounts:list', accountService.snapshot);
  bind('accounts:login', accountService.login);
  bind('accounts:switch', accountService.switchAccount);
  bind('accounts:logout', (id) => accountService.logout(id, () => mpService.release(id)));
  bind('accounts:refresh', accountService.refresh);
  bind('accounts:open-platform', accountService.openPlatform);
  bind('accounts:save-login', accountService.saveLogin);
  bind('accounts:forget-login', accountService.forgetLogin);
  bind('app:open-external', async (target) => {
    const url = target === 'author' ? brand.authorUrl : target === 'repository' ? brand.repositoryUrl : null;
    if (!url) throw new Error('不支持的外部链接');
    await shell.openExternal(url);
    return { opened: true };
  });
  bind('app:open-url', async (value) => {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('链接无效');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('仅支持打开 HTTP 或 HTTPS 网页');
    }
    await shell.openExternal(url.href);
    return { opened: true };
  });
  bind('workspace:invoke', async (action, accountId, payload = {}) => {
    if (typeof action !== 'string' || typeof accountId !== 'string'
      || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('业务请求参数无效');
    if (action === 'images.chooseDirectory') {
      if (!accountStore.find(accountId)) throw new Error('请先登录公众号');
      const choice = await dialog.showOpenDialog(mainWindow, { title: '选择配图保存目录',
        defaultPath: opsService.getPrivateSettings().images.downloadDirectory
          || join(app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath(), 'ArticleImages'),
        properties: ['openDirectory', 'createDirectory'] });
      return { directory: choice.canceled ? null : choice.filePaths[0] };
    }
    if (action === 'chat.attachment.save') {
      const file = await opsService.attachmentFile(accountId, payload.id);
      const choice = await dialog.showSaveDialog(mainWindow, { title: '保存聊天附件', defaultPath: join(app.getPath('downloads'), file.record.kind === 'image' ? file.name.replace(/\.[^.]+$/, '') + '.png' : file.name) });
      if (choice.canceled || !choice.filePath) return { saved: false };
      await require('node:fs/promises').writeFile(choice.filePath, file.bytes);
      return { saved: true };
    }
    if (action === 'images.reveal') {
      const image = await opsService.imageFile(accountId, payload.id);
      shell.showItemInFolder(image.filename);
      return { opened: true };
    }
    // 私信文件下载：从公众平台取回文件后由用户选择保存位置
    if (action === 'interaction.downloadMessageFile') {
      const file = await workspace.handle(action, accountId, payload);
      const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'audio/mpeg': '.mp3',
        'audio/amr': '.amr', 'video/mp4': '.mp4' }[file.type.split(';')[0]] || '';
      const fallback = `私信文件-${String(payload.messageId).slice(-8)}${extension}`;
      const name = String(file.name || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: '保存私信文件', defaultPath: join(app.getPath('downloads'), name),
      });
      if (choice.canceled || !choice.filePath) return { saved: false };
      await require('node:fs/promises').writeFile(choice.filePath, file.bytes);
      return { saved: true, name: require('node:path').basename(choice.filePath) };
    }
    const result = await workspace.handle(action, accountId, payload);
    return result;
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
  await mainWindow.loadURL('mp-ops://app/index.html');
  void accountService.restore().catch((error) => {
    console.error('账号恢复失败', error.code || error.name);
    send('desktop:status', { message: '账号恢复失败，请重新验证登录状态', kind: 'error' });
  });
  console.info(`${brand.name} 已启动`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(start).catch((error) => {
    console.error('桌面启动失败', error.code || error.name);
    dialog.showErrorBox('无法启动', '应用或账号数据库无法加载，请查看终端错误信息。');
    app.quit();
  });
}

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await accountService?.close();
      await opsService?.close();
      await workspace?.close();
      await mpService?.close();
    } catch (error) {
      console.error('应用关闭时清理失败', error.name);
    } finally {
      accountStore?.close();
      app.quit();
    }
  })();
});
