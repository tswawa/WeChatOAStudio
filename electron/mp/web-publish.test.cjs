const {test}=require('node:test'),assert=require('node:assert/strict')
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path')
const {createWebPublicationService}=require('./web-publish.cjs')
const {publicationVersion,createPublicationJournal}=require('./publications.cjs')
const {createOfficialService}=require('./official.cjs')
const {finalRequest}=require('./web-publish-page.cjs')
function fixture(t,{start,quota=1,currentDraft}={}){
 const directory=mkdtempSync(join(tmpdir(),'oa-normal-send-')),journal=createPublicationJournal(join(directory,'journal.json')),locks=new Set()
 const draft={id:'2039101',title:'Article',html:'<p>Actual article</p>',cover:{url:'https://mmbiz.qpic.cn/cover'}}
 let callbacks,pages=0,closed=0,reads=0,focuses=0
 const options={getAccount:id=>['a','b'].includes(id)?{id}:null,getDraft:async()=>structuredClone(draft),getMassQuota:async()=>({left:quota}),listPublished:async()=>{reads++;return[]},journal,locks,responseWait:1000,
   createPage:async value=>{
     callbacks=value;pages++
     return {
       currentDraft:async()=>currentDraft||structuredClone(draft),focus(){focuses++},close:async()=>{closed++},
       start(){queueMicrotask(()=>{Promise.resolve(start?start(value):value.beforeDispatch().then(()=>value.onResult({accepted:true,nativeMessageId:'3039101'}))).catch(value.onInterrupted)})},
     }
   },
 }
 const service=createWebPublicationService(options)
 t.after(async()=>{await service.close();rmSync(directory,{recursive:true,force:true})})
 return {directory,service,options,draft,journal,locks,get callbacks(){return callbacks},get pages(){return pages},get closed(){return closed},get reads(){return reads},get focuses(){return focuses},send:extra=>service.publish('a',{draftId:draft.id,massNotify:false,expectedVersion:publicationVersion(draft),...extra})}
}
test('ordinary sending works with only the logged-in page and does not require any official API configuration',async t=>{
 const f=fixture(t),result=await f.send()
 assert.equal(result.transport,'web');assert.equal(result.status,'submitted');assert.equal(result.massNotify,false);assert.equal(f.pages,1)
 assert.equal(f.journal.list('a')[0].state,'submitted')
 const again=await f.send();assert.equal(again.reused,true);assert.equal(f.pages,1)
})
for(const quota of [0,null,undefined])test(`mass quota ${quota} cannot create a normal-send window or silently become an ordinary post`,async t=>{
 const f=fixture(t,{quota:quota===undefined?null:quota})
 await assert.rejects(f.send({massNotify:true}),/剩余次数/);assert.equal(f.pages,0)
})
test('normal mass sending preserves the explicit notification flag',async t=>{
 const f=fixture(t),result=await f.send({massNotify:true});assert.equal(result.massNotify,true);assert.equal(f.callbacks.massNotify,true)
})
test('changed versions are rejected before opening, and changed native-window content is never clicked',async t=>{
 const f=fixture(t,{currentDraft:{id:'2039101',title:'Changed',html:'<p>Changed</p>'}})
 await assert.rejects(f.send({expectedVersion:'a'.repeat(64)}),/已修改/);assert.equal(f.pages,0)
 await assert.rejects(f.send(),/不一致/);assert.equal(f.closed,1);assert.equal(f.journal.list('a')[0].state,'failed')
})
test('an additional native security prompt is retained for the author and blocks another transport',async t=>{
 const f=fixture(t,{start:value=>value.onManual({state:'waiting_verification',message:'微信要求扫码'})}),result=await f.send()
 assert.equal(result.status,'waiting_verification');assert.equal((await f.service.status('a',result.publicationId)).status,'waiting_verification');assert.equal(f.reads,0)
 await assert.rejects(f.send(),/正在发送|等待微信/)
 assert.throws(()=>f.service.focus('b',result.publicationId),/已关闭/)
 const api=createOfficialService({settingsPath:join(f.directory,'api.json'),journal:f.journal,locks:f.locks,getAccount:()=>({}),getDraft:async()=>f.draft,encryption:{isEncryptionAvailable:()=>true,encryptString:Buffer.from,decryptString:b=>b.toString()},fetcher:async()=>Response.json({access_token:'test-token',expires_in:7200,total_count:0})})
 t.after(()=>api.close())
 api.configure('a',{appId:'wx1234567890abcdef',appSecret:'test-secret'});await api.test('a')
 await assert.rejects(api.publish('a',{draftId:f.draft.id}),/正在提交/)
 await f.callbacks.beforeDispatch();await f.callbacks.onResult({accepted:true,nativeMessageId:'3039101'})
 assert.equal(f.journal.list('a')[0].state,'submitted')
})
test('unknown network outcomes remain blocked through restart and do not become automatic retries',async t=>{
 const f=fixture(t,{start:async value=>{await value.beforeDispatch();value.onInterrupted(new Error('响应中断，结果待核实'))}})
 const result=await f.send();assert.equal(result.status,'uncertain')
 const reopened=createWebPublicationService({...f.options,journal:createPublicationJournal(join(f.directory,'journal.json'))})
 await assert.rejects(reopened.publish('a',{draftId:f.draft.id,massNotify:true,expectedVersion:publicationVersion(f.draft)}),/待核实/)
 await reopened.close()
 await assert.rejects(f.send(),/待核实/);assert.equal(f.pages,1)
})
test('receipts reconcile only an exact confirmed source draft and notification mode, not a matching title',async t=>{
 const f=fixture(t),result=await f.send()
 f.options.listPublished=async()=>[]
 const reader=createWebPublicationService({...f.options,listPublished:async()=>[{id:'3039101_0',sourceDraftId:'2039101',publishConfirmed:true,mass:true,at:Date.now()}]})
 assert.equal((await reader.status('a',result.publicationId)).status,'submitted')
 const correct=createWebPublicationService({...f.options,listPublished:async()=>[{id:'3039101_0',sourceDraftId:'2039101',publishConfirmed:true,mass:false,at:Date.now()}]})
 assert.equal((await correct.status('a',result.publicationId)).status,'succeeded')
 await assert.rejects(correct.status('b',result.publicationId),/不属于/);await reader.close();await correct.close()
})
test('closing while a native security prompt is pending resolves the attempt and records uncertainty',async t=>{
 const f=fixture(t,{start:value=>value.onManual({state:'waiting_verification',message:'扫码'})}),result=await f.send()
 await f.service.close();assert.equal(f.journal.get('a',result.publicationId).state,'uncertain');assert.equal(f.locks.size,0)
})
test('remaining mass quota is checked again before the final request after waiting for author verification',async t=>{
 let left=1
 const f=fixture(t,{start:async value=>{left=0;try{await value.beforeDispatch()}catch(error){value.onInterrupted(error)}}})
 f.options.getMassQuota=async()=>({left})
 const service=createWebPublicationService({...f.options,getMassQuota:async()=>({left})})
 const result=await service.publish('a',{draftId:f.draft.id,massNotify:true,expectedVersion:publicationVersion(f.draft)})
 assert.equal(result.status,'uncertain');assert.match(result.message,/最终提交前群发次数/)
 await service.close()
})

