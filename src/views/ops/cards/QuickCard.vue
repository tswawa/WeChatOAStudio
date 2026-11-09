<!-- 快捷回复卡：一组按钮。带 trialTaskId 的按钮直接对该任务试写；否则把文本作为用户消息发送；文本为空只关闭卡片 -->
<script setup>
import { computed } from 'vue'
import { updateCard, pushUser, pushBot } from '../../../assistant/chatStore.js'
import { runInChat } from '../../../assistant/runner.js'
import { db } from '../../../store/workspace.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const emit = defineEmits(['send'])
const card = computed(() => props.message.card)

function pick(option) {
  updateCard(props.message.id, { state: 'confirmed', chosen: option.label })
  if (option.trialTaskId) {
    const task = db.tasks.find((item) => item.id === option.trialTaskId)
    pushUser(option.text)
    if (task) runInChat(task, { trial: true })
    else pushBot('这个任务已经删除了。')
    return
  }
  if (option.text) emit('send', option.text)
}
</script>

<template>
  <div class="qc">
    <button
      v-for="option in card.options"
      :key="option.label"
      class="weui-btn weui-btn_xmini"
      :class="card.chosen === option.label ? 'weui-btn_primary' : 'weui-btn_default'"
      :disabled="card.state !== 'open'"
      @click="pick(option)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.qc {
  display: flex;
  gap: 8px;
}
</style>
