<!-- 任务确认卡：助手根据一句话填好的任务设置，用户可直接修改，点「确认创建」才生效 -->
<script setup>
import { reactive, computed } from 'vue'
import TaskForm from '../TaskForm.vue'
import { addTask, addSource } from '../../../store/workspace.js'
import { TASK_MODES, scheduleText } from '../../../store/taskModes.js'
import { updateCard, pushBot, pushCard } from '../../../assistant/chatStore.js'
import { nextOccurrence, fmtDateTime } from '../../../utils/time.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const form = reactive(JSON.parse(JSON.stringify(props.message.card.draft)))
const card = computed(() => props.message.card)
const pendingUrls = computed(() => card.value.pendingUrls || [])
const valid = computed(() => form.name.trim() && (form.sourceIds.length || pendingUrls.value.length))

function confirm() {
  pendingUrls.value.forEach((url) => form.sourceIds.push(addSource(url).id))
  const task = addTask(JSON.parse(JSON.stringify(form)))
  updateCard(props.message.id, { state: 'confirmed', summary: `${task.name} · ${scheduleText(task.schedule)} · ${TASK_MODES[task.mode].label}` })
  const next = nextOccurrence(task.schedule.prepareAt, task.schedule.weekday)
  pushBot(`已创建「${task.name}」，第一次执行在 ${fmtDateTime(next)}。要不要先试写一篇看看效果？试写只存草稿。`)
  pushCard({
    type: 'quick',
    options: [
      { label: '试写一篇', text: '试写一篇', trialTaskId: task.id },
      { label: '先不用', text: '' },
    ],
  })
}

function cancel() {
  updateCard(props.message.id, { state: 'cancelled' })
  pushBot('好的，没有创建任务。')
}
</script>

<template>
  <div class="tc">
    <div class="tc-head">
      <strong>新建运营任务</strong>
      <span
        v-if="card.state === 'confirmed'"
        class="text-brand"
      >已创建</span>
      <span
        v-else-if="card.state === 'cancelled'"
        class="faint"
      >已取消</span>
    </div>

    <template v-if="card.state === 'open'">
      <p
        v-if="pendingUrls.length"
        class="tc-pending"
      >
        确认后新增资讯来源：{{ pendingUrls.join('、') }}
      </p>
      <TaskForm
        :form="form"
        compact
      />
      <div class="tc-actions">
        <button
          class="weui-btn weui-btn_mini weui-btn_default"
          @click="cancel"
        >
          取消
        </button>
        <button
          class="weui-btn weui-btn_mini weui-btn_primary"
          :class="{ 'weui-btn_disabled': !valid }"
          :disabled="!valid"
          @click="confirm"
        >
          确认创建
        </button>
      </div>
    </template>

    <p
      v-else-if="card.state === 'confirmed'"
      class="muted"
    >
      {{ card.summary }}
    </p>
  </div>
</template>

<style scoped>
.tc {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 560px;
  max-width: 100%;
}

.tc-head {
  display: flex;
  justify-content: space-between;
}

.tc-pending {
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--info-light);
  color: var(--info);
  font-size: 12px;
  word-break: break-all;
}

.tc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
