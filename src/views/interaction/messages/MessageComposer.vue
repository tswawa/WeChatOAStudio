<!-- 私信输入区：文字/图片/图文/音频/视频，表情、字数计数；Enter 发送，Shift+Enter 换行 -->
<script setup>
import { computed, nextTick, ref } from 'vue'
import { Smile, Type, Image as ImageIcon, FileText, Music, Video } from 'lucide-vue-next'
import { executeAction } from '../../../store/workspace.js'
import { isDesktop } from '../../../services/desktop.js'
import { toast } from '../../../store/ui.js'

const props = defineProps({ state: { type: Object, required: true } })
const state = props.state
const text = ref('')
const sending = ref(false)
const tab = ref('text')
const media = ref({ kind: '', items: [], loading: false, selected: null })
const emojiOpen = ref(false)
const input = ref(null)

const EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😭', '😡',
  '👍', '👏', '🙏', '💪', '🎉', '❤️', '🌹', '☕', '🔥', '✨', '👌', '🤝']
const TABS = [
  { key: 'text', label: '文字', icon: Type },
  { key: 'image', label: '图片', icon: ImageIcon },
  { key: 'appmsg', label: '图文', icon: FileText },
  { key: 'voice', label: '音频', icon: Music },
  { key: 'video', label: '视频', icon: Video },
]
const target = computed(() => state.current.value)
const blocked = computed(() => target.value?.canReply === false || target.value?.blacked)
const length = computed(() => text.value.replace(/\n/g, '').length)
const tabLabel = computed(() => TABS.find((item) => item.key === tab.value).label)
const canSend = computed(() => !sending.value
  && (tab.value === 'text' ? text.value.trim() && length.value <= 600 : Boolean(media.value.selected)))

async function chooseTab(key) {
  tab.value = key
  emojiOpen.value = false
  if (key === 'text') return
  media.value = { kind: key, items: [], loading: true, selected: null }
  const list = await state.call('interaction.messageMedia', { kind: key }, [])
  if (media.value.kind === key) media.value = { kind: key, items: list, loading: false, selected: null }
}

function insertEmoji(emoji) {
  const element = input.value
  const start = element?.selectionStart ?? text.value.length
  const end = element?.selectionEnd ?? text.value.length
  text.value = text.value.slice(0, start) + emoji + text.value.slice(end)
  emojiOpen.value = false
  nextTick(() => {
    element?.focus()
    element?.setSelectionRange(start + emoji.length, start + emoji.length)
  })
}

async function send() {
  if (!canSend.value) return
  const targetId = state.activeId.value
  const payload = tab.value === 'text'
    ? { kind: 'message', id: targetId, text: text.value.trim() }
    : { kind: 'message', id: targetId, media: { kind: tab.value, id: media.value.selected.id } }
  if (!isDesktop) {
    text.value = ''
    return
  }
  sending.value = true
  try {
    await executeAction('interaction.reply', payload)
    text.value = ''
    media.value.selected = null
    tab.value = 'text'
    toast('已发送')
    await state.loadThread(targetId)
  } catch (error) {
    toast(error.message, 'warn')
    console.error('回复私信失败：', error)
  } finally {
    sending.value = false
  }
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="message-composer">
    <p v-if="blocked" class="warning">
      {{ target.blacked ? '该用户在黑名单中，微信可能拒绝发送。' : '微信显示已超过可回复时间或次数，发送可能会被拒绝。' }}
    </p>
    <div class="tools">
      <button
        v-for="item in TABS"
        :key="item.key"
        :class="{ on: tab === item.key }"
        @click="chooseTab(item.key)"
      ><component :is="item.icon" :size="14" />{{ item.label }}</button>
    </div>
    <div v-if="tab === 'text'" class="text-input">
      <textarea
        ref="input"
        v-model="text"
        rows="3"
        maxlength="600"
        placeholder="按 Enter 发送，按 Shift + Enter 换行"
        @keydown="onKeydown"
      />
      <div v-if="emojiOpen" class="emoji-panel">
        <button v-for="emoji in EMOJIS" :key="emoji" @click="insertEmoji(emoji)">{{ emoji }}</button>
      </div>
    </div>
    <div v-else class="media-panel">
      <p v-if="media.loading" class="faint">正在读取素材…</p>
      <p v-else-if="!media.items.length" class="faint">素材库中还没有可发送的{{ tabLabel }}</p>
      <div v-else class="media-grid">
        <button
          v-for="item in media.items"
          :key="item.id"
          class="media-item"
          :class="{ on: media.selected?.id === item.id }"
          @click="media.selected = item"
        >
          <img v-if="item.cover" :src="item.cover" alt="" referrerpolicy="no-referrer">
          <span>{{ item.name || '未命名' }}</span>
          <small v-if="item.detail" class="faint">{{ item.detail }}</small>
        </button>
      </div>
    </div>
    <div class="send-row">
      <button
        v-if="tab === 'text'"
        class="icon"
        title="表情"
        aria-label="表情"
        @click="emojiOpen = !emojiOpen"
      ><Smile :size="18" /></button>
      <span v-if="tab === 'text'" class="faint counter" :class="{ over: length > 600 }">{{ length }}/600</span>
      <span v-else class="faint counter">{{ media.selected ? '已选：' + (media.selected.name || '素材') : '选择一项后发送' }}</span>
      <button class="weui-btn weui-btn_mini weui-btn_primary" :disabled="!canSend" @click="send">
        {{ sending ? '正在发送…' : '发送' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-composer {
  border-top: 1px solid var(--border-light);
}

.warning {
  margin: 0;
  padding: 8px 20px;
  background: var(--warning-light);
  color: var(--text-2);
  font-size: 13px;
}

.tools {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}

.tools button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.tools button.on {
  color: var(--brand);
  background: var(--brand-light);
}

.text-input {
  position: relative;
}

.text-input textarea {
  width: 100%;
  padding: 10px 16px;
  border: 0;
  outline: 0;
  resize: none;
  font: inherit;
}

.emoji-panel {
  position: absolute;
  bottom: 100%;
  left: 12px;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(8, 32px);
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.emoji-panel button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: none;
  font-size: 18px;
  cursor: pointer;
}

.emoji-panel button:hover {
  background: var(--bg-hover);
}

.media-panel {
  max-height: 180px;
  padding: 10px 16px;
  overflow-y: auto;
  font-size: 13px;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.media-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.media-item.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand);
}

.media-item img {
  width: 100%;
  height: 64px;
  border-radius: 4px;
  object-fit: cover;
}

.media-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 12px;
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

.counter {
  flex: 1;
  font-size: 12px;
}

.counter.over {
  color: var(--danger);
}

.send-row .weui-btn {
  width: auto;
  margin: 0;
}
</style>
