const {test}=require('node:test'),assert=require('node:assert/strict')
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path')
const {createServer}=require('node:http'),{once}=require('node:events')
const {createOpsStore}=require('./store.cjs'),{createChat}=require('./chat.cjs'),{createAlarmScheduler}=require('./alarms.cjs')
const {normalizeTask}=require('./tasks.cjs')
const {modelResponse}=require('../../tests/helpers/model-response.cjs')
async function waitFor(fn){const end=Date.now()+6000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,15))}throw new Error('Timed out waiting for scheduled publication')}
async function fixture(t,{mode='publish',authorized=true,withCover=true,existingId=false,content='写一篇不配图的文章并保存到草稿箱，然后按任务发表授权处理。',action='draft.create',publish,save}={}){
  const dir=mkdtempSync(join(tmpdir(),'oa-auto-publication-')),store=createOpsStore(join(dir,'test.sqlite'))
  let calls=0,writes=0;const publications=[]
  const original={id:'new-draft',title:'New article',html:'<p>Actual saved content</p>',cover:{url:'https://mmbiz.qpic.cn/cover'}}
  const server=createServer(async(req,res)=>{
    for await(const _ of req){};calls++
    if(calls===1)modelResponse(res,{role:'assistant',content:null,tool_calls:[{id:'new-article',type:'function',function:{name:'propose_action',arguments:JSON.stringify({action,title:'Create a new article',payload:JSON.stringify(action==='draft.create'?{...(existingId?{id:'old-draft'}:{}),title:'New article',digest:'Summary',markdown:'New article content.',...(withCover?{cover:original.cover}:{})}:{id:'old-draft',mode:'api',massNotify:true})})}}]})
    else modelResponse(res,{role:'assistant',content:'Draft work completed.'})
  });server.listen(0,'127.0.0.1');await once(server,'listening')
  const mp={getApiConfig:()=>({connected:true}),getDraft:async(_id,id)=>({...original,id}),saveDraft:async(_id,payload)=>{writes++;assert.equal(payload.id,undefined);await save?.(store);return original},
    publishOfficial:async(account,params)=>{publications.push({account,...params});await publish?.(params);return {status:'submitted',massNotify:params.massNotify,publishId:'p1',publicationId:'receipt1'}},
    getPublishStatus:async()=>({status:'succeeded'})}
  const settings={private:()=>({model:{name:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'test-key'}})}
  const chat=createChat({store,settings,mp,notify:()=>{},getAccount:()=>({name:'Test'}),act:async()=>{}})
  const alarms=createAlarmScheduler({store,chat,mp,notify:()=>{},getAccount:()=>({name:'Test'})})
  const task=normalizeTask({type:'assistant',name:'Author task',content,publication:{mode},schedule:{time:'23:59',repeat:'daily'}},null,'a',[])
  if(authorized)task.publication.authorizedAt=Date.now()
  store.put('tasks','a',task)
  t.after(async()=>{await alarms.close();await chat.close();server.closeAllConnections();server.close();store.close();rmSync(dir,{recursive:true,force:true})})
  return {store,chat,alarms,task,publications,get writes(){return writes},get calls(){return calls},async run(options){const run=alarms.start('a',task,options);await waitFor(()=>store.get('runs','a',run.id)?.status!=='running');return store.get('runs','a',run.id)}}
}
for(const mode of ['publish','mass'])test(`explicit ${mode} authorization applies only to the newly saved draft and final success awaits a receipt`,async t=>{
  const f=await fixture(t,{mode}),run=await f.run()
  assert.equal(f.writes,1);assert.equal(f.publications.length,1);assert.equal(f.publications[0].draftId,'new-draft');assert.equal(f.publications[0].massNotify,mode==='mass')
  assert.match(f.publications[0].expectedVersion,/^[a-f0-9]{64}$/);assert.equal(run.status,'submitted');assert.equal(f.calls,1)
  await f.alarms.pollPublications();assert.equal(f.store.get('runs','a',run.id).status,'succeeded')
})
for(const mode of ['confirm','publish'])test(`${mode} without persisted explicit publication authorization cannot auto-publish`,async t=>{
  const f=await fixture(t,{mode,authorized:false}),run=await f.run()
  assert.equal(f.publications.length,0);assert.equal(f.writes,mode==='confirm'?1:0)
  assert.equal(run.status,mode==='confirm'?'succeeded':'waiting_confirmation')
})
test('explicit automatic publication also authorizes its necessary new-draft creation without requiring magic draft wording',async t=>{
  const f=await fixture(t,{mode:'publish',content:'写一篇纯文字短文并自动发表。'}),run=await f.run()
  assert.equal(f.writes,1);assert.equal(f.publications.length,1);assert.equal(run.status,'submitted')
})
test('trial execution of an authorized mass task still produces only a draft',async t=>{
  const f=await fixture(t,{mode:'mass'}),run=await f.run({trial:true})
  assert.equal(f.writes,1);assert.equal(f.publications.length,0);assert.equal(run.status,'succeeded')
})
test('a model cannot apply scheduled authority to a pre-existing draft',async t=>{
  const f=await fixture(t,{mode:'mass',action:'draft.publish'}),run=await f.run()
  assert.equal(f.publications.length,0);assert.equal(f.writes,0);assert.equal(run.status,'waiting_confirmation')
})
test('an article without its required cover stays pending, never automatically publishes',async t=>{
  const f=await fixture(t,{withCover:false}),run=await f.run()
  assert.equal(run.status,'waiting_confirmation');assert.equal(f.writes,0);assert.equal(f.publications.length,0)
})
test('revoking the task while saving the draft prevents the following publication',async t=>{
  const f=await fixture(t,{save:async store=>{const task=store.list('tasks','a')[0];store.put('tasks','a',{...task,enabled:false})}})
  await f.run();assert.equal(f.writes,1);assert.equal(f.publications.length,0)
})
for(const state of ['verification_required','uncertain'])test(`scheduled ${state} response is retained and never falls back to another sending mode`,async t=>{
  const f=await fixture(t,{mode:'mass',publish:async()=>{const error=new Error('Platform verification required or result uncertain');error.publicationState=state;throw error}})
  const run=await f.run();assert.equal(run.status,state==='verification_required'?'waiting_verification':'uncertain')
  assert.equal(f.publications.length,1);assert.equal(f.publications[0].massNotify,true)
})
test('stopping after the final request was accepted does not relabel the transmission as cancelled',async t=>{
  let release,started=false;const gate=new Promise(resolve=>{release=resolve})
  const f=await fixture(t,{publish:async()=>{started=true;await gate}})
  const run=f.alarms.start('a',f.task);await waitFor(()=>started);f.alarms.stop('a',run.id);release()
  await waitFor(()=>f.store.get('runs','a',run.id).status!=='running')
  assert.equal(f.store.get('runs','a',run.id).status,'submitted');assert.equal(f.publications.length,1)
})
test('a new-draft proposal containing an existing draft id is rejected before saving or publishing',async t=>{
  const f=await fixture(t,{existingId:true}),run=await f.run()
  assert.equal(f.writes,0);assert.equal(f.publications.length,0);assert.equal(run.status,'not_submitted')
})
test('normalization defaults old tasks to confirmation and cannot accept a forged authorization timestamp',()=>{
  const input={type:'assistant',name:'Old task',content:'保存草稿',schedule:{time:'08:00',repeat:'daily'}}
  assert.deepEqual(normalizeTask(input,null,'a',[]).publication,{mode:'confirm'})
  assert.deepEqual(normalizeTask({...input,publication:{mode:'mass',authorizedAt:1}},null,'a',[]).publication,{mode:'mass'})
  assert.throws(()=>normalizeTask({...input,publication:{mode:'other'}},null,'a',[]),/发表方式/)
})
