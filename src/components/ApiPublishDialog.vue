<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Send, RefreshCw, ExternalLink, LoaderCircle, X } from 'lucide-vue-next'
import DeskDialog from './DeskDialog.vue'
import CoverThumb from './CoverThumb.vue'
import { ui, openPreview } from '../store/ui.js'
import { executeAction, ws } from '../store/workspace.js'
import { session } from '../store/session.js'
import { invokeAction } from '../services/workspace.js'
const router = useRouter()
const data = ref(null), loading = ref(false), busy = ref(false), error = ref(''), method = ref('web'), mode = ref('publish'), receipt = ref(null)
let sequence = 0
const quotaText = computed(() => Number.isSafeInteger(data.value?.quota?.left) ? `${data.value.quota.period || '当前周期'}剩余 ${data.value.quota.left} 次` : '群发剩余次数未获取')
const capability = computed(() => data.value?.api?.capabilities?.[mode.value === 'mass' ? 'mass' : 'publish'])
const blocked = computed(() => loading.value || busy.value || data.value?.activePublication || !data.value?.expectedVersion
  || (method.value === 'api' && (!data.value?.api?.connected || ['denied','verification_required'].includes(capability.value?.state)))
  || (mode.value === 'mass' && (!Number.isSafeInteger(data.value?.quota?.left) || data.value.quota.left <= 0)))
const receiptMessage = computed(() => receipt.value?.message || ({preparing:'正在内部准备发送，尚未取得提交回执',prepared:'正在内部准备发送，尚未取得提交回执',submitting:'正在执行微信发送流程，尚未取得提交回执',cancelled:'发送已取消，未提交微信',succeeded:'微信已确认发送成功',failed:'发送未完成',submitted:'已提交微信，等待平台处理',waiting_verification:'等待微信安全验证',waiting_confirmation:'等待微信页面确认',uncertain:'结果待核实，已阻止自动重发'}[receipt.value?.status] || '微信正在处理'))
const activeWebReceipt = computed(() => receipt.value?.transport === 'web' && ['preparing','prepared','submitting','waiting_verification','waiting_confirmation'].includes(receipt.value.status))
async function load() {
  if (!ui.apiPublish || busy.value) return
  const own = ++sequence, account = session.accountId, id = ui.apiPublish.draftId
  loading.value = true; error.value = ''; data.value = null; receipt.value = null; mode.value = 'publish'; method.value = 'web'
  try { const result = await invokeAction('publication.preview', {draftId:id}, account); if (own === sequence && account === session.accountId) data.value = result }
  catch (cause) { if (own === sequence) error.value = cause.message }
  finally { if (own === sequence) loading.value = false }
}
function close() { if (!busy.value) { sequence += 1; ui.apiPublish = null } }
async function request(action,payload,apply,update=true) {
  const own = sequence, account = session.accountId
  busy.value = true; error.value = ''
  try { const result = await (update ? executeAction : invokeAction)(action,payload,account); if (own === sequence) apply?.(result) }
  catch (cause) { if (own === sequence) error.value = cause.message }
  finally { if (own === sequence) busy.value = false }
}
function submit() {
  if (blocked.value) return
  return request('publication.submit',{draftId:ui.apiPublish.draftId,expectedVersion:data.value.expectedVersion,mode:mode.value,transport:method.value},result=>{receipt.value=result})
}
function query() {
  const previous = receipt.value
  return request('publication.status',{id:previous.publicationId},result=>{receipt.value={...previous,...result}})
}
function cancelSending() { return request('publication.cancel',{id:receipt.value.publicationId},result=>{receipt.value=result}) }
function refreshQuota() { if (!busy.value && data.value) return request('publication.quota',{},result=>{data.value.quota=result}) }
function records() { const callback=ui.apiPublish?.onDone; close(); if(callback)callback(); else void router.push('/published') }
function showWindow() { return request('publication.window',{id:receipt.value?.publicationId || data.value?.activePublication?.id},null,false) }
watch(()=>ws.value.apiPublications?.find(item=>item.id===receipt.value?.publicationId),record=>{
  if(record)receipt.value={...receipt.value,...record.result,status:record.state,message:record.error||record.result?.message||''}
})
watch(()=>ui.apiPublish,value=>{if(value)void load()},{immediate:true})
watch(()=>session.accountId,()=>{sequence+=1;ui.apiPublish=null;data.value=null;receipt.value=null;busy.value=false;loading.value=false;error.value=''})
</script>
<template>
  <DeskDialog v-if="ui.apiPublish" title="直接发表" :width="600" @close="close">
    <p v-if="loading" class="state-line"><LoaderCircle :size="16" class="spinning" />正在读取完整草稿和群发次数…</p>
    <template v-if="data">
      <div class="article-summary"><CoverThumb :cover="data.draft.cover" :width="80" /><div><strong>{{ data.draft.title }}</strong><p>{{ data.draft.digest }}</p></div></div>
      <template v-if="!receipt">
        <div class="send-method-row"><span>发送方式</span><div class="send-methods" role="group" aria-label="发送方式"><button type="button" :aria-pressed="method==='web'" :disabled="busy" @click="method='web'">普通发送</button><button type="button" :aria-pressed="method==='api'" :disabled="busy" @click="method='api'">接口发送</button></div></div>
        <div class="notification-row"><label><span>群发通知</span><input class="weui-switch" type="checkbox" aria-label="群发通知" :checked="mode==='mass'" :disabled="busy" @change="mode=$event.target.checked?'mass':'publish'"></label><span class="quota">{{ quotaText }}<button type="button" class="quota-refresh" title="刷新群发次数" aria-label="刷新群发次数" :disabled="busy" @click="refreshQuota"><RefreshCw :size="13" /></button></span></div>
        <p v-if="data.activePublication" class="notice">这篇文章已有待核实提交，已阻止重复发送。请先查询发送记录。</p>
        <p v-else-if="method==='api' && !data.api.connected" class="notice">尚未接入微信官方接口</p>
        <p v-else-if="method==='api' && capability?.message" class="notice">{{ capability.message }}</p>
        <p v-if="mode==='mass' && (data.quota.left===0 || data.quota.error)" class="error">{{ data.quota.left===0?'群发剩余 0 次，不能群发通知':data.quota.error }}</p>
      </template>
      <p v-if="receipt" class="receipt" role="status">{{ receiptMessage }}<span>{{ receipt.transport==='web'?'普通发送':'接口发送' }} · {{ receipt.massNotify?'群发通知':'发表，不群发通知' }}</span><span v-if="receipt.massNotify">上次获取：{{ quotaText }}</span></p>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #footer>
      <button class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="close">{{ receipt?'关闭':'取消' }}</button>
      <button v-if="data && !receipt" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="openPreview(data.draft)">预览正文</button>
      <button v-if="data?.activePublication?.transport==='web' && !receipt" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="showWindow"><ExternalLink :size="14" />微信窗口</button>
      <button v-if="data && method==='api' && !data.api.connected && !receipt" class="weui-btn weui-btn_mini weui-btn_primary" :disabled="busy" @click="close();router.push('/dev-api')">接入接口</button>
      <button v-else-if="!receipt" class="weui-btn weui-btn_mini weui-btn_primary" :disabled="blocked" @click="submit"><LoaderCircle v-if="busy" :size="14" class="spinning" /><Send v-else :size="14" />{{ mode==='mass'?'确认群发':'确认发表' }}</button>
      <button v-if="activeWebReceipt" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="showWindow"><ExternalLink :size="14" />微信窗口</button>
      <button v-if="activeWebReceipt" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="cancelSending"><X :size="14" />取消发送</button>
      <button v-if="receipt" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="records">发表记录</button>
      <button v-if="receipt" class="weui-btn weui-btn_mini weui-btn_primary" :disabled="busy" @click="query"><RefreshCw :size="14" />查询结果</button>
      <button v-if="error && !data" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy || loading" @click="load">重新读取</button>
    </template>
  </DeskDialog>
