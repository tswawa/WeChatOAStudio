<!-- 私信对话：头部“更多”（拉黑/删除聊天），双方消息与多媒体内容，单条消息下载、转存到素材库，滚到顶部加载更早消息；头部可收藏这个人（星标用户） -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MoreHorizontal, Star, FolderInput, Download } from 'lucide-vue-next'
import MessageMedia from './MessageMedia.vue'
import { executeAction } from '../../../store/workspace.js'
import { toast } from '../../../store/ui.js'
import { fmtDateTime } from '../../../utils/time.js'

const props = defineProps({ state: { type: Object, required: true } })
const state = props.state
const moreOpen = ref(false)
const more = ref(null)
const body = ref(null)
const target = computed(() => state.current.value)
const items = computed(() => state.thread.value?.items || state.active.value?.items || [])
// 收藏的是这个人（加入公众平台的星标用户），不是单条消息
const starred = computed(() => state.starredIds.value.has(target.value?.id))

// 切换会话或收到新消息时滚到底部；加载更早消息时保持当前阅读位置
let keepPosition = null
watch(() => [state.activeId.value, items.value.length], () => nextTick(() => {
  if (!body.value) return
  if (keepPosition !== null) body.value.scrollTop = body.value.scrollHeight - keepPosition
  else body.value.scrollTop = body.value.scrollHeight
  keepPosition = null
}), { immediate: true })

async function onScroll() {
  if (!body.value || body.value.scrollTop > 40 || !state.thread.value?.hasMore || state.loadingOlder.value) return
  keepPosition = body.value.scrollHeight - body.value.scrollTop
  await state.loadOlder()
}

watch(() => state.activeId.value, () => { moreOpen.value = false })

async function moreAction(action) {
  moreOpen.value = false
  try {
    if (action === 'block') {
      await executeAction('interaction.blockMessageUser', { id: target.value.id, blocked: !target.value.blacked })
      toast(target.value.blacked ? '已移出黑名单' : '已加入黑名单')
    } else {
      await executeAction('interaction.deleteConversation', { id: target.value.id })
      toast('已删除聊天')
    }
    await state.loadThread(target.value.id)
  } catch (error) {
    toast(error.message, 'warn')
  }
}

function outside(event) {
  if (!more.value?.contains(event.target)) moreOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div class="message-thread">
    <div class="head">
      <strong>{{ target.user || '公众号用户' }}</strong>
      <button
        class="star"
        :class="{ on: starred }"
        :disabled="state.starring.value"
        :title="starred ? '取消收藏' : '收藏这个人'"
        @click="state.setStar(target, !starred)"
      >
        <Star :size="13" :fill="starred ? 'currentColor' : 'none'" />{{ starred ? '已收藏' : '收藏' }}
      </button>
      <span v-if="target.blacked" class="faint">已加入黑名单</span>
      <div ref="more" class="more">
        <button class="icon" title="更多" aria-label="更多" @click="moreOpen = !moreOpen">
          <MoreHorizontal :size="18" />
        </button>
        <div v-if="moreOpen" class="menu">
          <button @click="moreAction('block')">{{ target.blacked ? '移出黑名单' : '加入黑名单' }}</button>
          <button class="danger" @click="moreAction('delete')">删除聊天</button>
        </div>
      </div>
    </div>
    <div ref="body" class="body" @scroll="onScroll">
      <p v-if="state.thread.value?.hasMore" class="faint note">
        {{ state.loadingOlder.value ? '正在加载更早的消息…' : '向上滚动加载更早的消息' }}
      </p>
      <p v-else class="faint note">仅保存最近 30 天的私信</p>
      <template v-for="(message, index) in items" :key="message.id">
        <p
          v-if="index === 0 || message.at - items[index - 1].at > 5 * 60 * 1000"
          class="faint time"
        >{{ fmtDateTime(message.at) }}</p>
        <div class="row" :class="{ mine: message.mine }">
          <div class="bubble" :class="['kind-' + message.kind, { mine: message.mine }]">
            <template v-if="message.kind === 'text'">{{ message.content }}</template>
            <MessageMedia v-else :message="message" />
          </div>
          <div v-if="!message.mine && !message.expired && (message.canDownload || message.canSave)" class="actions">
            <button
              v-if="message.canDownload && !message.expired"
              class="action"
              title="下载"
              @click="state.downloadMessage(message)"
            ><Download :size="13" /></button>
            <button
              v-if="message.canSave && !message.expired"
              class="action"
              title="转存到素材库"
              @click="state.saveMedia(message)"
            ><FolderInput :size="13" /></button>
          </div>
        </div>
      </template>
      <p v-if="state.loadingThread.value && !items.length" class="faint time">正在读取对话…</p>
    </div>
  </div>
</template>

<style scoped>
.message-thread {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-light);
  font-size: 14px;
}

.star {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: none;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.star.on {
  border-color: var(--warning);
  color: var(--warning);
}

.star:disabled {
  opacity: 0.6;
  cursor: default;
}

.more {
  position: relative;
  margin-left: auto;
}

.icon {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-2);
  cursor: pointer;
}

.icon:hover {
  background: var(--bg-hover);
}

.menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.menu button {
  padding: 8px 10px;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.menu button:hover {
  background: var(--bg-hover);
}

.menu .danger {
  color: var(--danger);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
  background: #f5f5f5;
}

.note,
.time {
  text-align: center;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row.mine {
  justify-content: flex-end;
}

.bubble {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bubble.mine {
  background: var(--bubble-user);
}

.bubble:not(.kind-text) {
  color: var(--text-2);
}

.actions {
  display: flex;
  gap: 2px;
}

.action {
  display: inline-flex;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--text-3);
  cursor: pointer;
}

.action:hover {
  color: var(--text-1);
}
</style>
