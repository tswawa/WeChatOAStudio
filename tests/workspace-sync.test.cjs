// 验证工作区即读缓存、按页刷新、请求去重及失败不延长缓存有效期。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createWorkspaceService } = require('../electron/workspace.cjs');

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mp-workspace-sync-'));
  const calls = [];
  const mp = {
    listDrafts: async (id) => { calls.push(`${id}:drafts`); return [{ id: 'draft-1', title: 'Saved' }]; },
    listMaterials: async (id) => { calls.push(`${id}:materials`); return []; },
    listPublished: async (id) => { calls.push(`${id}:published`); return []; },
    getStats: async (id) => { calls.push(`${id}:data`); return { followers: 6, errors: [] }; },
    getIncome: async (id) => { calls.push(`${id}:income`); return { income: { channels: [], updatedAt: Date.now() }, errors: [] }; },
    getInteractionPart: async (id, section) => { calls.push(`${id}:${section}`); return { [section]: [] }; },
    getInteraction: async () => { throw new Error('Must not read all unrelated pages'); },
    getApiConfig: () => ({ connected: false, appId: '' }),
    interactionAction: async () => ({ saved: true }),
  };
  const options = {
    dbPath: join(directory, 'accounts.sqlite3'), mp,
    ops: { snapshot: () => ({ tasks: [], runs: [], sources: [], messages: [] }) },
    accounts: { find: (id) => ['a', 'b'].includes(id) ? { id } : null },
    notify: () => {},
  };
  return { directory, calls, mp, options };
}

test('snapshots return cache while requests are pending and per-page cache survives restart', async (t) => {
  const f = fixture();
  let service = createWorkspaceService(f.options);
  t.after(async () => { await service.close(); rmSync(f.directory, { recursive: true, force: true }); });
  let finish;
  f.mp.listDrafts = async (id) => {
    f.calls.push(`${id}:drafts`);
    return new Promise((resolve) => { finish = resolve; });
  };
  assert.deepEqual(service.snapshot('a').drafts, []);
  assert.deepEqual(f.calls, []);
  const first = service.handle('content.refresh', 'a', { section: 'drafts', force: false });
  const duplicate = service.handle('content.refresh', 'a', { section: 'drafts', force: false });
  await Promise.resolve();
  const cached = service.snapshot('a');
  assert.deepEqual(cached.drafts, []);
  assert.deepEqual(cached.syncingSections, ['drafts']);
  await service.handle('content.refresh', 'b', { section: 'comments', force: false });
  assert.deepEqual(f.calls, ['a:drafts', 'b:comments']);
  finish([{ id: 'draft-1', title: 'Remote title' }]);
  await Promise.all([first, duplicate]);
  assert.equal(service.snapshot('a').drafts[0].title, 'Remote title');
  assert.deepEqual(service.snapshot('b').drafts, []);
  await service.close();
  service = createWorkspaceService(f.options);
  assert.equal(service.snapshot('a').drafts[0].title, 'Remote title');
  await service.handle('content.refresh', 'a', { section: 'drafts', force: false });
  assert.equal(f.calls.filter((call) => call === 'a:drafts').length, 1);
  f.mp.listDrafts = async (id) => { f.calls.push(`${id}:drafts`); return []; };
  await service.handle('content.refresh', 'a', { section: 'drafts', force: true });
  assert.equal(f.calls.filter((call) => call === 'a:drafts').length, 2);
});

test('partial failure retains data but is retried instead of becoming fresh', async (t) => {
  const f = fixture();
  const service = createWorkspaceService(f.options);
  t.after(async () => { await service.close(); rmSync(f.directory, { recursive: true, force: true }); });
  let attempts = 0;
  f.mp.getStats = async () => {
    attempts += 1;
    return { followers: 6, errors: attempts < 3 ? ['Trend temporarily unavailable'] : [] };
  };
  await service.handle('content.refresh', 'a', { section: 'data', force: false });
  assert.equal(service.snapshot('a').followers, 6);
  assert.equal(service.snapshot('a').syncedSections.data, undefined);
  assert.match(service.snapshot('a').errors.data, /temporarily/);
  await service.handle('content.refresh', 'a', { section: 'data', force: false });
  assert.equal(attempts, 2);
  await service.handle('content.refresh', 'a', { section: 'data', force: false });
  assert.equal(attempts, 3);
  assert.ok(service.snapshot('a').syncedSections.data);
  assert.equal(service.snapshot('a').errors.data, undefined);
});

