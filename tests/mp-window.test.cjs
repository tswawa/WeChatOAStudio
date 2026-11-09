// 验证微信窗口只承载一个页面，失败与超时可重试且不会放行外部页面。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

class Contents extends EventEmitter {
  constructor() {
    super();
    this.url = '';
    this.loads = [];
  }
  loadURL(url) { this.url = url; this.loads.push(url); return Promise.resolve(); }
  getURL() { return this.url; }
  isDestroyed() { return false; }
  isLoadingMainFrame() { return false; }
  setWindowOpenHandler(handler) { this.openHandler = handler; }
  stop() { this.stopped = true; }
}

class Window extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new Contents();
  }
  show() { this.visible = true; }
  setTitle(title) { this.title = title; }
  isDestroyed() { return false; }
}

const partition = 'persist:mp-00000000-0000-0000-0000-000000000001';
const session = new EventEmitter();
session.setPermissionRequestHandler = () => {};
session.setPermissionCheckHandler = () => {};
const originalLoad = Module._load;
let createMpWindow;
try {
  Module._load = function (name, ...args) {
    if (name === 'electron') return { BrowserWindow: Window, session: { fromPartition: () => session } };
    return originalLoad.call(this, name, ...args);
  };
  ({ createMpWindow } = require('../electron/mp/windows.cjs'));
} finally { Module._load = originalLoad; }

test('the visible WeChat window directly owns its secured session contents', () => {
  const page = createMpWindow({ partition, show: true });
  assert.equal(page.contents, page.window.webContents);
  assert.notEqual(page.window.visible, true);
  page.window.emit('ready-to-show');
  assert.equal(page.window.visible, true);
  assert.equal(page.window.options.webPreferences.session, session);
  assert.equal(page.window.options.webPreferences.nodeIntegration, false);
  assert.equal(page.window.options.webPreferences.contextIsolation, true);
  assert.equal(page.needsReload(), true);
  let prevented = false;
  page.contents.emit('will-navigate', { url: 'https://other.example/', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('failed WeChat navigation displays a retry page and can reload its original URL', async () => {
  const page = createMpWindow({ partition, show: true });
  const url = 'https://mp.weixin.qq.com/cgi-bin/home?token=123';
  page.contents.emit('did-start-navigation', { url, isMainFrame: true });
  page.contents.emit('did-fail-load', {}, -105, 'unresolved', url, true);
  assert.equal(page.needsReload(), true);
  assert.match(decodeURIComponent(page.contents.getURL()), /重新加载/);
  await page.reload();
  assert.equal(page.contents.getURL(), url);
  page.contents.emit('dom-ready');
  assert.equal(page.needsReload(), false);
});

test('a hanging navigation becomes a retry page instead of an indefinite empty window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = createMpWindow({ partition, show: true });
  page.contents.emit('did-start-navigation', { url: 'https://mp.weixin.qq.com/', isMainFrame: true });
  t.mock.timers.tick(20000);
  assert.equal(page.contents.stopped, true);
  assert.equal(page.needsReload(), true);
  assert.match(decodeURIComponent(page.contents.getURL()), /加载超时/);
});
