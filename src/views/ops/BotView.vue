<!-- One persistent Bot chat for general conversation and Official Account operations. -->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle, Settings } from 'lucide-vue-next'
import ChatMessage from './ChatMessage.vue'
import BotComposerArea from './BotComposerArea.vue'
import BotHeader from './BotHeader.vue'
import BotContextStatus from './BotContextStatus.vue'
import logoUrl from '../../assets/wechat-oa-copilot-logo.png'
import { chat, pushUser, clearChat, setBusy, sendMessage, setFocusDraft } from '../../assistant/chatStore.js'
import { handleInput } from '../../assistant/handlers.js'
import { db, ws, executeAction } from '../../store/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { invokeAction } from '../../services/workspace.js'
import { confirmAction } from '../../store/ui.js'

const router = useRouter()
const listRef = ref(null)
const sendError = ref('')
const resetting = ref(false)
const bot = computed(() => ws.value.bot || {})
const empty = computed(() => !chat.value.messages.length && !working.value)
const working = computed(() => chat.value.busy || bot.value.busy || resetting.value)
const scheduleRunning = computed(() => bot.value.running?.kind === 'schedule')
const elsewhereBusy = computed(() => scheduleRunning.value && !bot.value.busy)
const navigationLocked = computed(() => resetting.value || (!scheduleRunning.value && working.value))
const streaming = computed(() => chat.value.messages.some(message =>
  ['streaming', 'working', 'compacting'].includes(message.state)))
const showSendError = computed(() => sendError.value && chat.value.messages.at(-1)?.error !== sendError.value)
// 桌面版必须先填写模型名称和 API Key 才能对话；定时任务会话只读，回到对话后再发送
const needsModel = computed(() => isDesktop && ws.value.loaded && !(bot.value.model?.name
  && ws.value.settings?.model?.apiKeyConfigured))
const scheduleView = computed(() => bot.value.session?.kind === 'schedule')
const composerLocked = computed(() => needsModel.value || scheduleView.value)
const focusDraft = computed(() => chat.value.focusDraftId
  && (ws.value.drafts.find((item) => item.id === chat.value.focusDraftId) || { title: '已选草稿' }))

function scrollToEnd() {
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
  })
}

async function send(text) {
  if (working.value || elsewhereBusy.value || composerLocked.value) return false
  sendError.value = ''
  if (isDesktop) {
    try {
      await sendMessage(text)
      scrollToEnd()
      return true
    } catch (error) {
      sendError.value = error.message
      console.error('发送助手消息失败：', error)
      return false
    }
  }
  pushUser(text)
  setBusy(true)
  scrollToEnd()
  setTimeout(() => {
    handleInput(text)
    setBusy(false)
    scrollToEnd()
  }, 450)
  return true
}

async function newConversation() {
  if (navigationLocked.value) return
  resetting.value = true
  try {
    await clearChat()
    sendError.value = ''
  } finally {
    resetting.value = false
  }
}

async function sessionAction(action, payload) {
  if (navigationLocked.value) return
  resetting.value = true
  try {
    await executeAction(action, payload)
    chat.value.focusDraftId = null
    sendError.value = ''
  } catch (error) {
    sendError.value = error.message
  } finally {
    resetting.value = false
  }
}

async function deleteSession(item) {
  if (await confirmAction({ title: '删除会话', message: `删除「${item.title}」及其聊天记录？长期记忆保留。` })) {
    await sessionAction('chat.session.delete', { id: item.id })
  }
}

async function stop() {
  try {
    await invokeAction('chat.stop')
  } catch (error) {
    sendError.value = error.message
  }
}

onMounted(scrollToEnd)
watch(() => chat.value.messages.length, scrollToEnd)
watch(() => chat.value.messages.at(-1)?.text, scrollToEnd)
watch(() => bot.value.session?.id, scrollToEnd)
watch(() => db.runs.map((run) => run.steps.map((step) => step.state).join()).join(), scrollToEnd)
</script>

<template>
  <section class="assistant" :class="{ 'is-empty': empty }">
    <BotHeader
      :bot="bot"
      :busy="navigationLocked"
      @new="newConversation"
      @select="id => sessionAction('chat.session.select', { id })"
      @delete="deleteSession"
    />
    <div v-if="empty" class="welcome">
      <div class="welcome-title">
        <img :src="logoUrl" alt="" width="42" height="42">
        <h2>你好，我是{{ bot.profile?.name || '公众号 Bot' }}</h2>
      </div>
      <div v-if="needsModel" class="setup-card">
        <strong>先连接模型</strong>
        <span>填写模型名称和 API Key 后即可对话、写稿和处理公众号。</span>
        <button class="weui-btn weui-btn_mini weui-btn_primary" @click="router.push('/bot-settings')">
          <Settings :size="15" />去设置
        </button>
      </div>
      <div v-else>
        <BotComposerArea
          :read-only="scheduleView"
          :submit="send"
          :busy="working"
          :elsewhere-busy="elsewhereBusy"
          :navigating="resetting"
          :draft="focusDraft || null"
          @send="send"
          @stop="stop"
          @new="newConversation"
          @clear-draft="setFocusDraft(null)"
          @view-execution="sessionAction('chat.session.select', { id: bot.running.sessionId })"
        />
        <BotContextStatus :bot="bot" />
      </div>
      <p v-if="showSendError" class="send-error" role="alert">{{ sendError }}</p>
    </div>
    <template v-else>
      <div ref="listRef" class="chat-scroll" role="log" aria-label="Bot 对话">
        <div class="chat-messages">
          <ChatMessage
            v-for="message in chat.messages"
            :key="message.id"
            :message="message"
            @send="send"
          />
          <div v-if="working && !streaming" class="typing" role="status">
            <LoaderCircle :size="16" class="spinning" />正在连接…
          </div>
        </div>
      </div>
      <div class="composer-dock">
        <p v-if="showSendError" class="send-error" role="alert">{{ sendError }}</p>
        <BotComposerArea
          :read-only="scheduleView"
          :submit="send"
          :needs-model="needsModel"
          :busy="working"
          :elsewhere-busy="elsewhereBusy"
          :navigating="resetting"
          :draft="focusDraft || null"
          @send="send"
          @stop="stop"
          @new="newConversation"
          @clear-draft="setFocusDraft(null)"
          @view-execution="sessionAction('chat.session.select', { id: bot.running.sessionId })"
        />
        <BotContextStatus :bot="bot" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.assistant {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: #fff;
}

.welcome {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 28px;
  width: min(100%, 888px);
  min-height: 0;
  margin: 0 auto;
  padding: 0 24px 10vh;
}

.welcome-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.welcome-title img {
  flex: none;
}

.welcome-title h2 {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.4;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 28px;
  width: min(100%, 888px);
  margin: 0 auto;
  padding: 22px 24px 32px;
}

.composer-dock {
  flex: none;
  width: min(100%, 888px);
  margin: 0 auto;
  padding: 12px 24px 24px;
}

.typing {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 13px;
}

.spinning {
  animation: spin 1s linear infinite;
}

.setup-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 24px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafbfa;
  text-align: center;
}

.setup-card strong {
  font-size: 16px;
}

.setup-card span {
  color: var(--text-2);
  font-size: 13px;
}

.setup-card .weui-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: auto;
  margin: 4px 0 0;
}

.send-error {
  margin: 0 0 12px;
  color: var(--danger);
  font-size: 13px;
  overflow-wrap: anywhere;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@container workspace (max-width: 640px) {
  .welcome-title h2 { font-size: 22px; }
  .welcome-title { gap: 10px; }
  .chat-head { padding: 14px 20px; }
}
</style>
