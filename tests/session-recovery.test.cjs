// Session checks must not turn transient failures into expiry or repeat password submissions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const identity = require('../electron/mp/identity.cjs');

const id = 'gh_test';
const partition = 'persist:mp-00000000-0000-0000-0000-000000000001';
const profile = { authenticated: true, originalId: id, name: 'Account' };
let fixture;

class Contents extends EventEmitter {
  constructor() { super(); this.url = ''; this.destroyed = false; }
  async loadURL(url) {
    if (fixture.loadError) throw new Error('Offline');
    this.url = url;
    this.identity = fixture.identity;
    queueMicrotask(() => { this.emit('dom-ready'); this.emit('did-finish-load'); });
  }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
}

function page(visible = false) {
  const contents = new Contents();
  const window = new EventEmitter();
  let destroyed = false;
  window.isDestroyed = () => destroyed;
  window.show = () => {};
  window.focus = () => {};
  window.close = () => { destroyed = true; contents.destroyed = true; window.emit('closed'); };
  const result = { contents, window, session: { flushStorageData: async () => {}, cookies: { flushStore: async () => {} } },
    url: 'https://mp.weixin.qq.com/', needsReload: () => false, reload: async () => {},
    close: () => { contents.destroyed = true; } };
  (visible ? fixture.visible : fixture.background).push(result);
  return result;
}

const originalLoad = Module._load;
let createAccountService;
try {
  Module._load = function (name, ...args) {
    if (name === './mp/windows.cjs') return { createMpWindow: () => page(true), clearMpSession: async () => {} };
    if (name === './mp/background-page.cjs') return { createBackgroundPage: () => page() };
    if (name === './mp/identity.cjs') return { ...identity,
      readIdentity: async contents => fixture.inspect ? fixture.inspect(contents) : contents.identity };
    if (name === './mp/password-login.cjs') return {
      fillPasswordLogin: async () => { fixture.fills += 1; return 'submitted'; },
      readSubmittedState: async () => fixture.submittedState || { verify: true },
    };
    return originalLoad.call(this, name, ...args);
  };
  ({ createAccountService } = require('../electron/accounts.cjs'));
} finally { Module._load = originalLoad; }

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1800000000000 });
  fixture = { identity: profile, background: [], visible: [], changes: [], fills: 0, claims: 0, saved: false, ...options };
  const f = fixture;
  let account = { id, originalId: id, name: 'Account', partition, status: 'ready', lastCheckedAt: 0 };
  const store = {
    find: key => key === id && account ? { ...account } : null,
    findByOriginalId: key => key === id && account ? { ...account } : null,
    list: () => ({ accounts: account ? [{ ...account }] : [], activeAccountId: account ? id : null }),
    save: value => { account = { ...value }; return { ...account }; },
    setStatus: (_id, value, at = Date.now()) => { account = { ...account, status: value, lastCheckedAt: at }; },
    setActive: () => {}, remove: () => { account = null; },
  };
  const credentials = {
    status: () => ({ saved: f.saved, failure: f.failure || '' }),
    get: () => f.saved ? { account: 'account@example.test', password: 'test-only' } : null,
    canAttempt: () => !f.failure && f.allowed !== false,
    claimAttempt: () => { f.claims += 1; return true; },
    markFailed: (_id, value) => { f.failure = value; },
    clearFailure: () => { f.failure = ''; },
    remove: () => { f.saved = false; },
  };
  f.store = store;
  f.service = createAccountService({ store, credentials, parent: () => ({ focus() {} }),
    changed: value => f.changes.push(value.accounts[0]?.status), status: () => {} });
  t.after(async () => { await f.service.close(); t.mock.timers.reset(); });
  return f;
}

async function advance(t, ms) {
  t.mock.timers.tick(ms);
  await flush();
}

async function refresh(t, f, options) {
  const pending = f.service.refresh(id, options);
  await flush();
  await advance(t, 600);
  return pending;
}

test('concurrent checks share one hidden page and restore a falsely expired account', async t => {
  const f = setup(t);
  f.store.setStatus(id, 'expired');
  const first = f.service.refresh(id);
  const second = f.service.refresh(id);
  assert.equal(first, second);
  await flush();
  await advance(t, 600);
  await first;
  assert.equal(f.store.find(id).status, 'ready');
  assert.equal(f.background.length, 1);
  assert.equal(f.visible.length, 0);
  assert.equal(f.fills, 0);
});

test('network failures remain uncertain and never submit saved credentials', async t => {
  const f = setup(t, { loadError: true, saved: true });
  await refresh(t, f);
  assert.equal(f.store.find(id).status, 'error');
  assert.equal(f.changes.includes('expired'), false);
  assert.equal(f.fills, 0);
  assert.equal(f.claims, 0);
  assert.equal(f.visible.length, 0);
});

test('an incomplete page times out without claiming that login has expired', async t => {
  const f = setup(t, { identity: { authenticated: false, loginRequired: false }, saved: true });
  const pending = f.service.refresh(id);
  await flush();
  await advance(t, 26000);
  await pending;
  assert.equal(f.store.find(id).status, 'error');
  assert.equal(f.changes.includes('expired'), false);
  assert.equal(f.fills, 0);
});

