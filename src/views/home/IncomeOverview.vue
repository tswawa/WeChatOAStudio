<!-- Account-scoped financial summaries; unknown amounts are never displayed as zero. -->
<script setup>
import { computed, ref } from 'vue'
import { RefreshCw, ExternalLink, CircleAlert } from 'lucide-vue-next'
import sources from '../../../electron/mp/income-sources.json'
import { refreshWorkspace } from '../../store/workspace.js'
import { invokeAction } from '../../services/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { toast } from '../../store/ui.js'
import { fmtDateTime } from '../../utils/time.js'
import { formatIncomeMetric } from '../../utils/money.js'

const props = defineProps({ income: { type: Object, default: () => ({ channels: [] }) }, loading: Boolean, loaded: Boolean })
const refreshing = ref(false)
const busy = computed(() => props.loading || refreshing.value)
const states = { ready: '已同步', not_open: '未开通', no_summary: '暂无金额汇总', unavailable: '暂不可用', error: '读取失败', stale: '上次数据' }
const channels = computed(() => sources.map(source => ({ ...source,
  ...(props.income?.channels?.find(channel => channel.id === source.id) || { status: 'idle', metrics: [] }) })))
async function refresh() {
  if (busy.value || !isDesktop) return
  refreshing.value = true
  try { await refreshWorkspace('income', { force: true }) }
  catch (error) { toast(error.message, 'warn') }
  finally { refreshing.value = false }
}
async function open(id) {
  if (!isDesktop) return
  try { await invokeAction('income.open', { source: id }) }
  catch (error) { toast(error.message, 'warn') }
}
</script>

<template>
  <section class="card income-overview" aria-labelledby="income-heading" :aria-busy="busy">
    <header class="card-title income-header">
      <h2 id="income-heading">收入概览</h2>
      <div class="income-actions">
        <span v-if="income?.updatedAt" class="updated faint">{{ fmtDateTime(income.updatedAt) }}</span>
        <span v-if="!isDesktop" class="updated faint">演示模式</span>
        <button v-if="isDesktop" type="button" class="income-action" title="刷新收入" aria-label="刷新收入" :disabled="busy" @click="refresh">
          <RefreshCw :size="13" :class="{ spinning: busy }" />刷新
        </button>
      </div>
    </header>
    <div class="income-grid">
      <article v-for="channel in channels" :key="channel.id" class="income-source" :data-income-source="channel.id">
        <div class="source-header">
          <h3>{{ channel.name }}</h3>
          <span class="source-status" :class="{ warning: ['stale','error'].includes(channel.status) }">{{ channel.status === 'idle' ? busy || !loaded ? '正在读取' : '未读取' : states[channel.status] }}</span>
          <button v-if="isDesktop" type="button" class="income-action source-detail" :title="'在公众平台查看' + channel.name" :aria-label="'在公众平台查看' + channel.name" @click="open(channel.id)">详情<ExternalLink :size="12" /></button>
        </div>
        <template v-if="channel.metrics?.length">
          <dl class="income-metrics">
            <div v-for="(metric,index) in channel.metrics" :key="metric.id" :class="{ primary: index === 0 }">
              <dt>{{ metric.label }}<span v-if="metric.date" class="metric-date">{{ metric.date }}</span></dt>
              <dd>{{ formatIncomeMetric(metric) }}</dd>
            </div>
          </dl>
          <p v-if="channel.status === 'stale'" class="source-note warning"><CircleAlert :size="13" />刷新失败，保留 {{ fmtDateTime(channel.updatedAt) }} 的数据</p>
          <p v-else-if="channel.note" class="source-note">{{ channel.note }}</p>
        </template>
        <div v-else class="source-empty">
          <strong>{{ ['error','stale'].includes(channel.status) ? '暂时无法读取' : channel.status === 'idle' ? busy || !loaded ? '正在读取…' : '尚未获取' : channel.note || states[channel.status] }}</strong>
          <span v-if="channel.error">{{ channel.error }}</span>
          <span v-else-if="channel.status === 'not_open'">以公众平台开通状态为准</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.income-overview { min-width: 0; }
.income-header { flex-wrap: wrap; gap: 12px; }
.income-header h2 { margin: 0; font: inherit; }
.income-actions { display: inline-flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 12px; margin-left: auto; }
.updated { font-size: 12px; font-weight: 400; }
.income-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.income-source { min-width: 0; }
.source-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.source-header h3 { margin: 0; font-size: 14px; font-weight: 500; }
.source-status { color: var(--text-3); font-size: 12px; }
.source-detail { margin-left: auto; }
.income-action { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 24px; padding: 2px 4px; border: 0; border-radius: 4px; color: var(--link); background: none; font: inherit; font-size: 13px; font-weight: 400; white-space: nowrap; cursor: pointer; }
.income-action:hover { background: var(--bg-hover); }
.income-action:disabled { color: var(--text-3); cursor: default; }
.income-action:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.income-action svg { flex: none; }
.income-metrics { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin: 0; }
.income-metrics > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
.income-metrics dt { min-width: 0; color: var(--text-2); font-size: 12px; overflow-wrap: anywhere; }
.income-metrics dd { margin: 0; color: var(--text-1); font-size: 14px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.income-metrics .primary { display: grid; gap: 4px; margin-bottom: 4px; }
.income-metrics .primary dd { font-size: 22px; line-height: 1.4; font-weight: 600; }
.metric-date { display: block; margin-top: 3px; color: var(--text-3); font-size: 11px; }
.source-empty { display: grid; align-content: start; gap: 8px; min-height: 88px; padding-top: 4px; }
.source-empty strong { color: var(--text-2); font-size: 15px; line-height: 1.6; font-weight: 400; }
.source-empty span, .source-note { color: var(--text-3); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.source-note { display: flex; align-items: flex-start; gap: 5px; margin: 12px 0 0; }
.source-note svg { flex: none; margin-top: 3px; }
.warning { color: #9d5b16; }
.spinning { animation: income-spin 1s linear infinite; }
@keyframes income-spin { to { transform: rotate(360deg); } }
@container workspace (max-width: 700px) {
  .income-grid { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .income-source + .income-source { padding-top: 16px; border-top: 1px solid var(--border-light); }
}
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
