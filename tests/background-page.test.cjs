// 验证启动恢复与后台读取不创建 BrowserWindow，也不能显示或弹出子窗口。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

const partition = 'persist:mp-00000000-0000-0000-0000-000000000001';
let visibleWindows = 0;
const views = [];
const mpSession = {
  fetch: async () => ({ ok: true, json: async () => ({ base_resp: { ret: 0 }, value: 'real-data' }) }),
};

class Contents extends EventEmitter {
  constructor() { super(); this.url = ''; this.destroyed = false; }
  async loadURL(url) { this.url = url; queueMicrotask(() => this.emit('dom-ready')); }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  async executeJavaScript() { return { authenticated: true, originalId: 'gh_test', name: 'Account' }; }
  setWindowOpenHandler(handler) { this.openHandler = handler; }
  close(options) { this.closeOptions = options; this.destroyed = true; this.emit('destroyed'); }
}

class View {
  constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); }
  setBounds(bounds) { this.bounds = bounds; }
}

const originalLoad = Module._load;
let createBackgroundPage;
let createMpTransport;
let createAccountService;
try {
  Module._load = function (name, ...args) {
    if (name === 'electron') return { WebContentsView: View };
    if (name === './windows.cjs' || name === './mp/windows.cjs') return {
      getMpSession: () => mpSession,
      createMpWindow() { visibleWindows += 1; throw new Error('Background reads must not create windows'); },
    };
    return originalLoad.call(this, name, ...args);
  };
  ({ createBackgroundPage } = require('../electron/mp/background-page.cjs'));
  ({ createMpTransport } = require('../electron/mp/transport.cjs'));
  ({ createAccountService } = require('../electron/accounts.cjs'));
} finally { Module._load = originalLoad; }

test('background pages have no native window or parent and cannot open one', () => {
  const page = createBackgroundPage({ partition });
  const view = views.at(-1);
  assert.equal('window' in page, false);
  assert.equal(view.options.webPreferences.session, mpSession);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.contextIsolation, true);
  assert.equal(view.options.webPreferences.backgroundThrottling, false);
  assert.equal(view.bounds.width, 1200);
  assert.deepEqual(page.contents.openHandler({ url: 'https://mp.weixin.qq.com/' }), { action: 'deny' });
  page.close();
  assert.equal(page.isDestroyed(), true);
  assert.deepEqual(page.contents.closeOptions, { waitForBeforeUnload: false });
  assert.equal(visibleWindows, 0);
});

test('account restoration verifies its session without constructing any visible window', async () => {
  let account = { id: 'gh_test', originalId: 'gh_test', partition, name: 'Account', status: 'unknown' };
  const service = createAccountService({
    store: {
      find: () => account,
      findByOriginalId: () => account,
      list: () => ({ accounts: [account], activeAccountId: account.id }),
      save(profile) { account = profile; return account; },
      setStatus(_id, status) { account.status = status; },
    },
    parent: () => { throw new Error('Background restoration must not request a native parent'); },
    changed: () => {}, status: () => {},
  });
  await service.restore();
  assert.equal(account.status, 'ready');
  assert.equal(views.at(-1).webContents.isDestroyed(), true);
  assert.equal(visibleWindows, 0);
  await service.close();
});

test('background session requests and editor reads do not construct a native window', async () => {
  const transport = createMpTransport({
    accounts: { find: () => ({ id: 'gh_test', partition }), setStatus: () => {} },
    parent: () => { throw new Error('Background reads must not request a native parent'); },
  });
  const response = await transport.request('gh_test', '/cgi-bin/appmsg?action=list_ex');
  assert.equal(response.value, 'real-data');
  const editor = await transport.readPage('gh_test', '/cgi-bin/appmsg?action=edit', '({ value: 1 })');
  assert.equal(editor.authenticated, true);
  assert.equal(visibleWindows, 0);
  await transport.close();
  assert.equal(views.every((view) => view.webContents.isDestroyed()), true);
});