test('a final normal-page request is parsed structurally and cannot switch article, time or recipient filters',()=>{
 const request={method:'POST',url:'https://mp.weixin.qq.com/cgi-bin/masssend?is_release_publish_page=1',postData:'appmsgid=2039101&send_time=0&sex=0&groupid='}
 assert.deepEqual(finalRequest(request),{draftId:'2039101',massNotify:false})
 assert.equal(finalRequest({...request,url:'https://mp.weixin.qq.com/cgi-bin/masssend?t=ajax-response'}).massNotify,true)
 assert.equal(finalRequest({...request,url:request.url+'&for_check=1'}),null)
 assert.equal(finalRequest({...request,url:'https://mp.weixin.qq.com/cgi-bin/masssend?action=check_music'}),null)
 assert.throws(()=>finalRequest({...request,postData:'appmsgid=2039101&send_time=1234'}),/时间/)
 assert.throws(()=>finalRequest({...request,postData:'appmsgid=2039101&groupid=2'}),/分组/)
 assert.throws(()=>finalRequest({...request,postData:'appmsgid=2039101&appmsgid=99999'}),/参数重复/)
 assert.throws(()=>finalRequest({...request,url:request.url+'&action=unknown'}),/已变化/)
})
test('image-gallery changes participate in publication versions without altering normal article version vectors',()=>{
 const draft={id:'2039101',title:'Gallery',html:'<p>Caption</p>',itemShowType:8,images:[{fileId:'1',url:'https://mmbiz.qpic.cn/one'}]}
 assert.notEqual(publicationVersion(draft),publicationVersion({...draft,images:[{fileId:'2',url:'https://mmbiz.qpic.cn/two'}]}))
})

