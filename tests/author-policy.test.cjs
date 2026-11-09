// Regression coverage for author-owned work policies rather than hidden application quotas.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createServer}=require('node:http'),{once}=require('node:events')
const {createOpsStore}=require('../electron/ops/store.cjs'),{createImageService}=require('../electron/images/index.cjs')
const {renderArticle}=require('../electron/ops/content.cjs'),{searchImages}=require('../electron/images/search.cjs')
const {createWebSearch}=require('../electron/ops/web-search.cjs'),{createNativeSearch,cleanSources}=require('../electron/ops/native-search.cjs')
const {nativeImageCandidates}=require('../electron/ops/search.cjs'),{createAttachmentService}=require('../electron/bot/attachments.cjs')
const {extractDocument}=require('../electron/bot/documents.cjs'),{normalizeBot,normalizeModel}=require('../electron/bot/config.cjs')
const {createMemory}=require('../electron/bot/memory.cjs'),{createChat}=require('../electron/ops/chat.cjs')
const {modelResponse}=require('./helpers/model-response.cjs')
const png=fs.readFileSync(path.join(__dirname,'../electron/assets/app-icon.png'))
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oa-author-policy-')),store=createOpsStore(path.join(directory,'test.sqlite'));t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true})});return {directory,store}}
const approved=()=>({approved:true,description:'An actual application icon',reason:'Matches the author request',model:'current-model',reviewedAt:Date.now()})
test('more than six article images and more than three simultaneous reviews are accepted under author rules',async t=>{
 const f=setup(t),rules='作者要求：本篇使用12张配图，先并行审核8张，其余按需处理。',waiting=[]
 let started=0,release
 const gate=new Promise(resolve=>{release=resolve})
 const service=createImageService({store:f.store,settings:{private:()=>({model:{name:'current-model'},bot:{instructions:rules},images:{downloadDirectory:path.join(f.directory,'approved')}})},mp:{},network:{fetchBytes:async()=>({bytes:png,type:'image/png'})},
 reviewer:async(_settings,image,_topic,_source,context)=>{assert.equal(image.mimeType,'image/png');assert.ok(image.bytes.length>0);assert.equal(context.authorInstructions,rules);started++;if(started<=8)await gate;return approved()}})
 t.after(()=>service.close())
 const ids=service.registerCandidates('a',Array.from({length:12},(_,i)=>({imageUrl:`https://example.com/${i}.png`,sourcePage:'https://example.com/article',title:'Reference '+i})))
 const tasks=ids.slice(0,8).map(item=>service.prepare('a',{id:item.id,topic:'Application icons'}))
 const end=Date.now()+5000;while(started<8&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5))
 release();await Promise.all(tasks);assert.equal(started,8)
 for(const item of ids.slice(8))await service.prepare('a',{id:item.id,topic:'Application icons'})
 const html=await renderArticle(ids.map(item=>`![icon](oa-image:${item.id})`).join('\n\n'),[],{resolveImage:ref=>service.resolve('a',ref)})
 assert.equal(service.manifest('a',html).length,12)
})
test('source retrieval accepts more than five URLs and more than 64 image candidates per source',async t=>{
 const f=setup(t),service=createImageService({store:f.store,settings:{private:()=>({})},mp:{},network:{fetchBytes:async url=>({bytes:Buffer.from('<article>'+Array.from({length:90},(_,i)=>`<img src="https://example.com/${new URL(url).pathname.slice(1)}-${i}.png">`).join('')+'</article>'),type:'text/html',url})}})
 t.after(()=>service.close())
 const result=await service.fromSources('a',{urls:Array.from({length:8},(_,i)=>`https://example.com/source${i}`)})
 assert.equal(result.sources.length,8);assert.equal(result.images.length,720)
})
test('keyword search accepts author-requested result counts and does not impose search-frequency quotas',async()=>{
 const html=Array.from({length:24},(_,i)=>`<li class="b_algo"><h2><a href="https://news.example.com/${i}">Result ${i}</a></h2><p>Actual result</p></li><a class="iusc" m='${JSON.stringify({murl:`https://images.example.com/${i}.png`,purl:`https://news.example.com/${i}`,t:'Image '+i})}'></a>`).join('')
 const settings={private:()=>({search:{engines:['bing']}})},network={fetchBytes:async url=>({bytes:Buffer.from(html),type:'text/html',url})}
 assert.equal((await searchImages(network,'application',20,undefined,{settings})).length,20)
 assert.equal((await searchImages(network,'application',undefined,undefined,{settings})).length,24)
 const web=createWebSearch({settings,network})
 for(let i=0;i<15;i++)assert.equal((await web.search('a',{query:'application',limit:20})).results.length,20)
 assert.equal((await web.search('a',{query:'application'})).results.length,24)
})
test('native search and native-page image discovery do not silently truncate to 8 sources, 6 pages or 4 images',async()=>{
 const references=Array.from({length:20},(_,i)=>({url:`https://example.com/page${i}`,title:'Page '+i}))
 assert.equal(cleanSources(references).length,20)
 const native=createNativeSearch({settings:{private:()=>({model:{baseUrl:'http://127.0.0.1:1',name:'test',apiKey:'fixture',apiFormat:'chat-completions'}})},clientFactory:async()=>({chat:{completions:{create:async()=>({async *[Symbol.asyncIterator](){yield {choices:[{delta:{content:'Real results',annotations:references.map(item=>({type:'url_citation',url_citation:item}))}}]}}})}}})})
 assert.equal((await native.search('query')).results.length,20)
 let pages=0
 const images=await nativeImageCandidates({results:references},{fetchBytes:async url=>{pages++;return {bytes:Buffer.from('<article>'+Array.from({length:10},(_,i)=>`<img src="${url}-${i}.png">`).join('')+'</article>')}}},100)
 assert.equal(images.length,100);assert.equal(pages,10)
})
test('attachment counts and extraction lengths follow input data, not fixed per-message or per-document counts',async t=>{
 const f=setup(t),service=createAttachmentService({store:f.store,directory:path.join(f.directory,'attachments')})
 t.after(()=>service.close())
 const large='参考资料。'.repeat(26000),prepared=await Promise.all(Array.from({length:4},(_,i)=>service.prepare('a',{name:`reference${i}.txt`,bytes:[...Buffer.from(i===0?large:'Reference '+i)]})))
 for(let i=4;i<9;i++)prepared.push(await service.prepare('a',{name:`reference${i}.txt`,bytes:[...Buffer.from('Reference '+i)]}))
 assert.equal((await service.validate('a',prepared.map(item=>item.id),{name:'test'})).length,9)
 assert.equal(prepared[0].characters,large.length);assert.equal(prepared[0].truncated,false)
 const text=await service.read('a',{attachmentId:prepared[0].id,offset:100000,length:30000});assert.equal(text.text,large.slice(100000,130000))
})
function pdf(pages){const stream='BT /F1 12 Tf 40 100 Td (Reference text) Tj ET',contentId=pages+4,objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>(i+4)+' 0 R').join(' ')}] /Count ${pages} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',...Array.from({length:pages},()=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`),`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let data='%PDF-1.4\n',offsets=[];for(let i=0;i<objects.length;i++){offsets.push(data.length);data+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}const start=data.length;return Buffer.from(data+`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`)}
test('PDF extraction does not stop at an application-imposed 50-page ceiling',async()=>{
 const result=await extractDocument(pdf(53),'.pdf');assert.equal(result.pages,53);assert.equal(result.extractedPages,53);assert.equal(result.truncated,false);assert.equal(result.text.match(/Reference text/g).length,53)
})
test('author settings and memories are not subject to hidden character, count or 256-call ceilings',t=>{
 const f=setup(t),rules='作者规则：按需要配图和处理资料。'.repeat(1500)
 assert.equal(normalizeBot({instructions:rules,maxSteps:1024}).instructions,rules)
 assert.equal(normalizeBot({instructions:rules,maxSteps:1024}).maxSteps,1024)
 assert.equal(normalizeModel({contextWindow:4194304}).contextWindow,4194304)
 const memory=createMemory(f.store)
 f.store.transaction(()=>{for(let i=0;i<500;i++)f.store.put('bot_memories','a',{id:'fixture-'+i,title:'Fact '+i,content:'Historical fact '+i,createdAt:1,updatedAt:1})})
 assert.equal(memory.save('a',{title:'Author rules',content:rules}).content,rules);assert.equal(memory.list('a').length,501)
})
async function chatFixture(t,responder,{web,images}={}){
 const f=setup(t),requests=[],server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);modelResponse(res,responder(body,requests.length))})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const settings={private:()=>({model:{name:'test',apiKey:'fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`},bot:{maxSteps:10,memoryEnabled:false,instructions:'作者决定配图和并行数量。'}})}
 const chat=createChat({store:f.store,settings,mp:{},web,images,notify:()=>{},getAccount:()=>({name:'Fixture'}),act:async()=>{throw new Error('No WeChat writes')}})
 t.after(async()=>{await chat.close();server.closeAllConnections();server.close()});return {...f,chat,requests}
}
const tool=(id,kind,args={})=>({id,type:'function',function:{name:'read_workspace',arguments:JSON.stringify({kind,...args})}})
test('batch image-review calls can express author-selected parallel work through the actual Bot tool',async t=>{
 let started=0,maximum=0,active=0
 const images={prepare:async(_account,input,context)=>{context.beforeModelCall();started++;active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,15));active--;return {id:input.id,approved:true}}}
 const f=await chatFixture(t,(_body,index)=>index===1?{role:'assistant',content:null,tool_calls:[tool('batch','image_prepare',{images:Array.from({length:8},(_,i)=>({imageId:'candidate-'+i,topic:'Author topic'}))})]}:{role:'assistant',content:'已按规则批量查看。'},{images})
 await f.chat.send('a',{text:'按我的规则并行查看这8张图。'})
 assert.equal(started,8);assert.equal(maximum,8)
 const result=f.requests[1].messages.findLast(message=>message.role==='tool');assert.equal(JSON.parse(result.content).length,8)
})

test('a model tool round can execute more than eight tools without an invented per-round quota',async t=>{
 const f=await chatFixture(t,(_body,index)=>index===1?{role:'assistant',content:null,tool_calls:Array.from({length:12},(_,i)=>tool('call-'+i,'capabilities'))}:{role:'assistant',content:'完成'})
 const result=await f.chat.send('a',{text:'读取这些资料。'})
 assert.equal(result.messages.flatMap(m=>m.activity||[]).filter(step=>step.state==='done').length,12)
 assert.equal(f.requests[1].messages.filter(m=>m.role==='tool').length,12)
 assert.doesNotMatch(f.requests[0].messages[0].content,/最多 6 张|最多 8 条|最多处理 3/)
})
test('retry policy is not hard-coded to a single attempt at identical read parameters',async t=>{
 let calls=0
 const f=await chatFixture(t,(_body,index)=>index<=2?{role:'assistant',content:null,tool_calls:[tool('retry-'+index,'web_search',{query:'same request'})]}:{role:'assistant',content:'读取成功'},
 {web:{search:async()=>{calls++;if(calls===1)throw new Error('Temporary read failure');return {results:[{url:'https://example.com/source',title:'Actual source'}]}}}})
 await f.chat.send('a',{text:'暂时失败时按需要重试这个读取。'})
 assert.equal(calls,2);assert.ok(f.requests[2].messages.filter(m=>m.role==='tool').at(-1).content.includes('Actual source'))
})
