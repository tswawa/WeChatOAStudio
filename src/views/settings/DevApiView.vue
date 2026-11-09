<!-- Connection, operation-specific observations and receipts are shown without claiming untested publish permission. -->
<script setup>
import { ref, computed } from 'vue'
import { RefreshCw, LoaderCircle } from 'lucide-vue-next'
import StatusTag from '../../components/StatusTag.vue'
import ProjectInfo from '../../components/ProjectInfo.vue'
import MassQuota from '../../components/MassQuota.vue'
import { ws, executeAction, loadWorkspace } from '../../store/workspace.js'
import { currentAccount } from '../../store/session.js'
import { invokeAction } from '../../services/workspace.js'
import { toast } from '../../store/ui.js'
import { fmtDateTime } from '../../utils/time.js'
import SettingsTabs from '../../components/SettingsTabs.vue'
const appId = ref(ws.value.api.appId || ''), appSecret = ref(''), busy = ref(false), errorText = ref('')
const labels = { unknown: '待提交验证', allowed: '已接收过提交', denied: '无接口权限', verification_required: '等待微信确认', quota_exhausted: '额度不足', uncertain: '结果待核实' }
const abilities = computed(() => [['publish','普通发表，不群发'],['mass','发表并群发通知']].map(([id,name]) => ({ id,name,
  ...(ws.value.api.capabilities?.[id] || { state:'unknown' }) })))
async function connect(save = true) {
  if (busy.value) return
  busy.value = true; errorText.value = ''
  try {
    if (save) await invokeAction('settings.api.save', { appId: appId.value.trim(), appSecret: appSecret.value })
    const result = await invokeAction('settings.api.test')
    await loadWorkspace(); appSecret.value = ''; toast(result.message)
  } catch (error) { errorText.value = error.message }
  finally { busy.value = false }
}
async function disconnect() {
  try { await executeAction('settings.api.save', { connected:false }) }
  catch (error) { errorText.value = error.message }
}
async function query(record) {
  busy.value = true; errorText.value = ''
  try { await executeAction('publication.status', { id:record.id }) }
  catch (error) { errorText.value = error.message }
  finally { busy.value = false }
}
const apiRecords = computed(() => (ws.value.apiPublications || []).filter(record => record.transport !== 'web'))
const receiptLabels = { preparing:'准备中',prepared:'草稿已就绪',submitting:'提交中',uncertain:'结果待核实',submitted:'已提交微信',succeeded:'微信已确认成功',failed:'提交失败' }
</script>
<template>
  <div class="page">
    <div class="page-head"><SettingsTabs /></div>
    <section class="card">
      <div class="card-title">「{{ currentAccount.name }}」的接口状态<button v-if="ws.api.connected" type="button" class="link-button" :disabled="busy" @click="connect(false)"><RefreshCw :size="14" />重新检查</button></div>
      <table class="table"><thead><tr><th>操作</th><th>状态</th><th>平台返回</th></tr></thead><tbody>
        <tr><td>开发接口连接</td><td><StatusTag :tone="ws.api.connected ? 'success':'muted'">{{ ws.api.connected ? '已连接':'未连接' }}</StatusTag></td><td class="muted">{{ ws.api.checkedAt ? fmtDateTime(ws.api.checkedAt):'尚未验证' }}</td></tr>
        <tr v-for="ability in abilities" :key="ability.id"><td>{{ ability.name }}<MassQuota v-if="ability.id==='mass'" :load="ws.api.connected" /></td><td><StatusTag :tone="ability.state==='allowed'?'success':['denied','verification_required','quota_exhausted'].includes(ability.state)?'warning':'muted'">{{ ws.api.connected ? labels[ability.state] || '未验证':'未连接' }}</StatusTag></td><td class="muted">{{ ability.message || '连接测试不执行发表或群发' }}<span v-if="Number.isSafeInteger(ability.remainingCalls)" class="call-quota">接口调用剩余 {{ ability.remainingCalls }} 次</span></td></tr>
      </tbody></table>
    </section>
    <section class="card">
      <div class="card-title">接入微信官方接口</div>
      <div class="form">
        <label><span>AppID</span><input v-model="appId" autocomplete="off" spellcheck="false" placeholder="当前公众号的 AppID" :disabled="busy"></label>
        <label><span>AppSecret</span><input v-model="appSecret" type="password" autocomplete="new-password" :placeholder="ws.api.appSecretConfigured?'已保存，留空保留原密钥':'填写当前公众号的 AppSecret'" :disabled="busy"></label>
        <div class="row-actions"><button class="weui-btn weui-btn_mini weui-btn_primary" :disabled="busy || !appId.trim()" @click="connect(true)"><LoaderCircle v-if="busy" :size="14" />保存并检查连接</button><button v-if="ws.api.connected" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="disconnect">断开</button></div>
      </div>
      <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>
    </section>
    <section v-if="apiRecords.length" class="card">
      <div class="card-title">接口提交记录</div>
      <div v-for="record in apiRecords.slice(0,10)" :key="record.id" class="receipt-row"><div><strong>{{ record.title }}</strong><p>{{ record.kind==='mass'?'群发通知':'普通发表' }} · {{ fmtDateTime(record.updatedAt) }}</p><p v-if="record.error" class="error">{{ record.error }}</p></div><StatusTag>{{ receiptLabels[record.state] || record.state }}</StatusTag><button v-if="record.result" class="link-button" :disabled="busy" @click="query(record)"><RefreshCw :size="14" />查询结果</button></div>
    </section>
    <ProjectInfo />
  </div>
</template>
<style scoped>
.form { display: grid; gap: 16px; max-width: 600px; }.form label { display: grid; grid-template-columns: 90px minmax(0,1fr); align-items: center; gap: 12px; }.form label>span { color: var(--text-2); }input { min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 4px; font: inherit; }.link-button { display: inline-flex; align-items: center; gap: 4px; padding: 4px; border: 0; background: none; color: var(--link); font: inherit; font-size: 13px; cursor: pointer; }.link-button:disabled { opacity:.5; cursor:default; }.call-quota { display:block; margin-top:5px; font-size:12px; }.error { color:var(--danger); font-size:13px; margin-top:10px; overflow-wrap:anywhere; }.receipt-row { display:flex; gap:12px; align-items:center; padding:14px 0; border-top:1px solid var(--border-light); }.receipt-row>div { flex:1; min-width:0; }.receipt-row strong { font-size:14px; overflow-wrap:anywhere; }.receipt-row p { margin-top:4px; color:var(--text-2); font-size:12px; }.weui-btn { display:inline-flex; align-items:center; gap:5px; }.table td:first-child { width: 190px; }.table td:nth-child(2) { width: 140px; }
</style>
