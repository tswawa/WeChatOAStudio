<!-- Drafts are keyed by account/session, and a failed send retains text and attachment references. -->
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Square, Paperclip, LoaderCircle } from 'lucide-vue-next'
import ChatQuickTasks from './ChatQuickTasks.vue'
import ChatAttachments from './ChatAttachments.vue'
import { composerDraft } from '../../assistant/composerDrafts.js'
import { session } from '../../store/session.js'
import { ws } from '../../store/workspace.js'
import { invokeAction } from '../../services/workspace.js'
import { isDesktop } from '../../services/desktop.js'
const props = defineProps({ busy: Boolean, disabled: Boolean, submit: Function })
const emit = defineEmits(['send', 'stop'])
const draft = computed(() => composerDraft(session.accountId + ':' + (ws.value.bot?.session?.id || 'new')))
const inputRef = ref(null), fileRef = ref(null), uploading = ref(false), sending = ref(false), error = ref(''), dragging = ref(false)
let submitted = null
function resize() { if (inputRef.value) { inputRef.value.style.height = 'auto'; inputRef.value.style.height = `${Math.min(220, Math.max(88, inputRef.value.scrollHeight))}px` } }
function choose(content) { draft.value.text = content; nextTick(() => { resize(); inputRef.value?.focus() }) }
function clearSubmitted() {
  if (!submitted) return
  if (submitted.draft.text === submitted.text) submitted.draft.text = ''
  submitted.draft.attachments = submitted.draft.attachments.filter(item => !submitted.ids.includes(item.id))
  nextTick(resize)
}
watch(() => ws.value.chatMessages?.filter(message => message.role === 'user').at(-1)?.id, () => {
  const last = ws.value.chatMessages?.filter(message => message.role === 'user').at(-1)
  if (submitted && last?.text === (submitted.text.trim() || '请查看附件。') && submitted.ids.every(id => last.attachments?.some(item => item.id === id))) clearSubmitted()
})
async function send() {
  const target = draft.value, value = target.text.trim()
  if ((!value && !target.attachments.length) || props.busy || props.disabled || sending.value || uploading.value) return
  error.value = ''; sending.value = true
  const payload = { text: value, attachmentIds: target.attachments.map(item => item.id) }
  submitted = { draft: target, text: target.text, ids: payload.attachmentIds }
  try {
    const accepted = props.submit ? await props.submit(isDesktop ? payload : value) : (emit('send', isDesktop ? payload : value), true)
    if (accepted !== false) clearSubmitted()
  } catch (cause) { error.value = cause.message }
  finally { sending.value = false; submitted = null }
}
async function files(list) {
  if (uploading.value || props.disabled || props.busy || !list.length) return
  const target = draft.value, accountId = session.accountId
  if (!isDesktop) { error.value = '文件附件需要桌面版'; return }
  uploading.value = true; error.value = ''
  try {
    for (const file of list) {
      if (file.size > 10 * 1024 * 1024) throw new Error('单个附件必须在 10MB 以内')
      const item = await invokeAction('chat.attachment.prepare', { name: file.name, mimeType: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] }, accountId)
      target.attachments.push(item)
    }
  } catch (cause) { error.value = cause.message }
  finally { uploading.value = false; if (fileRef.value) fileRef.value.value = '' }
}
function paste(event) { const list = [...(event.clipboardData?.files || [])]; if (list.length) { event.preventDefault(); void files(list) } }
function drop(event) { dragging.value = false; const list = [...(event.dataTransfer?.files || [])]; if (list.length) { event.preventDefault(); void files(list) } }
function onKeydown(event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send() } }
watch(() => draft.value, () => nextTick(resize))
</script>
<template>
  <div class="composer" :class="{ dragging }" @dragenter.prevent="dragging = true" @dragover.prevent @dragleave.self="dragging = false" @drop="drop">
    <input ref="fileRef" type="file" accept=".jpg,.jpeg,.png,.webp,.txt,.md,.markdown,.csv,.json,.log,.pdf,.docx" multiple hidden @change="files([...$event.target.files])">
    <ChatAttachments :attachments="draft.attachments" editable :disabled="uploading || sending" @remove="id => draft.attachments = draft.attachments.filter(item => item.id !== id)" />
    <textarea ref="inputRef" v-model="draft.text" class="chat-input" rows="3" aria-label="发消息给 Bot" placeholder="发消息给 Bot" @input="resize" @keydown="onKeydown" @paste="paste" />
    <p v-if="error" class="attachment-error" role="alert">{{ error }}</p>
    <div class="composer-tools">
      <div class="composer-left"><ChatQuickTasks @select="choose" /><button type="button" class="attach-button" title="添加文件或图片" aria-label="添加文件或图片" :disabled="disabled || busy || uploading || sending" @click="fileRef?.click()"><LoaderCircle v-if="uploading" :size="17" class="spinning" /><Paperclip v-else :size="17" /></button></div>
      <button class="send-button" :disabled="disabled || (!busy && (uploading || sending || (!draft.text.trim() && !draft.attachments.length)))" :aria-label="busy ? '停止生成' : '发送消息'" :title="busy ? '停止生成' : '发送消息'" @click="busy ? emit('stop') : send()"><Square v-if="busy" :size="16" fill="currentColor" /><ArrowUp v-else :size="22" /></button>
    </div>
  </div>
</template>
<style scoped>
.composer { width: 100%; padding: 16px 18px 12px; border: 1px solid #e7eaeb; border-radius: 18px; background: #f5f6f7; transition: border-color 150ms ease; }.composer:focus-within,.composer.dragging { border-color: #9bbfaf; }.chat-input { display: block; width: 100%; min-height: 88px; max-height: 220px; padding: 0 2px; border: 0; outline: 0; resize: none; background: transparent; color: var(--text-1); font: inherit; font-size: 16px; line-height: 1.7; }.chat-input::placeholder { color: #90999e; }.composer-tools,.composer-left { display: flex; align-items: center; gap: 10px; }.composer-tools { justify-content: space-between; margin-top: 12px; }.send-button { display: grid; place-items: center; width: 36px; height: 36px; flex: none; padding: 0; border: 0; border-radius: 50%; background: var(--brand); color: #fff; cursor: pointer; }.send-button:disabled { background: #d3d9d6; cursor: default; }.attach-button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 4px; color: var(--text-2); background: none; cursor: pointer; }.attach-button:hover { background: #e9edeb; }.attach-button:disabled { opacity: .5; cursor: default; }.attachment-error { margin-top: 6px; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }.spinning { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
</style>
