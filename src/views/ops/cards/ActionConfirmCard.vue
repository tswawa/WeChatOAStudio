<!-- 操作确认卡：暂停、恢复、删除任务，先说明影响，用户点确认才执行 -->
<script setup>
import { computed } from 'vue'
import { updateTask, removeTask } from '../../../store/workspace.js'
import { updateCard, pushBot } from '../../../assistant/chatStore.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const card = computed(() => props.message.card)

const ACTIONS = {
  pause: { label: '暂停', run: (taskId) => updateTask(taskId, { enabled: false }), done: '已暂停。' },
  resume: { label: '恢复', run: (taskId) => updateTask(taskId, { enabled: true }), done: '已恢复，会按时间继续执行。' },
  delete: { label: '删除', run: (taskId) => removeTask(taskId), done: '已删除。' },
}

function confirm() {
  const action = ACTIONS[card.value.action]
  action.run(card.value.taskId)
  updateCard(props.message.id, { state: 'confirmed' })
  pushBot(action.done)
}

function cancel() {
  updateCard(props.message.id, { state: 'cancelled' })
}
</script>

<template>
  <div class="ac">
    <p>{{ card.text }}</p>
    <div
      v-if="card.state === 'open'"
      class="ac-actions"
    >
      <button
        class="weui-btn weui-btn_xmini weui-btn_default"
        @click="cancel"
      >
        取消
      </button>
      <button
        class="weui-btn weui-btn_xmini weui-btn_primary"
        @click="confirm"
      >
        确认{{ ACTIONS[card.action].label }}
      </button>
    </div>
    <p
      v-else
      class="faint"
    >
      {{ card.state === 'confirmed' ? '已确认' : '已取消' }}
    </p>
  </div>
</template>

<style scoped>
.ac {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 420px;
}

.ac-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
