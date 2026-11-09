const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const {parseHTML}=require('linkedom')
const {nativePublicationStep}=require('./web-publish-dom.cjs')
const {publicationIdentity}=require('./identity.cjs')
function fixture(html){
 const {document}=parseHTML('<html><body>'+html+'</body></html>')
 for(const element of document.querySelectorAll('*')){
  element.getBoundingClientRect=()=>({width:element.style.display==='none'||element.closest('[hidden]')?0:300,height:100})
  element.getAttribute('type')==='checkbox'&&(element.checked=element.hasAttribute('checked'))
 }
 const context=vm.createContext({document,getComputedStyle:e=>({visibility:e.style.visibility||'visible'})})
 return {document,step:input=>vm.runInContext(`(${nativePublicationStep.toString()})(${JSON.stringify(input)})`,context)}
}
const settings=(extra='')=>`<div role="dialog" class="weui-desktop-dialog"><div class="mass-send"><div class="mass_send__notify"><input type="checkbox" checked></div><div class="group_setting"><input type="checkbox"></div><div class="publish_container">定时发表<input type="checkbox"></div>${extra}<div class="mass-send__footer"><button>发表</button></div></div></div>`
test('publication identity distinguishes a missing observation from verified mismatch and login',()=>{
 assert.equal(publicationIdentity(null,'gh_a').state,'unavailable')
 assert.equal(publicationIdentity({authenticated:false,loginRequired:false},'gh_a').state,'unavailable')
 assert.equal(publicationIdentity({authenticated:false,loginRequired:true},'gh_a').state,'login_required')
 assert.equal(publicationIdentity({authenticated:true,originalId:'gh_a',name:'A'},'gh_a').state,'verified')
 assert.equal(publicationIdentity({authenticated:true,originalId:'gh_b',name:'B'},'gh_a').state,'mismatch')
})
test('a real notification form is recognized even when its custom mp-dialog class is on another wrapper',()=>{
 const f=fixture(settings()),toggle=f.document.querySelector('input'),button=f.document.querySelector('button');let clicks=0
 toggle.addEventListener('click',()=>{toggle.checked=!toggle.checked});button.addEventListener('click',()=>clicks++)
 assert.equal(f.step({step:'settings',massNotify:false}).state,'changed');assert.equal(toggle.checked,false);assert.equal(clicks,0)
 assert.equal(f.step({step:'settings',massNotify:false}).state,'settings_submitted');assert.equal(clicks,1)
})
test('observation while identity is missing cannot toggle a checkbox or click any button',()=>{
 const f=fixture(settings());let clicks=0;for(const e of f.document.querySelectorAll('input,button'))e.addEventListener('click',()=>clicks++)
 const result=f.step({step:'settings',massNotify:false,observeOnly:true});assert.equal(result.state,'observed');assert.equal(result.diagnostics.dialog,'settings');assert.equal(clicks,0)
})
test('already-disabled notifications are not clicked back on',()=>{
 const f=fixture(settings()),input=f.document.querySelector('input');input.checked=false;let clicked=0;input.addEventListener('click',()=>clicked++)
 assert.equal(f.step({step:'settings',massNotify:false}).state,'settings_submitted');assert.equal(clicked,0)
})
test('a disabled notification switch stays manual and never submits in the wrong mode',()=>{
 const f=fixture(settings()),input=f.document.querySelector('input');input.disabled=true;let clicked=0;f.document.querySelector('button').addEventListener('click',()=>clicked++)
 const result=f.step({step:'settings',massNotify:false});assert.equal(result.code,'WX_NOTIFICATION_DISABLED');assert.equal(clicked,0)
})
test('the actual double-check container is recognized independently of the outer component class',()=>{
 const f=fixture('<div class="weui-desktop-dialog"><div class="double_check_container"><div class="weui-desktop-msg">未开启群发通知</div></div><button>继续发表</button></div>');let clicked=0;f.document.querySelector('button').addEventListener('click',()=>clicked++)
 assert.equal(f.step({step:'confirm',massNotify:false}).state,'confirmed');assert.equal(clicked,1)
 assert.equal(f.step({step:'confirm',massNotify:true}).code,'WX_NOTIFICATION_MISMATCH');assert.equal(clicked,1)
})
test('unknown confirmations are not accepted because their button happens to say continue publication',()=>{
 const f=fixture('<div class="weui-desktop-dialog"><p>请同意额外操作</p><button>继续发表</button></div>');let clicked=0;f.document.querySelector('button').addEventListener('click',()=>clicked++)
 const result=f.step({step:'confirm',massNotify:false});assert.equal(result.code,'WX_UNKNOWN_CONFIRMATION');assert.equal(clicked,0)
})
test('security overlays take precedence over recognized settings without clicking through them',()=>{
 const f=fixture(settings()+'<div class="dialog_wrp">请使用手机扫码确认<button>继续发表</button></div>');let clicked=0;for(const e of f.document.querySelectorAll('button,input'))e.addEventListener('click',()=>clicked++)
 assert.equal(f.step({step:'settings',massNotify:false}).code,'WX_SECURITY_VERIFICATION');assert.equal(clicked,0)
})
test('an independent unknown overlay blocks clicks on settings behind it',()=>{
 const f=fixture(settings()+'<div class="dialog_wrp"><p>另一个确认</p><button>确定</button></div>');let clicked=0;for(const e of f.document.querySelectorAll('button,input'))e.addEventListener('click',()=>clicked++)
 assert.equal(f.step({step:'settings',massNotify:false}).state,'waiting_confirmation');assert.equal(clicked,0)
})