</template>
<style scoped>
.article-summary {display:flex;align-items:flex-start;gap:12px;margin-bottom:22px;text-align:left}.article-summary>div{min-width:0}.article-summary strong{font-size:15px;overflow-wrap:anywhere}.article-summary p{margin-top:6px;font-size:13px;color:var(--text-2);overflow-wrap:anywhere}
.send-method-row,.notification-row{display:flex;align-items:center;flex-wrap:wrap;gap:14px;text-align:left}.send-method-row>span,.notification-row label>span{color:var(--text-2);font-size:13px}.send-methods{display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden}.send-methods button{min-width:100px;min-height:34px;padding:6px 16px;border:0;background:#fff;color:var(--text-2);font:inherit;font-size:13px;cursor:pointer}.send-methods button+button{border-left:1px solid var(--border)}.send-methods button[aria-pressed=true]{background:var(--brand-light);color:var(--brand)}.send-methods button:disabled{cursor:default;opacity:.65}.notification-row{justify-content:space-between;margin-top:20px}.notification-row label{display:flex;align-items:center;gap:16px}.quota{display:inline-flex;align-items:center;color:var(--text-2);font-size:12px}.quota-refresh{display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:4px;background:none;color:var(--link);cursor:pointer}
.notice{margin-top:14px;color:var(--text-2);font-size:12px;text-align:left;overflow-wrap:anywhere}.error{margin-top:12px;color:var(--danger);font-size:13px;text-align:left;overflow-wrap:anywhere}.receipt{padding:18px 0;text-align:left;font-size:15px;overflow-wrap:anywhere}.receipt span{display:block;margin-top:7px;font-size:13px;color:var(--text-2)}.state-line{display:flex;align-items:center;gap:8px;color:var(--text-2)}.weui-btn{display:inline-flex;align-items:center;gap:5px}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style>
