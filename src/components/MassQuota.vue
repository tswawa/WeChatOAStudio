<script setup>
import { computed, ref, onMounted } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { ws, executeAction } from '../store/workspace.js'
import { session } from '../store/session.js'
import { isDesktop } from '../services/desktop.js'
const props = defineProps({ load: Boolean })
const busy = ref(false), error = ref('')
const quota = computed(() => ws.value.massQuota || {})
const text = computed(() => Number.isSafeInteger(quota.value.left)
  ? `${quota.value.stale ? '上次获取：' : ''}${quota.value.period || '当前周期'}剩余 ${quota.value.left}${Number.isSafeInteger(quota.value.total) ? '/' + quota.value.total : ''} 次`
  : '群发剩余次数未获取')
async function refresh() {
  if (busy.value || !isDesktop) return
  busy.value = true; error.value = ''
  try { await executeAction('publication.quota', {}, session.accountId) }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onMounted(() => { if (props.load) void refresh() })
</script>
<template>
  <span class="mass-quota"><span :title="quota.fetchedAt ? new Date(quota.fetchedAt).toLocaleString() + ' 获取' : ''">{{ text }}</span><button v-if="isDesktop" type="button" title="刷新群发次数" aria-label="刷新群发次数" :disabled="busy" @click="refresh"><RefreshCw :size="13" :class="{ spinning: busy }" /></button><small v-if="error || quota.error" role="status">{{ error || quota.error }}</small></span>
</template>
<style scoped>
.mass-quota { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--text-2); font-size: 12px; }
button { display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--link); cursor: pointer; }
button:hover { background: var(--bg-hover); } button:disabled { opacity: .5; cursor: default; }
small { width: 100%; color: var(--danger); overflow-wrap: anywhere; }.spinning { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
</style>