test('income refresh is cached per account, keeps last successful metrics on failure and never refreshes unrelated modules', async t => {
  const f = fixture();
  const service = createWorkspaceService(f.options);
  t.after(async () => { await service.close(); rmSync(f.directory, { recursive: true, force: true }); });
  let failed = false;
  f.mp.getIncome = async id => {
    f.calls.push(`${id}:income`);
    return { income: { channels: [{ id: 'ads', status: failed ? 'error' : 'ready', metrics: failed ? [] : [{ id: 'total', value: 12345, unit: 'CNY' }], updatedAt: failed ? 200 : 100, error: failed ? 'Timeout' : '' }] }, errors: failed ? ['Timeout'] : [] };
  };
  await service.handle('content.refresh','a',{section:'income',force:false});
  await service.handle('content.refresh','a',{section:'income',force:false});
  assert.deepEqual(f.calls,['a:income']);
  assert.equal(service.snapshot('a').income.channels[0].metrics[0].value,12345);
  assert.deepEqual(service.snapshot('b').income.channels,[]);
  failed = true;
  await service.handle('content.refresh','a',{section:'income',force:true});
  assert.equal(service.snapshot('a').income.channels[0].status,'stale');
  assert.equal(service.snapshot('a').income.channels[0].metrics[0].value,12345);
  assert.equal(service.snapshot('a').income.channels[0].updatedAt,100);
  assert.match(service.snapshot('a').errors.income,/Timeout/);
});

test('publication preview and quota reads are account-scoped, preserve stale counts and require an explicit submit mode',async t=>{
  const f=fixture(),service=createWorkspaceService(f.options)
  t.after(async()=>{await service.close();rmSync(f.directory,{recursive:true,force:true})})
  let writes=0,fail=false
  f.mp.getDraft=async(id,draftId)=>({id:draftId,title:'Draft '+id,html:'<p>Complete body</p>'})
  f.mp.getMassQuota=async id=>{assert.equal(id,'a');if(fail)throw new Error('Quota temporarily unavailable');return {left:0,total:null,period:'今日',fetchedAt:100}}
  f.mp.publishOfficial=async(id,params)=>{assert.equal(id,'a');assert.equal(params.massNotify,false);writes++;return {status:'submitted'}}
  const preview=await service.handle('publication.preview','a',{draftId:'one'});assert.equal(preview.quota.left,0);assert.match(preview.expectedVersion,/^[a-f0-9]{64}$/);assert.equal(writes,0)
  assert.equal(service.snapshot('b').massQuota,undefined)
  fail=true;await assert.rejects(service.handle('publication.quota','a'),/unavailable/);assert.equal(service.snapshot('a').massQuota.left,0);assert.equal(service.snapshot('a').massQuota.stale,true)
  await assert.rejects(service.handle('publication.submit','a',{draftId:'one',mode:'other',expectedVersion:preview.expectedVersion}),/明确选择/)
  await service.handle('publication.submit','a',{draftId:'one',mode:'publish',expectedVersion:preview.expectedVersion});assert.equal(writes,1)
})

test('publication submit dispatches only the selected transport and rejects unknown methods',async t=>{
  const f=fixture(),service=createWorkspaceService(f.options),calls=[]
  t.after(async()=>{await service.close();rmSync(f.directory,{recursive:true,force:true})})
  f.mp.publishOfficial=async(_id,input)=>{calls.push('api');return {transport:'api',...input}}
  f.mp.publishOrdinary=async(_id,input)=>{calls.push('web');return {transport:'web',...input}}
  const input={draftId:'2039101',mode:'publish',expectedVersion:'a'.repeat(64)}
  assert.equal((await service.handle('publication.submit','a',{...input,transport:'web'})).transport,'web')
  assert.equal((await service.handle('publication.submit','a',{...input,transport:'api'})).transport,'api')
  await assert.rejects(service.handle('publication.submit','a',{...input,transport:'unknown'}),/普通发送或接口发送/)
  assert.deepEqual(calls,['web','api'])
})

test('publication cancellation routes only to the account-scoped live-window operation',async t=>{
  const f=fixture(),service=createWorkspaceService(f.options),calls=[]
  t.after(async()=>{await service.close();rmSync(f.directory,{recursive:true,force:true})})
  f.mp.cancelPublication=async(account,id)=>{calls.push({account,id});return {status:'cancelled',publicationId:id}}
  const result=await service.handle('publication.cancel','a',{id:'native-receipt'})
  assert.equal(result.status,'cancelled');assert.deepEqual(calls,[{account:'a',id:'native-receipt'}])
  await assert.rejects(service.handle('publication.cancel','unknown',{id:'native-receipt'}),/公众号|账号/)
  assert.equal(calls.length,1)
})

test('home and reply refresh only their related modules', async (t) => {
  const f = fixture();
  const service = createWorkspaceService(f.options);
  t.after(async () => { await service.close(); rmSync(f.directory, { recursive: true, force: true }); });
  await service.handle('content.refresh', 'a', { section: 'home' });
  assert.deepEqual([...f.calls].sort(), ['a:comments', 'a:data', 'a:drafts', 'a:income', 'a:published']);
  f.calls.length = 0;
  await service.handle('interaction.reply', 'a', { kind: 'comment', id: 'comment-1', text: 'Reply' });
  assert.deepEqual(f.calls, ['a:comments']);
  f.calls.length = 0;
  await service.handle('content.refresh', 'a', { section: 'tasks' });
  assert.deepEqual(f.calls, []);
});
