// Only confirmed authentication errors may recover a session; writes are never replayed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const identity = require('./identity.cjs');

const id = 'gh_test';
const partition = 'persist:mp-00000000-0000-0000-0000-000000000001';
let fixture;
class Contents extends EventEmitter {
  constructor(number) { super(); this.number = number; this.url = ''; this.destroyed = false; }
  async loadURL(url) {
    this.url = new URL(url).pathname === '/' ? `https://mp.weixin.qq.com/cgi-bin/home?token=${this.number}` : url;
    queueMicrotask(() => this.emit('dom-ready'));
  }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
}
function background() {
  const contents = new Contents(fixture.pages.length + 1);
  const page = { contents, session: { fetch: (...args) => fixture.fetch(...args) }, close: () => {
    if (!contents.destroyed) { contents.destroyed = true; contents.emit('destroyed'); }
  } };
  fixture.pages.push(page);
  return page;
}
const originalLoad = Module._load;
let createMpTransport;
try {
  Module._load = function (name, ...args) {
    if (name === './windows.cjs') return { createMpWindow: options => {
      if (!fixture.allowAutomation) throw new Error('Must stay hidden')
      fixture.windows.push(options)
      const page=background();page.window={isDestroyed:()=>page.contents.isDestroyed(),close:page.close}
      return page
    } };
    if (name === './background-page.cjs') return { createBackgroundPage: background };
    if (name === './identity.cjs') return { ...identity, readIdentity: async () => fixture.identity };
    return originalLoad.call(this, name, ...args);
  };
  ({ createMpTransport } = require('./transport.cjs'));
} finally { Module._load = originalLoad; }

const response = (code = 0) => ({ ok: true, json: async () => ({ base_resp: { ret: code }, value: 'data' }) });
async function flush() { for (let index = 0; index < 20; index += 1) await Promise.resolve(); }
function setup(t, options = {}) {
  const account = { id, partition, status: 'ready' };
  const f = fixture = { pages: [], windows: [], ready: 0, recoveries: 0, statuses: [], identity: {
    authenticated: true, originalId: id, name: 'Account',
  }, fetch: async () => response(), ...options };
  f.transport = createMpTransport({ accounts: { find: () => account,
    setStatus: (_id, value) => { account.status = value; f.statuses.push(value); } }, parent: () => {},
    onSessionReady: () => { f.ready += 1; account.status = 'ready'; },
    recoverSession: async () => {
      f.recoveries += 1;
      if (f.recover) return f.recover();
      account.status = 'ready';
      return true;
    },
  });
  f.account = account;
  t.after(() => f.transport.close());
  return f;
}

test('ordinary automation creates a hidden dedicated window, not a visible publishing UI',async t=>{
  const f=setup(t,{allowAutomation:true})
  const page=await f.transport.openForAutomation(id,'/cgi-bin/appmsg?action=edit&appmsgid=2039101')
  assert.equal(f.windows.length,1);assert.equal(f.windows[0].show,false)
  assert.equal(f.windows[0].partition,partition);assert.match(page.contents.getURL(),/appmsgid=2039101/)
  page.close()
})

test('a stale token is silently rebuilt and a read is retried exactly once', async t => {
  let calls = 0;
  const f = setup(t, { fetch: async () => response(++calls === 1 ? 200003 : 0) });
  const result = await f.transport.request(id, '/cgi-bin/appmsg?action=list_ex');
  assert.equal(result.value, 'data');
  assert.equal(calls, 2);
  assert.equal(f.recoveries, 1);
  assert.equal(f.statuses.includes('expired'), false);
  assert.ok(f.pages[0].contents.destroyed);
  assert.equal(f.pages.at(-1).contents.destroyed, false);
});