test('a historical timeout is retryable only when durable tracking proves no final release and the platform has no matching record',async t=>{
 const f=fixture(t,{start:value=>{value.onProgress({phase:'observe',identity:'verified',requestReleased:false});value.onInterrupted(new Error('Waiting timed out'))}})
 const first=await f.send();assert.equal(first.status,'uncertain')
 await f.service.close()
 const service=createWebPublicationService({...f.options,journal:createPublicationJournal(join(f.directory,'journal.json'))})
 t.after(()=>service.close())
 const status=await service.status('a',first.publicationId)
 assert.equal(status.status,'failed');assert.equal(status.code,'WX_NOT_SUBMITTED')
 assert.equal(f.journal.get('a',first.publicationId).state,'uncertain')
 assert.equal(createPublicationJournal(join(f.directory,'journal.json')).get('a',first.publicationId).previousError,'Waiting timed out')
 assert.equal(f.pages,1)
})
for(const changed of ['released','dispatch-stamp','receipt','platform-record','old-untracked'])test(`uncertain ${changed} attempts cannot be declared unsent from an empty successful receipt`,async t=>{
 const f=fixture(t,{start:value=>{value.onProgress({phase:'observe',identity:'verified',requestReleased:false});value.onInterrupted(new Error('Unknown outcome'))}}),first=await f.send()
 await f.service.close()
 const item=f.journal.get('a',first.publicationId)
 if(changed==='released')item.diagnostics.requestReleased=true
 if(changed==='dispatch-stamp')item.dispatchedAt=Date.now()
 if(changed==='receipt')item.result.nativeMessageId='3039101'
 if(changed==='old-untracked')delete item.diagnostics
 f.journal.put('a',item)
 const service=createWebPublicationService({...f.options,listPublished:async()=>changed==='platform-record'?[{sourceDraftId:f.draft.id,publishConfirmed:false,deleted:false}]:[],journal:createPublicationJournal(join(f.directory,'journal.json'))})
 t.after(()=>service.close())
 assert.equal((await service.status('a',first.publicationId)).status,'uncertain')
 await assert.rejects(service.publish('a',{draftId:f.draft.id,expectedVersion:publicationVersion(f.draft)}),/待核实/)
 assert.equal(f.pages,1)
})

test('an already-aborted Bot operation cannot open an ordinary-send window', async t => {
 const f = fixture(t), controller = new AbortController()
 controller.abort(new Error('Author stopped'))
 await assert.rejects(f.send({ signal: controller.signal }), /Author stopped/)
 assert.equal(f.pages, 0)
 assert.equal(f.journal.list('a').length, 0)
})
test('stopping a pending ordinary-send operation prevents its later final dispatch', async t => {
 let ready, release
 const waiting = new Promise(resolve => { ready = resolve }), gate = new Promise(resolve => { release = resolve })
 let finalRequests = 0
 const f = fixture(t, { start: async value => { ready(); await gate; await value.beforeDispatch(); finalRequests++; await value.onResult({ accepted: true }) } })
 const controller = new AbortController(), pending = f.send({ signal: controller.signal })
 await waiting
 controller.abort(new Error('Author stopped')); release()
 const result = await pending
 assert.equal(finalRequests, 0)
 assert.equal(result.status, 'cancelled')
 assert.match(result.message, /作者已取消/)
 await assert.rejects(f.callbacks.beforeDispatch(), /Author stopped/)
})

