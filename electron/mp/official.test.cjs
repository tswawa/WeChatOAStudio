// All endpoints are controlled: no real account writes occur in these tests.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createOfficialService } = require('./official.cjs')
const { publicationVersion,createPublicationJournal } = require('./publications.cjs')
function fixture(t, {account = {subject:'企业',verified:true}, overrides = {}, reply} = {}) {
  const directory=mkdtempSync(join(tmpdir(),'mp-official-'))
  t.after(()=>rmSync(directory,{recursive:true,force:true}))
  const calls=[],settingsPath=join(directory,'official.json')
  const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(b=>b^75),decryptString:buffer=>Buffer.from(buffer).map(b=>b^75).toString()}
  const draft={id:'web-draft',title:'Real webpage draft',digest:'Summary',html:'<p>Original article</p>',cover:{url:'https://mmbiz.qpic.cn/cover',mediaId:'web-cover-id'}}
  const replies={
    '/cgi-bin/stable_token':{access_token:'private-access-token',expires_in:7200},'/cgi-bin/draft/count':{total_count:3},
    '/cgi-bin/openapi/quota/get':{quota:{daily_remaining:100,daily_limit:100}},
    '/cgi-bin/material/add_material':{media_id:'official-cover-media'},'/cgi-bin/draft/add':{media_id:'official-draft-media'},
    '/cgi-bin/freepublish/submit':{publish_id:'publish-123'},'/cgi-bin/freepublish/get':{publish_status:0,article_id:'article-123'},
    '/cgi-bin/message/mass/sendall':{errcode:0,msg_id:1234},'/cgi-bin/message/mass/get':{msg_status:'SEND_SUCCESS'},
  }
  const options={settingsPath,encryption,getAccount:id=>id==='account'?account:null,
    getDraft:async(_id,id)=>({...draft,id}),getMassQuota:async()=>({left:1,period:'今日'}),
    readImage:async()=>({buffer:Buffer.from('image-bytes'),mimeType:'image/png',filename:'cover.png'}),
    fetcher:async(address,options)=>{
      const url=new URL(address);assert.equal(url.origin,'https://api.weixin.qq.com')
      const call={path:url.pathname,body:options.body instanceof FormData?'multipart':JSON.parse(options.body||'{}')};calls.push(call)
      const value=reply?await reply(call,replies):replies[call.path]
      assert.notEqual(value,undefined,call.path)
      return value instanceof Response?value:new Response(JSON.stringify(value),{status:200})
    },...overrides}
  const service=createOfficialService(options)
  service.configure('account',{appId:'wx1234567890abcdef',appSecret:'private-app-secret'})
  return {service,calls,settingsPath,directory,draft,replies,reopen:()=>createOfficialService(options)}
}
const finalCalls=f=>f.calls.filter(c=>c.path==='/cgi-bin/freepublish/submit'||c.path==='/cgi-bin/message/mass/sendall')
test('an aborted conversation authorization cannot reach an official final publication request', async t => {
  const controller = new AbortController()
  const f = fixture(t, { reply: (call, replies) => {
    if (call.path === '/cgi-bin/draft/add') controller.abort(new Error('Author stopped before final publication'))
    return replies[call.path]
  } })
  await f.service.test('account')
  await assert.rejects(f.service.publish('account', { draftId: 'web-draft', signal: controller.signal }), /Author stopped/)
  assert.equal(finalCalls(f).length, 0)
})
test('connection inspection is read-only and API-call quota does not claim publication permission',async t=>{
  const f=fixture(t);const config=await f.service.test('account')
  assert.equal(config.connected,true);assert.equal(config.capabilities.publish.state,'unknown');assert.equal(config.capabilities.mass.remainingCalls,100)
  assert.equal(config.appSecret,undefined);assert.equal(finalCalls(f).length,0)
  assert.equal(f.calls.some(c=>c.path.includes('add_material')||c.path.includes('draft/add')),false)
})
test('official publication converts the cover and web draft, persists encrypted credentials and waits for final status',async t=>{
  const f=fixture(t);await f.service.test('account')
  const result=await f.service.publish('account',{draftId:'web-draft',expectedVersion:publicationVersion(f.draft)})
  assert.equal(result.status,'submitted');assert.equal(f.calls.find(c=>c.path==='/cgi-bin/draft/add').body.articles[0].thumb_media_id,'official-cover-media')
  assert.equal(finalCalls(f)[0].body.media_id,'official-draft-media');assert.equal(finalCalls(f)[0].body.massNotify,undefined)
  assert.equal((await f.service.getPublishStatus('account',result.publishId)).status,'succeeded')
  assert.equal(f.service.listPublications('account')[0].state,'succeeded')
  assert.doesNotMatch(readFileSync(f.settingsPath,'utf8'),/private-app-secret|private-access-token/)
})
test('an unverified subject is not a local permission test; actual WeChat refusal governs the operation',async t=>{
  const f=fixture(t,{account:{subject:'个人',verified:false},reply:(call,replies)=>call.path==='/cgi-bin/freepublish/submit'?{errcode:48001,errmsg:'api unauthorized'}:replies[call.path]})
  await f.service.test('account');await assert.rejects(f.service.publish('account',{draftId:'web-draft'}),e=>e.publicationState==='denied')
  assert.equal(finalCalls(f).length,1);assert.equal(f.service.getConfig('account').capabilities.publish.state,'denied')
  assert.equal(f.service.getConfig('account').capabilities.mass.state,'unknown')
  await assert.rejects(f.service.publish('account',{draftId:'other'}),/重新检查/);assert.equal(finalCalls(f).length,1)
})
test('mass publication has its own endpoint, stable client message id and platform duplicate checking',async t=>{
  const f=fixture(t);await f.service.test('account');const result=await f.service.publish('account',{draftId:'web-draft',massNotify:true})
  assert.equal(result.messageId,'1234');assert.equal(result.status,'submitted')
  const call=finalCalls(f)[0];assert.equal(call.path,'/cgi-bin/message/mass/sendall');assert.equal(call.body.mpnews.media_id,'official-draft-media')
  assert.equal(call.body.filter.is_to_all,true);assert.equal(call.body.enable_duplicate_check,1);assert.match(call.body.clientmsgid,/^[0-9a-f-]{36}$/)
  assert.equal((await f.service.getMassStatus('account',result.messageId)).status,'succeeded')
  await assert.rejects(f.service.publish('account',{draftId:'api:official-draft-media'}),/网页草稿箱/)
})
for(const left of [0,null,undefined])test(`mass quota ${left} stops before uploading, never silently becomes ordinary publication`,async t=>{
  const f=fixture(t,{overrides:{getMassQuota:async()=>({left,period:'今日'})}});await f.service.test('account');const before=f.calls.length
  await assert.rejects(f.service.publish('account',{draftId:'web-draft',massNotify:true}),/群发剩余/)
  assert.equal(f.calls.length,before);assert.equal(finalCalls(f).length,0)
  assert.equal((await f.service.publish('account',{draftId:'web-draft',massNotify:false})).status,'submitted')
})
test('a confirmed version includes content, cover, author and source URL and is checked before any upload',async t=>{
  const f=fixture(t);await f.service.test('account');const version=publicationVersion(f.draft);f.draft.author='Changed author'
  const before=f.calls.length;await assert.rejects(f.service.publish('account',{draftId:'web-draft',expectedVersion:version}),/被修改/);assert.equal(f.calls.length,before)
  assert.notEqual(publicationVersion({...f.draft,sourceUrl:'https://example.com'}),publicationVersion(f.draft))
})
test('successful submissions are reused across restart without another write',async t=>{
  const f=fixture(t);await f.service.test('account');const first=await f.service.publish('account',{draftId:'web-draft'})
  const again=await f.reopen().publish('account',{draftId:'web-draft'});assert.equal(again.publishId,first.publishId);assert.equal(again.reused,true);assert.equal(finalCalls(f).length,1)
})
test('a per-draft lock rejects simultaneous submissions',async t=>{
  const f=fixture(t);await f.service.test('account');const first=f.service.publish('account',{draftId:'web-draft'})
  await assert.rejects(f.service.publish('account',{draftId:'web-draft'}),/正在提交/);await first;assert.equal(finalCalls(f).length,1)
})
for(const response of ['timeout','invalid-json','missing-receipt','http-504','body-error'])test(`ambiguous ${response} final write stays blocked after restart`,async t=>{
  const f=fixture(t,{reply:(call,replies)=>{
    if(call.path!=='/cgi-bin/freepublish/submit')return replies[call.path]
    if(response==='timeout')throw new Error('network interrupted')
    if(response==='invalid-json')return new Response('not json')
    if(response==='http-504')return new Response('',{status:504})
    if(response==='body-error'){const res=new Response('{}');res.json=async()=>{throw new TypeError('body stream failed')};return res}
    return {errcode:0}
  }})
  await f.service.test('account');await assert.rejects(f.service.publish('account',{draftId:'web-draft'}),e=>e.publicationState==='uncertain')
  assert.equal(f.service.listPublications('account')[0].state,'uncertain')
  await assert.rejects(f.reopen().publish('account',{draftId:'web-draft'}),/阻止重复/);assert.equal(finalCalls(f).length,1)
})
test('an accepted result followed by journal disk failure cannot become a retryable failure',async t=>{
  let base,fail=false
  const journal={get:(...args)=>base.get(...args),list:(...args)=>base.list(...args),put:(account,item)=>{
    if(fail||item.state==='submitted'){fail=true;throw new Error('disk failure')};return base.put(account,item)
  }}
  const f=fixture(t,{overrides:{journal}});base=createPublicationJournal(join(f.directory,'official-publications.json'))
  await f.service.test('account');await assert.rejects(f.service.publish('account',{draftId:'web-draft'}),e=>e.publicationState==='uncertain')
  const restarted=createOfficialService({settingsPath:f.settingsPath,encryption:{decryptString:b=>Buffer.from(b).map(x=>x^75).toString()},
    getAccount:()=>({}),getDraft:async()=>f.draft,fetcher:async()=>{throw new Error('must not send')}})
  await assert.rejects(restarted.publish('account',{draftId:'web-draft'}),/阻止重复/);assert.equal(finalCalls(f).length,1)
})
for(const refusal of [{errcode:45028,errmsg:'masssend quota exceeded',state:'quota_exhausted'},{errcode:50000,errmsg:'security check: need administrator confirmation',state:'verification_required'}])test(`WeChat refusal ${refusal.state} never switches operation or claims success`,async t=>{
  const f=fixture(t,{reply:(call,replies)=>call.path==='/cgi-bin/message/mass/sendall'?refusal:replies[call.path]});await f.service.test('account')
  await assert.rejects(f.service.publish('account',{draftId:'web-draft',massNotify:true}),e=>e.publicationState===refusal.state)
  assert.equal(f.service.getConfig('account').capabilities.mass.state,refusal.state);assert.equal(f.calls.some(c=>c.path==='/cgi-bin/freepublish/submit'),false)
})
test('unknown status responses preserve submitted state instead of falsely reporting failure',async t=>{
  const f=fixture(t);await f.service.test('account');await f.service.publish('account',{draftId:'web-draft'})
  f.replies['/cgi-bin/freepublish/get']={};await assert.rejects(f.service.getPublishStatus('account','publish-123'),/保留待核实/)
  assert.equal(f.service.listPublications('account')[0].state,'submitted')
})
test('switching the sending mode cannot submit an already accepted article version twice',async t=>{
  const f=fixture(t);await f.service.test('account');await f.service.publish('account',{draftId:'web-draft',massNotify:false})
  const result=await f.service.publish('account',{draftId:'web-draft',massNotify:true})
  assert.equal(result.reused,true);assert.equal(result.massNotify,false);assert.match(result.message,/普通发表提交，未重复/);assert.equal(finalCalls(f).length,1)
})
test('changing content or sending mode cannot bypass an unresolved prior submission',async t=>{
  const f=fixture(t,{reply:(call,replies)=>{if(call.path==='/cgi-bin/freepublish/submit')throw new Error('timeout');return replies[call.path]}})
  await f.service.test('account');await assert.rejects(f.service.publish('account',{draftId:'web-draft'}))
  f.draft.html='<p>A changed article</p>'
  await assert.rejects(f.service.publish('account',{draftId:'web-draft',massNotify:true}),/阻止重复/);assert.equal(finalCalls(f).length,1)
})
for(const setting of [{itemShowType:8},{isPaySubscribe:true},{copyrightType:1},{canReward:true}])test(`native ${JSON.stringify(setting)} is never silently converted to an ordinary article`,async t=>{
  const f=fixture(t);Object.assign(f.draft,setting);await f.service.test('account');const before=f.calls.length
  await assert.rejects(f.service.publish('account',{draftId:'web-draft'}),/微信页面/);assert.equal(f.calls.length,before)
})
test('closing waits for an in-flight official write and never discards its accepted receipt',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve})
  const f=fixture(t,{reply:async(call,replies)=>{if(call.path==='/cgi-bin/freepublish/submit')await gate;return replies[call.path]}})
  await f.service.test('account');const pending=f.service.publish('account',{draftId:'web-draft'})
  while(!finalCalls(f).length)await new Promise(resolve=>setImmediate(resolve))
  let closed=false;const closing=f.service.close().then(()=>{closed=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false)
  release();await pending;await closing;assert.equal(closed,true);assert.equal(f.service.listPublications('account')[0].state,'submitted')
  await assert.rejects(f.service.publish('account',{draftId:'other'}),/正在关闭/)
})
test('publication journal is account scoped and malformed records cannot silently reset duplicate protection',t=>{
  const f=fixture(t);const journal=createPublicationJournal(join(f.directory,'journal.json'));journal.put('a',{id:'one',state:'submitting'})
  assert.equal(journal.get('b','one'),null);assert.deepEqual(journal.list('b'),[]);assert.throws(()=>journal.put('b',{id:'one'}),/不属于/)
})
