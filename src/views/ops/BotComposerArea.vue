<!-- Keep draft input intact while another session runs or task records are viewed. -->
<script setup>
import { FileText, X, Settings, Square, ArrowUpRight, LoaderCircle } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import ChatComposer from './ChatComposer.vue'

defineProps({
  needsModel: Boolean,
  readOnly: Boolean,
  busy: Boolean,
  elsewhereBusy: Boolean,
  navigating: Boolean,
  draft: { type: Object, default: null },
  submit: Function,
})
defineEmits(['send', 'stop', 'new', 'clear-draft', 'view-execution'])
const router = useRouter()
</script>

<template>
  <div v-if="readOnly" class="dock-note">
    <span>这里记录定时任务的执行过程，不能在此发消息。</span>
    <div class="note-actions">
      <button v-if="busy" class="icon-btn" title="停止执行" aria-label="停止执行" @click="$emit('stop')">
        <Square :size="15" />
      </button>
      <button
        class="weui-btn weui-btn_mini weui-btn_default"
        :disabled="navigating"
        @click="$emit('new')"
      >开始新对话</button>
    </div>
  </div>
  <div v-else-if="needsModel" class="dock-note">
    <span>模型尚未配置，暂时无法发送消息。</span>
    <button class="weui-btn weui-btn_mini weui-btn_primary" @click="router.push('/bot-settings')">
      <Settings :size="15" />去设置
    </button>
  </div>
  <div v-else>
    <div v-if="draft" class="focus-chip">
      <FileText :size="14" />
      <span>正在处理《{{ draft.title || '无标题' }}》</span>
      <button title="不再针对这篇草稿" aria-label="不再针对这篇草稿" @click="$emit('clear-draft')">
        <X :size="13" />
      </button>
    </div>
    <div v-if="elsewhereBusy" class="execution-status" role="status">
      <LoaderCircle :size="14" class="spinning" />
      <span>定时任务正在执行，完成后可发送消息，当前输入会保留。</span>
      <button class="icon-btn" title="查看执行中的任务" aria-label="查看执行中的任务" @click="$emit('view-execution')">
        <ArrowUpRight :size="16" />
      </button>
    </div>
    <ChatComposer
      :busy="busy"
      :submit="submit"
      :disabled="elsewhereBusy || navigating"
      @send="$emit('send', $event)"
      @stop="$emit('stop')"
    />
  </div>
</template>

<style scoped>
.dock-note,
.execution-status,
.note-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dock-note {
  justify-content: space-between;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafbfa;
  color: var(--text-2);
  font-size: 13px;
}
.dock-note > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.note-actions {
  flex: none;
}
.dock-note .weui-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: auto;
  margin: 0;
}
.execution-status {
  margin: 0 0 8px;
  color: var(--text-2);
  font-size: 12px;
}
.execution-status > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.focus-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-bottom: 8px;
  padding: 4px 6px 4px 10px;
  border-radius: 999px;
  background: var(--brand-light);
  color: #067a3e;
  font-size: 12px;
}
.focus-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-chip button {
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