test('background processing does not become an invented manual confirmation when the first response deadline passes',async t=>{
 const f=fixture(t,{start:()=>{}}),service=createWebPublicationService({...f.options,responseWait:15})
 t.after(()=>service.close())
 const result=await service.publish('a',{draftId:f.draft.id,expectedVersion:publicationVersion(f.draft)})
 assert.equal(result.status,'submitting');assert.equal(f.focuses,0);assert.equal(f.journal.list('a')[0].dispatchedAt,undefined)
 assert.match(result.message,/尚未取得提交回执/)
 await f.callbacks.beforeDispatch();await f.callbacks.onResult({accepted:true,nativeMessageId:'3039101'})
 assert.equal(f.journal.list('a')[0].state,'submitted')
})
test('an identity wait keeps the native window alive and is shown once, then verified recovery resumes without reauthorization',async t=>{
 const f=fixture(t,{start:value=>value.onManual({state:'waiting_confirmation',code:'MP_IDENTITY_UNAVAILABLE',message:'身份暂时不可读',diagnostics:{phase:'settings',identity:'unavailable'}})})
 const result=await f.send();assert.equal(result.status,'waiting_confirmation');assert.equal(f.closed,0);assert.equal(f.focuses,1)
 f.callbacks.onManual({state:'waiting_confirmation',code:'MP_IDENTITY_UNAVAILABLE',message:'身份暂时不可读',diagnostics:{phase:'settings',identity:'unavailable'}})
 assert.equal(f.focuses,1)
 f.callbacks.onProgress({phase:'settings',identity:'verified',dialog:'settings',notification:false,requestReleased:false,apiKey:'must-not-persist',cookie:'must-not-persist'})
 const resumed=f.journal.list('a')[0];assert.equal(resumed.state,'submitting');assert.equal(resumed.error,'');assert.equal(resumed.diagnostics.apiKey,undefined);assert.equal(resumed.diagnostics.cookie,undefined)
 await f.callbacks.beforeDispatch();await f.callbacks.onResult({accepted:true,nativeMessageId:'3039101'})
 assert.equal(f.journal.list('a')[0].state,'submitted')
})
test('only the owning account can cancel a live background send, and a known unsubmitted attempt is not mislabeled uncertain',async t=>{
 const f=fixture(t,{start:value=>value.onManual({state:'waiting_verification',message:'手机确认'})}),result=await f.send()
 await assert.rejects(f.service.cancel('b',result.publicationId),/不能取消/)
 assert.equal(f.closed,0)
 const cancelled=await f.service.cancel('a',result.publicationId)
 assert.equal(cancelled.status,'cancelled');assert.equal(f.closed,1);assert.equal(f.locks.size,0)
 await assert.rejects(f.callbacks.beforeDispatch(),/停止/)
 assert.equal((await f.service.status('a',result.publicationId)).status,'cancelled')
})
test('cancellation after final dispatch remains uncertain instead of claiming the send was retracted',async t=>{
 const f=fixture(t,{start:async value=>{await value.beforeDispatch();value.onManual({state:'waiting_confirmation',message:'请求仍在处理'})}}),result=await f.send()
 const cancelled=await f.service.cancel('a',result.publicationId)
 assert.equal(cancelled.status,'uncertain');assert.match(cancelled.message,/请求可能已发出/)
 await assert.rejects(f.send(),/待核实/)
})
test('an explicit retry after cancellation gets a new receipt without rewriting the cancelled attempt',async t=>{
 let attempts=0
 const f=fixture(t,{start:async value=>{attempts++;if(attempts===1)value.onManual({state:'waiting_confirmation',message:'等待作者'});else{await value.beforeDispatch();await value.onResult({accepted:true,nativeMessageId:'3039101'})}}})
 const first=await f.send();await f.service.cancel('a',first.publicationId)
 const second=await f.send();assert.equal(second.status,'submitted');assert.notEqual(second.publicationId,first.publicationId)
 assert.equal(f.journal.get('a',first.publicationId).state,'cancelled');assert.equal(f.journal.list('a').length,2)
})

test('verified mismatch before releasing a request is a blocked failure while old uncertain records still cannot be replayed',async t=>{
 const f=fixture(t,{start:value=>value.onInterrupted(Object.assign(new Error('已确认是另一个公众号'),{code:'MP_ACCOUNT_MISMATCH',nativeDispatchAttempted:false,diagnostics:{identity:'mismatch',requestReleased:false}}))})
 const result=await f.send();assert.equal(result.status,'failed');assert.equal(result.code,'MP_ACCOUNT_MISMATCH');assert.equal(result.diagnostics.identity,'mismatch')
 assert.equal(f.journal.list('a')[0].dispatchedAt,undefined)
})
