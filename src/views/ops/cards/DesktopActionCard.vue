<!-- 真实操作确认卡：列出确认后实际执行的参数，由主进程执行一次性确认或取消，并显示真实结果。 -->
<script setup>
import { computed, ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { Check, X, LoaderCircle, AlertCircle, Send, ExternalLink, RefreshCw } from 'lucide-vue-next'
import { executeAction, ws, db } from '../../../store/workspace.js'
import { toast, openPreview, openPublish } from '../../../store/ui.js'
import MassQuota from '../../../components/MassQuota.vue'
import TaskForm from '../TaskForm.vue'
import AssistantTaskFields from '../AssistantTaskFields.vue'
import TaskCoverField from '../TaskCoverField.vue'
import CardImages from './CardImages.vue'

const props = defineProps({ message: { type: Object, required: true } })
const router = useRouter()
const busy = ref(false)
const card = computed(() => props.message.card)
const proposal = JSON.parse(JSON.stringify(props.message.card.payload || {}))
const task = reactive({
  name: '', topic: '', style: '', sourceIds: [], mode: 'draft_notify', massNotify: false,
  ...proposal,
  sourceIds: Array.isArray(proposal.sourceIds) ? proposal.sourceIds : [],
  schedule: {
    repeat: 'daily', weekday: null,
    ...(proposal.type === 'assistant' ? { weekdays: [1, 2, 3, 4, 5], time: '08:00' } : {}),
    prepareAt: '08:00', publishAt: '09:00', ...proposal.schedule,
  },
})
// Keep an existing reviewed cover; the author can replace it while the card is pending.
const draftForm = reactive({ cover: proposal.cover?.url || proposal.cover?.mediaId ? proposal.cover : null })
const needsCover = computed(() => card.value.action === 'draft.create' && card.value.state === 'open'
  && !draftForm.cover?.url && !draftForm.cover?.mediaId)
const LABELS = {
  'task.save': '保存任务', 'task.delete': '删除任务', 'task.toggle': '调整任务', 'task.run': '试写一篇',
  'source.save': '保存资讯来源', 'source.delete': '删除资讯来源',
  'draft.create': '新建草稿', 'draft.update': '修改草稿', 'draft.publish': '发表文章',
}
const label = computed(() => LABELS[card.value.action] || '操作')

function draftName(id) {
  const title = ws.value.drafts.find((item) => String(item.id) === String(id))?.title
  return title ? `《${title}》` : `草稿 ${id}`
}
function recordName(list, id) {
  return list.find((item) => item.id === id)?.name || id
}

// 确认后真正写入的参数；模型写的说明另外显示在下方，不能代替这些参数
const facts = computed(() => {
  const payload = card.value.payload || {}
  switch (card.value.action) {
    case 'draft.publish': return [
      ['文章', payload.title || draftName(payload.id)],
      ['方式', payload.mode === 'web' ? '普通发送' : payload.mode === 'api' ? '接口发送' : '打开公众平台'],
      ['群发通知', payload.massNotify ? '是，占用群发次数' : '否'],
    ]
    case 'draft.update': return [
      ['草稿', draftName(payload.id)],
      ...(payload.templateName ? [['模板', payload.templateName]] : []),
      ...(typeof payload.title === 'string' ? [['新标题', payload.title]] : []),
      ...(typeof payload.digest === 'string' ? [['新摘要', payload.digest || '（清空）']] : []),
      ...(typeof payload.html === 'string' ? [['正文', '替换为新正文']] : []),
    ]
    case 'draft.create': return [
      ['标题', payload.title || '无标题'],
      ...(payload.templateName ? [['模板', payload.templateName]] : []),
      ...(payload.digest ? [['摘要', payload.digest]] : []),
      ...(payload.images?.length ? [['正文配图', `${payload.images.length} 张，已完成视觉审核`]] : []),
      ['封面', draftForm.cover || payload.cover?.url || payload.cover?.mediaId ? '已选择' : '请在下方选择或上传'],
    ]
    case 'task.delete': return [['任务', recordName(db.tasks, payload.id)]]
    case 'task.toggle': return [['任务', recordName(db.tasks, payload.id)], ['改为', payload.enabled ? '开启' : '暂停']]
    case 'task.run': return [['任务', recordName(db.tasks, payload.id)], ['方式', '试写一次，只存草稿']]
    case 'source.save': return [['名称', payload.name || '未命名'], ['网址', payload.url || '']]
    case 'source.delete': return [['来源', recordName(ws.value.sources || [], payload.id)]]
    default: return []
  }
})
const directDraftId = computed(() => card.value.state === 'done' && ['draft.create', 'draft.update'].includes(card.value.action)
  ? card.value.savedDraftId || card.value.payload?.id : null)
const previewable = computed(() => ['draft.create', 'draft.update', 'draft.publish'].includes(card.value.action)
  && typeof card.value.payload?.html === 'string')
const resultLink = computed(() => {
  if (card.value.state !== 'done') return null
  if (card.value.action === 'draft.publish') return { label: '查看发表记录', to: '/published' }
  if (['draft.create', 'draft.update'].includes(card.value.action)) return { label: '打开草稿箱', to: '/drafts' }
  if (card.value.action.startsWith('task.')) return { label: '查看任务', to: '/tasks' }
  return null
})
const STATES = {
  running: ['正在执行', LoaderCircle], done: ['已完成', Check], cancelled: ['已取消', X], failed: ['执行失败', AlertCircle],
}
const receipt = computed(() => {
  const original = card.value.apiResult
  const record = ws.value.apiPublications?.find(item => item.id === original?.publicationId)
  return record ? { ...original, ...record.result, status: record.state, transport: record.transport,
    message: record.error || record.result?.message || '' } : original
})
const resultText = computed(() => receipt.value?.message || ({ succeeded: '微信已确认发表成功', submitted: '已提交微信，等待平台处理',
  preparing: '正在内部准备发送，尚未取得提交回执', prepared: '正在内部准备发送，尚未取得提交回执', submitting: '正在执行微信发送流程，尚未取得提交回执', cancelled: '发送已取消，未提交微信',
  waiting_verification: '等待微信安全验证', waiting_confirmation: '等待微信确认', uncertain: '结果待核实，未自动重发', failed: '发送未完成' }[receipt.value?.status]) || card.value.result)
const needsWechatWindow = computed(() => receipt.value?.transport === 'web' && ['preparing','prepared','submitting','waiting_verification','waiting_confirmation'].includes(receipt.value.status))
const state = computed(() => {
  if (['preparing','prepared','submitting'].includes(receipt.value?.status)) return ['正在普通发送', LoaderCircle]
  if (receipt.value?.status === 'cancelled') return ['已取消发送', X]
  if (receipt.value?.status === 'submitted') return ['已提交微信', LoaderCircle]
  if (receipt.value?.status === 'succeeded') return ['微信已确认成功', Check]
  if (receipt.value?.status === 'waiting_verification') return ['等待微信验证', AlertCircle]
  if (receipt.value?.status === 'waiting_confirmation') return ['等待微信确认', AlertCircle]
  if (card.value.outcome === 'uncertain' || receipt.value?.status === 'uncertain') return ['结果待核实', AlertCircle]
  if (receipt.value?.status === 'failed') return ['发送未完成', AlertCircle]
  return STATES[card.value.state]
})

async function receiptAction(action) {
  busy.value = true
  try { await executeAction(action, { id: receipt.value.publicationId }) }
  catch (error) { toast(error.message, 'warn') }
  finally { busy.value = false }
}

function preview() {
  const payload = card.value.payload
  const original = ws.value.drafts.find((item) => String(item.id) === String(payload.id)) || {}
  openPreview({ ...original, ...payload, id: payload.id || props.message.id, updatedAt: Date.now() })
}

async function act(action) {
  busy.value = true
  try {
    const payload = action !== 'chat.confirm' ? undefined
      : card.value.action === 'task.save' ? task
        : ['draft.create', 'draft.update'].includes(card.value.action) ? draftForm : undefined
    await executeAction(action, { messageId: props.message.id, payload })
  } catch (error) {
    toast(error.message, 'warn')
    console.error('确认卡操作失败：', error)
  } finally {
    busy.value = false
  }
}
async function removeImage(id) {
  busy.value = true
  try {
    await executeAction('chat.image.remove', { messageId: props.message.id, imageId: id })
    if (draftForm.cover?.assetId === id) draftForm.cover = null
  } catch (error) { toast(error.message, 'warn') }
  finally { busy.value = false }
}
</script>

<template>
  <div class="action-card" :class="'is-' + card.state">
    <div class="card-head">
      <span class="kind">{{ label }}</span>
      <span v-if="state" class="state">
        <component :is="state[1]" :size="13" :class="{ spinning: card.state === 'running' || ['preparing','prepared','submitting','submitted'].includes(receipt?.status) }" />
        {{ state[0] }}
      </span>
    </div>
    <strong class="title">{{ card.title }}</strong>
    <dl v-if="facts.length" class="facts">
      <div v-for="[name, value] in facts" :key="name">
        <dt>{{ name }}</dt>
        <dd>{{ value }}</dd>
      </div>
    </dl>
    <MassQuota v-if="card.action === 'draft.publish' && card.payload?.massNotify" :load="card.state === 'open'" />
    <p v-if="card.detail" class="detail">{{ card.detail }}</p>
    <TaskForm
      v-if="card.action === 'task.save' && card.state === 'open' && task.type !== 'assistant'"
      :form="task"
    />
    <AssistantTaskFields
      v-else-if="card.action === 'task.save' && card.state === 'open'"
      :form="task"
      :disabled="busy"
    />
    <TaskCoverField
      v-if="card.action === 'draft.create' && card.state === 'open'"
      :form="draftForm"
    />
    <ul
      v-if="card.action === 'task.save' && task.sources?.length"
      class="pending-sources"
    >
      <li
        v-for="source in task.sources"
        :key="source.url"
      >确认后添加来源：{{ source.name || source.url }} · {{ source.url }}</li>
    </ul>
    <CardImages v-if="card.payload?.images?.length" :images="card.payload.images"
      :editable="card.state === 'open'" :disabled="busy" @remove="removeImage" />
    <p v-if="card.error" class="error">{{ card.error }}</p>
    <p v-else-if="card.state === 'done' && resultText && resultText !== '已完成'" class="result">{{ resultText }}</p>
    <p v-if="card.automaticallyConfirmed" class="auto">{{ card.authorization?.source === 'author_message' ? '按本次明确指令执行' : '定时任务已按任务内容自动执行' }}</p>
    <div v-if="previewable || resultLink || directDraftId || receipt || card.state === 'open'" class="actions">
      <button v-if="needsWechatWindow" class="weui-btn weui-btn_xmini weui-btn_default" :disabled="busy" @click="receiptAction('publication.window')"><ExternalLink :size="13" />微信窗口</button>
      <button v-if="needsWechatWindow" class="weui-btn weui-btn_xmini weui-btn_default" :disabled="busy" @click="receiptAction('publication.cancel')"><X :size="13" />取消发送</button>
      <button v-if="receipt?.publicationId && receipt.status !== 'succeeded'" class="weui-btn weui-btn_xmini weui-btn_default" :disabled="busy" @click="receiptAction('publication.status')"><RefreshCw :size="13" />查询结果</button>
      <button v-if="previewable" class="weui-btn weui-btn_xmini weui-btn_default" @click="preview">预览正文</button>
      <button
        v-if="resultLink"
        class="weui-btn weui-btn_xmini weui-btn_default"
        @click="router.push(resultLink.to)"
      >{{ resultLink.label }}</button>
      <button v-if="directDraftId" class="weui-btn weui-btn_xmini weui-btn_primary" @click="openPublish(directDraftId)"><Send :size="13" />直接发表</button>
      <template v-if="card.state === 'open'">
        <button
          class="weui-btn weui-btn_xmini weui-btn_default"
          :disabled="busy"
          @click="act('chat.cancel')"
        >取消</button>
        <button
          class="weui-btn weui-btn_xmini weui-btn_primary"
          :disabled="busy || needsCover"
          :title="needsCover ? '请先选择或上传封面' : ''"
          @click="act('chat.confirm')"
        >{{ busy ? '正在处理…' : '确认执行' }}</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.action-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.kind {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--brand-light);
  color: #067a3e;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
}

.is-done .state {
  color: var(--brand);
}

.is-failed .state {
  color: var(--danger);
}

.title {
  font-size: 15px;
  overflow-wrap: anywhere;
}

.facts {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-page);
  font-size: 13px;
}

.facts div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
}

.facts dt {
  color: var(--text-2);
}

.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.detail {
  color: var(--text-2);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.actions .weui-btn { display: inline-flex; align-items: center; gap: 5px; }
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.error {
  color: #b54737;
  font-size: 13px;
}

.result {
  font-size: 13px;
}

.auto {
  color: var(--text-3);
  font-size: 12px;
}

.pending-sources {
  padding-left: 18px;
  color: var(--text-2);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
