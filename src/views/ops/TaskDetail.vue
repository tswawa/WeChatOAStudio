<!-- 任务详情：任务设置的查看与修改、启停、立即执行一次、删除，以及运行记录 -->
<script setup>
import { reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import StatusTag from '../../components/StatusTag.vue'
import TaskForm from './TaskForm.vue'
import RunHistory from './RunHistory.vue'
import { updateTask, removeTask, apiPublishOf } from '../../store/workspace.js'
import { session } from '../../store/session.js'
import { TASK_MODES, scheduleText } from '../../store/taskModes.js'
import { runInChat } from '../../assistant/runner.js'
import { toast, confirmAction } from '../../store/ui.js'
import { isDesktop } from '../../services/desktop.js'

const props = defineProps({
  task: { type: Object, required: true },
})

const emit = defineEmits(['removed'])
const router = useRouter()
const form = reactive({})
const apiReady = computed(() => apiPublishOf(session.accountId).ready)

function pick(task) {
  const { name, topic, style, sourceIds, schedule, mode, massNotify, cover } = task
  return JSON.parse(JSON.stringify({ name, topic, style, sourceIds, schedule, mode, massNotify, cover }))
}

const dirty = computed(() => JSON.stringify(pick(form)) !== JSON.stringify(pick(props.task)))

watch(
  () => props.task.id,
  () => Object.assign(form, { cover: null }, pick(props.task)),
  { immediate: true },
)

async function perform(action) {
  try {
    await action()
  } catch (error) {
    toast(error.message, 'warn')
    console.error('任务操作失败：', error)
  }
}

async function save() {
  await perform(async () => {
    await updateTask(props.task.id, pick(form))
    toast('已保存')
  })
}

async function runNow() {
  await perform(async () => {
    await runInChat(props.task, { trial: true })
    router.push('/assistant')
  })
}

// 原型演示用：不等到准备时间，直接按执行方式跑一次完整流程
function simulateDue() {
  runInChat(props.task)
  router.push('/assistant')
}

async function remove() {
  if (!await confirmAction({ title: '删除任务', message: `删除「${props.task.name}」及其运行记录？已写好的草稿会保留。` })) return
  await perform(async () => {
    await removeTask(props.task.id)
    toast('已删除')
    emit('removed')
  })
}
</script>

<template>
  <div class="detail">
    <div class="card">
      <div class="card-title">
        <span class="title-line">
          {{ task.name }}
          <StatusTag :tone="task.enabled ? 'success' : 'muted'">
            {{ task.enabled ? '运行中' : '已暂停' }}
          </StatusTag>
        </span>
        <div class="row-actions">
          <a
            v-if="!isDesktop"
            class="faint demo-link"
            @click="simulateDue"
          >演示：模拟到点执行</a>
          <button
            class="weui-btn weui-btn_mini weui-btn_default"
            @click="perform(() => updateTask(task.id, { enabled: !task.enabled }))"
          >
            {{ task.enabled ? '暂停' : '恢复' }}
          </button>
          <button
            class="weui-btn weui-btn_mini weui-btn_primary"
            @click="runNow"
          >
            试写一篇
          </button>
        </div>
      </div>
      <p class="muted summary">
        {{ scheduleText(task.schedule) }} · {{ TASK_MODES[task.mode].label }}{{ task.massNotify ? ' · 群发通知' : ' · 不推送' }}
      </p>
      <p
        v-if="task.mode === 'auto_publish' && !apiReady"
        class="text-danger warn"
      >
        开发接口没有接入，到发表时间会改为存草稿并提醒扫码。
      </p>
      <TaskForm :form="form" />
      <div class="f-actions">
        <a
          class="text-danger"
          @click="remove"
        >删除任务</a>
        <button
          class="weui-btn weui-btn_mini weui-btn_primary"
          :class="{ 'weui-btn_disabled': !dirty }"
          :disabled="!dirty"
          @click="save"
        >
          保存修改
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        运行记录
      </div>
      <RunHistory :task-id="task.id" />
    </div>
  </div>
</template>

<style scoped>
.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary {
  margin: -8px 0 16px;
  font-size: 13px;
}

.demo-link {
  margin-right: 8px;
  font-size: 12px;
}

.warn {
  margin: -8px 0 16px;
  font-size: 13px;
}

.f-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}
</style>
