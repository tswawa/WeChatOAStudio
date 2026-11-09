<script setup>
import { ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { ws, executeAction } from '../store/workspace.js'
import { fmtDateTime } from '../utils/time.js'
import StatusTag from './StatusTag.vue'
const busy = ref(''), error = ref('')
const labels = {waiting_verification:'等待微信验证',waiting_confirmation:'等待微信确认',cancelled:'已取消',preparing:'准备中',prepared:'官方草稿已就绪',submitting:'提交中',uncertain:'结果待核实',submitted:'已提交微信',succeeded:'微信已确认成功',failed:'提交失败'}
async function query(item) {
  busy.value = item.id; error.value = ''
  try { await executeAction('publication.status', {id:item.id}) }
  catch (cause) { error.value = cause.message }
  finally { busy.value = '' }
}
</script>
<template>
  <section v-if="ws.apiPublications?.length" class="api-receipts">
    <h2>发送记录</h2>
    <div v-for="item in ws.apiPublications.slice(0,10)" :key="item.id" class="receipt-row"><div><strong>{{ item.title }}</strong><p>{{ item.transport==='web'?'普通发送':'接口发送' }} · {{ item.kind==='mass'?'群发通知':'普通发表' }} · {{ fmtDateTime(item.updatedAt) }}</p><p v-if="item.error" class="error">{{ item.error }}</p></div><StatusTag :tone="item.state==='succeeded'?'success':['uncertain','failed'].includes(item.state)?'warning':'muted'">{{ labels[item.state] || item.state }}</StatusTag><button v-if="item.result" type="button" class="query" title="查询微信回执" aria-label="查询微信回执" :disabled="!!busy" @click="query(item)"><RefreshCw :size="15" :class="{spinning:busy===item.id}" /></button></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.api-receipts { margin-bottom: 22px; }h2 { font-size: 15px; font-weight: 500; margin-bottom: 10px; }.receipt-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border-light); }.receipt-row>div { flex: 1; min-width: 0; }.receipt-row strong { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }.receipt-row p { margin-top: 5px; color: var(--text-2); font-size: 12px; }.query { display: grid; place-items: center; flex: none; width: 28px; height: 28px; padding: 0; border: 0; background: none; border-radius: 4px; color: var(--link); cursor: pointer; }.query:hover { background: var(--bg-hover); }.error,.receipt-row .error { color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }.spinning { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
</style>
