<!-- 单条聊天消息：用户气泡在右，助手气泡和卡片在左；卡片按 type 选择组件 -->
<script setup>
import { Bot } from 'lucide-vue-next'
import BotTrace from './BotTrace.vue'
import ChatAttachments from './ChatAttachments.vue'
import BotAnswer from './BotAnswer.vue'
import RunCard from './cards/RunCard.vue'
import TaskConfirmCard from './cards/TaskConfirmCard.vue'
import TaskCard from './cards/TaskCard.vue'
import ActionConfirmCard from './cards/ActionConfirmCard.vue'
import EditProposalCard from './cards/EditProposalCard.vue'
import CheckCard from './cards/CheckCard.vue'
import PublishCard from './cards/PublishCard.vue'
import QuickCard from './cards/QuickCard.vue'
import DesktopActionCard from './cards/DesktopActionCard.vue'

defineProps({
  message: { type: Object, required: true },
})

defineEmits(['send'])

const CARDS = {
  action: DesktopActionCard,
  run: RunCard,
  task_confirm: TaskConfirmCard,
  task: TaskCard,
  action_confirm: ActionConfirmCard,
  edit_proposal: EditProposalCard,
  check: CheckCard,
  publish: PublishCard,
  quick: QuickCard,
}
</script>

<template>
  <div
    class="msg"
    :class="message.role === 'user' ? 'is-user' : 'is-bot'"
  >
    <span
      v-if="message.role !== 'user'"
      class="msg-avatar"
    ><Bot class="icon-16" /></span>
    <div
      v-if="message.role === 'card'"
      class="msg-card"
      :class="{ plain: message.card.type === 'quick' }"
    >
      <component
        :is="CARDS[message.card.type]"
        :message="message"
        @send="$emit('send', $event)"
      />
    </div>
    <div v-else class="msg-body">
      <BotTrace v-if="message.role !== 'user'" :message="message" />
      <ChatAttachments v-if="message.role === 'user' && message.attachments?.length" :attachments="message.attachments" />
      <div v-if="message.role === 'user' && message.text" class="msg-bubble">{{ message.text }}</div>
      <BotAnswer v-else-if="message.text" :text="message.text" />
      <p v-if="message.error" class="message-error">{{ message.error }}</p>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.msg.is-user {
  justify-content: flex-end;
}

.msg-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 6px;
  color: #fff;
  background: var(--brand);
}

.msg-bubble {
  max-width: min(100%, 720px);
  padding: 5px 0;
  border-radius: 8px;
  background: transparent;
  font-size: 15px;
  line-height: 1.85;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-body {
  max-width: min(100%, 760px);
  min-width: 0;
  flex: 1;
}

.is-user .msg-body {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex: initial;
  max-width: 80%;
}

.message-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 13px;
}

.is-user .msg-bubble {
  max-width: 100%;
  padding: 10px 16px;
  background: #f0f3f1;
}

.msg-card {
  width: min(100%, 680px);
  min-width: 0;
  padding: 14px 16px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--border);
}

.msg-card.plain {
  padding: 0;
  border: 0;
  background: none;
}
</style>