test('an open official window synchronizes its verified identity without being closed', async t => {
  const f = setup(t);
  f.store.setStatus(id, 'expired');
  f.service.openPlatform(id);
  await flush();
  assert.equal(f.store.find(id).status, 'ready');
  assert.equal(f.visible[0].window.isDestroyed(), false);
  assert.equal(f.background.length, 0);
});

test('a late failed probe cannot overwrite a newer verified session', async t => {
  let resolve;
  const f = setup(t, { inspect: () => new Promise(done => { resolve = done; }) });
  const pending = f.service.refresh(id);
  await flush();
  await advance(t, 600);
  f.service.confirmSession(id, partition);
  resolve({ authenticated: false, loginRequired: true });
  await pending;
  assert.equal(f.store.find(id).status, 'ready');
  assert.equal(f.changes.includes('expired'), false);
  assert.equal(f.fills, 0);
});

test('healthy wakeups are throttled and only probe again after five minutes', async t => {
  const f = setup(t);
  await refresh(t, f);
  await f.service.wake();
  assert.equal(f.background.length, 1);
  await advance(t, 4 * 60 * 1000);
  await f.service.wake();
  assert.equal(f.background.length, 1);
  await advance(t, 60 * 1000);
  const pending = f.service.wake();
  await flush();
  await advance(t, 600);
  await pending;
  assert.equal(f.background.length, 2);
});

test('failed wakeups back off and do not repeatedly open login windows', async t => {
  const f = setup(t, { identity: { authenticated: false, loginRequired: true } });
  await refresh(t, f);
  await f.service.wake();
  await advance(t, 59000);
  await f.service.wake();
  assert.equal(f.background.length, 1);
  await advance(t, 1000);
  const pending = f.service.wake();
  await flush();
  await advance(t, 600);
  await pending;
  assert.equal(f.background.length, 2);
  await advance(t, 119000);
  await f.service.wake();
  assert.equal(f.background.length, 2);
  assert.equal(f.visible.length, 0);
});

test('an account mismatch never overwrites the account or starts a password login', async t => {
  const f = setup(t, { identity: { ...profile, originalId: 'gh_other' }, saved: true });
  await refresh(t, f);
  assert.equal(f.store.find(id).originalId, id);
  assert.equal(f.store.find(id).status, 'error');
  assert.equal(f.fills, 0);
  assert.equal(f.visible.length, 0);
});

test('a verification challenge hands off once without submitting the password a second time', async t => {
  const f = setup(t, { identity: { authenticated: false, loginRequired: true }, saved: true });
  const pending = f.service.refresh(id);
  await flush();
  await advance(t, 600);
  await advance(t, 900);
  await pending;
  assert.equal(f.fills, 1);
  assert.equal(f.claims, 1);
  assert.equal(f.visible.length, 1);
  f.visible[0].window.close();
  await f.service.autoLogin(id);
  assert.equal(f.fills, 1);
  assert.equal(f.visible.length, 1);
});

test('provider rejection pauses password attempts until the credentials are updated', async t => {
  const f = setup(t, { identity: { authenticated: false, loginRequired: true }, saved: true,
    submittedState: { error: 'Too many attempts' } });
  const pending = f.service.refresh(id);
  await flush();
  await advance(t, 600);
  await advance(t, 900);
  await pending;
  await f.service.autoLogin(id);
  assert.ok(f.failure);
  assert.equal(f.fills, 1);
  assert.equal(f.visible.length, 0);
});

test('revoking credentials while an identity check is pending prevents password submission', async t => {
  let resolve;
  const f = setup(t, { saved: true, inspect: () => new Promise(done => { resolve = done; }) });
  const pending = f.service.autoLogin(id);
  await flush();
  f.service.forgetLogin(id);
  resolve({ authenticated: false, loginRequired: true });
  await pending;
  assert.equal(f.fills, 0);
  assert.equal(f.claims, 0);
});

test('logging out cancels probes and cannot resurrect the removed account', async t => {
  const f = setup(t, { identity: { authenticated: false, loginRequired: false }, saved: true });
  const pending = f.service.refresh(id);
  await flush();
  const logout = f.service.logout(id);
  await advance(t, 600);
  await logout;
  await pending;
  assert.equal(f.store.find(id), null);
  assert.equal(f.service.snapshot().accounts.length, 0);
  assert.equal(f.fills, 0);
  assert.equal(f.background.every(x => x.contents.isDestroyed()), true);
});

test('focusing a cached official page cannot restore login without a fresh check', async t => {
  const f = setup(t);
  f.service.openPlatform(id);
  await flush();
  f.store.setStatus(id, 'expired');
  f.visible[0].window.emit('focus');
  await flush();
  assert.equal(f.store.find(id).status, 'expired');
});

test('a persisted password cooldown prevents another automatic submission', async t => {
  const f = setup(t, { identity: { authenticated: false, loginRequired: true }, saved: true, allowed: false });
  await refresh(t, f);
  assert.equal(f.store.find(id).status, 'expired');
  assert.equal(f.fills, 0);
  assert.equal(f.claims, 0);
  assert.equal(f.visible.length, 0);
});
