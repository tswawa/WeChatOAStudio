<!-- 私信页：近期私信/已收藏私信（收藏的人）与私信设置，左侧会话或收藏的人，右侧完整对话和输入区 -->
<script setup>
import { onBeforeUnmount } from 'vue'
import { ws, executeAction } from '../../store/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { toast } from '../../store/ui.js'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
import { useMessages } from './messages/useMessages.js'
import MessageList from './messages/MessageList.vue'
import MessageThread from './messages/MessageThread.vue'
import MessageComposer from './messages/MessageComposer.vue'
import MessageSettings from './messages/MessageSettings.vue'

const state = useMessages()
onBeforeUnmount(state.stopSearch)

async function open(item) {
  state.activeId.value = item.id
  if (!item.unread) return
  if (!isDesktop) {
    item.unread = false
    return
  }
  try {
    await executeAction('interaction.readMessage', { id: item.id })
    item.unread = false
  } catch (error) {
    toast(error.message, 'warn')
  }
}

// 搜索结果：回到近期私信并打开这条消息所属用户的会话
function openResult(result) {
  state.view.value = 'recent'
  state.keyword.value = ''
  state.results.value = null
  const known = [...state.conversations.value, ...ws.value.messages].some((item) => item.id === result.userId)
  if (known) state.activeId.value = result.userId
  else toast('该用户的会话不在近期私信中', 'warn')
}
</script>

<template>
  <div class="page messages-page">
    <div class="page-head">
      <div class="heading">
        <h1 class="page-title">私信</h1>
        <div class="views">
          <button :class="{ on: state.view.value === 'recent' }" @click="state.view.value = 'recent'">近期私信</button>
          <button :class="{ on: state.view.value === 'star' }" @click="state.showStarred">已收藏私信</button>
        </div>
      </div>
      <MessageSettings
        :settings="state.settings.value"
        :call="state.call"
        @update="state.settings.value = $event"
      />
    </div>

    <div class="card inbox">
      <MessageList :state="state" @open="open" @open-result="openResult" />
      <section v-if="state.active.value" class="thread">
        <MessageThread :state="state" />
        <MessageComposer :state="state" />
      </section>
      <WorkspaceEmptyState
        v-else-if="state.view.value === 'recent' && ws.messages.length"
        text="选择一个会话"
        fill
      />
    </div>
  </div>
</template>

<style scoped>
.messages-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.heading {
  display: flex;
  align-items: center;
  gap: 24px;
}

.views {
  display: flex;
  gap: 18px;
}

.views button {
  padding: 4px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}

.views button.on {
  color: var(--brand);
  border-bottom-color: var(--brand);
}

.inbox {
  display: flex;
  flex: 1;
  min-height: 420px;
  padding: 0;
  overflow: hidden;
}

.thread {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
