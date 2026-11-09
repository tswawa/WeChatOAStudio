<!-- 定时任务详情：展示消息内容，支持编辑、启停、立即运行、删除与运行记录。 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import StatusTag from '../../components/StatusTag.vue'
import RunHistory from './RunHistory.vue'
import ScheduledTaskDialog from './ScheduledTaskDialog.vue'
import { executeAction, updateTask, removeTask } from '../../store/workspace.js'
import { scheduleText, nextRunText } from '../../store/taskModes.js'
import { confirmAction } from '../../store/ui.js'
import modes from '../../../electron/ops/publication-modes.json'
import MassQuota from '../../components/MassQuota.vue'

const props = defineProps({ task: { type: Object, required: true } })
const emit = defineEmits(['removed'])
const router = useRouter()
const editing = ref(false)
const busy = ref(false)
const error = ref('')

async function act(action) {
  if (busy.value) return
  if (action === 'delete' && !await confirmAction({
    title: '删除定时任务', message: `删除「${props.task.name}」及其运行记录？已产生的会话和草稿会保留。`,
  })) return
  busy.value = true
  error.value = ''
  try {
    if (action === 'toggle') await updateTask(props.task.id, { enabled: !props.task.enabled })
    if (action === 'run') {
      await executeAction('task.run', { id: props.task.id })
      await router.push('/bot')
    }
    if (action === 'delete') {
      await removeTask(props.task.id)
      emit('removed')
    }
  } catch (cause) {
    error.value = cause.message
    console.error('定时任务操作失败：', cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <section class="card">
      <div class="card-title">
        <span>{{ task.name }}</span>
        <StatusTag :tone="task.enabled ? 'success' : 'muted'">
          {{ task.enabled ? '已开启' : '已暂停' }}
        </StatusTag>
      </div>
      <p class="schedule">{{ scheduleText(task.schedule) }}<template v-if="task.enabled"> · {{ nextRunText(task) }}</template></p>
      <p class="content">{{ task.content }}</p>
      <p class="schedule">{{ modes.find(mode => mode.id === (task.publication?.mode || 'confirm'))?.label }}</p>
      <MassQuota v-if="task.publication?.mode === 'mass'" :load="true" />
      <p
        v-if="error"
        class="text-danger"
        role="alert"
      >{{ error }}</p>
      <div class="actions">
        <button
          class="weui-btn weui-btn_mini weui-btn_default"
          :disabled="busy"
          @click="editing = true"
        >编辑</button>
        <button
          class="weui-btn weui-btn_mini weui-btn_default"
          :disabled="busy"
          @click="act('toggle')"
        >{{ task.enabled ? '暂停' : '恢复' }}</button>
        <button
          class="weui-btn weui-btn_mini weui-btn_primary"
          :disabled="busy"
          @click="act('run')"
        >立即运行</button>
        <button
          class="delete"
          :disabled="busy"
          @click="act('delete')"
        >删除任务</button>
      </div>
    </section>
    <section class="card">
      <div class="card-title">运行记录</div>
      <RunHistory :task-id="task.id" />
    </section>
    <ScheduledTaskDialog
      v-if="editing"
      :task="task"
      @close="editing = false"
    />
  </div>
</template>

<style scoped>
.schedule {
  margin-bottom: 16px;
  color: var(--text-2);
}

.content {
  padding: 18px;
  margin-bottom: 20px;
  border-radius: var(--radius);
  background: var(--bg-page);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
}

.delete {
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--danger);
  font: inherit;
  cursor: pointer;
}
</style>