test('simultaneous stale responses share recovery instead of closing the replacement page', async t => {
  let calls = 0;
  let resume;
  const f = setup(t, { fetch: async () => response(++calls <= 2 ? 200004 : 0),
    recover: () => new Promise(resolve => { resume = resolve; }) });
  const first = f.transport.request(id, '/cgi-bin/first');
  const second = f.transport.request(id, '/cgi-bin/second');
  await flush();
  assert.equal(f.recoveries, 1);
  resume(true);
  const result = await Promise.all([first, second]);
  assert.equal(result.every(x => x.value === 'data'), true);
  assert.equal(calls, 4);
  assert.equal(f.recoveries, 1);
  assert.equal(f.pages.at(-1).contents.destroyed, false);
});

test('uploads and other POST writes are never replayed after session recovery', async t => {
  let calls = 0;
  const f = setup(t, { fetch: async () => { calls += 1; return response(200003); } });
  await assert.rejects(f.transport.request(id, '/cgi-bin/operate_appmsg', {
    method: 'POST', fields: { title: 'Do not replay' },
  }), /未自动重试/);
  assert.equal(calls, 1);
  assert.equal(f.recoveries, 1);
});

test('network, malformed JSON and permission failures do not claim expiry or trigger recovery', async t => {
  const f = setup(t);
  for (const fetch of [async () => { throw new Error('Offline'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
    async () => response(105)]) {
    f.fetch = fetch;
    await assert.rejects(f.transport.request(id, '/cgi-bin/read'));
  }
  assert.equal(f.recoveries, 0);
  assert.equal(f.statuses.includes('expired'), false);
});

test('an unreadable identity is not expiry and never invokes password recovery', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 });
  const f = setup(t, { identity: { authenticated: false, loginRequired: false } });
  const pending = f.transport.request(id, '/cgi-bin/read');
  const rejected = assert.rejects(pending, /暂时无法读取/);
  await flush();
  t.mock.timers.tick(9000);
  await rejected;
  assert.equal(f.recoveries, 0);
  assert.equal(f.statuses.includes('expired'), false);
  t.mock.timers.reset();
});

test('a different official account is rejected without automatic login or any interface request', async t => {
  let calls = 0;
  const f = setup(t, { identity: { authenticated: true, originalId: 'gh_other', name: 'Other' },
    fetch: async () => { calls += 1; return response(); } });
  await assert.rejects(f.transport.request(id, '/cgi-bin/read'), /不一致/);
  assert.equal(f.recoveries, 0);
  assert.equal(calls, 0);
  assert.equal(f.ready, 0);
});

test('a persistently rejected read stops after one retry instead of looping', async t => {
  let calls = 0;
  const f = setup(t, { fetch: async () => { calls += 1; return response(200003); } });
  await assert.rejects(f.transport.request(id, '/cgi-bin/read'));
  assert.equal(calls, 2);
  assert.ok(f.recoveries <= 2);
});

test('a late stale response cannot invalidate a newly recovered session', async t => {
  let releaseOld;
  let calls = 0;
  const f = setup(t, { fetch: async url => {
    calls += 1;
    if (url.includes('/old') && calls === 1) return new Promise(resolve => { releaseOld = () => resolve(response(200003)); });
    if (url.includes('/trigger') && calls === 2) return response(200003);
    return response();
  } });
  const old = f.transport.request(id, '/old');
  await flush();
  await f.transport.request(id, '/trigger');
  const fresh = f.pages.at(-1);
  releaseOld();
  await old;
  assert.equal(f.recoveries, 1);
  assert.equal(fresh.contents.destroyed, false);
});

test('logout waits for every in-flight write even when two writes share an endpoint', async t => {
  const pending = [];
  const f = setup(t, { fetch: () => new Promise(resolve => pending.push(resolve)) });
  const first = f.transport.request(id, '/cgi-bin/write', { method: 'POST', fields: { value: 1 } });
  const second = f.transport.request(id, '/cgi-bin/write', { method: 'POST', fields: { value: 2 } });
  await flush();
  assert.equal(pending.length, 2);
  let released = false;
  const closing = f.transport.release(id).then(() => { released = true; });
  pending[1](response());
  await second;
  await flush();
  assert.equal(released, false);
  pending[0](response());
  await first;
  await closing;
  assert.equal(released, true);
});
