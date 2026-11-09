<script setup>
import { ref } from 'vue'
import { FileText, Download, X } from 'lucide-vue-next'
import DeskDialog from '../../components/DeskDialog.vue'
import { invokeAction } from '../../services/workspace.js'
import { toast } from '../../store/ui.js'
defineProps({ attachments: { type: Array, default: () => [] }, editable: Boolean, disabled: Boolean })
defineEmits(['remove'])
const preview = ref(null)
function size(bytes) { return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.ceil(bytes / 1024)) + ' KB' }
async function download(item) { try { await invokeAction('chat.attachment.save', { id: item.id }) } catch (error) { toast(error.message, 'warn') } }
</script>
<template>
  <ul v-if="attachments.length" class="chat-attachments" aria-label="消息附件">
    <li v-for="item in attachments" :key="item.id" class="attachment" :class="{ 'is-image': item.kind === 'image' }">
      <button v-if="item.kind === 'image'" class="image-preview" type="button" :title="'预览 ' + item.name" :aria-label="'预览 ' + item.name" @click="preview = item"><img :src="item.previewUrl" :alt="item.name"></button>
      <FileText v-else :size="24" class="file-icon" />
      <div class="attachment-copy"><strong :title="item.name">{{ item.name }}</strong><span>{{ size(item.bytes) }}<template v-if="item.kind === 'document'"> · {{ item.characters }} 字<template v-if="item.truncated"> · 部分提取</template></template></span></div>
      <button v-if="editable" type="button" class="attachment-action" :title="'移除 ' + item.name" :aria-label="'移除 ' + item.name" :disabled="disabled" @click="$emit('remove', item.id)"><X :size="14" /></button>
      <button v-else type="button" class="attachment-action" :title="'保存 ' + item.name" :aria-label="'保存 ' + item.name" @click="download(item)"><Download :size="14" /></button>
    </li>
  </ul>
  <DeskDialog v-if="preview" :title="preview.name" :width="840" @close="preview = null"><img class="full-image" :src="preview.previewUrl" :alt="preview.name"></DeskDialog>
</template>
<style scoped>
.chat-attachments { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px,100%),1fr)); gap: 8px; width: min(100%, 720px); margin: 8px 0; padding: 0; list-style: none; text-align: left; }.attachment { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }.image-preview { display: grid; place-items: center; flex: none; width: 64px; height: 52px; padding: 0; border: 0; background: var(--bg-page); border-radius: 4px; overflow: hidden; cursor: pointer; }.image-preview img { width: 100%; height: 100%; object-fit: contain; }.file-icon { flex: none; color: var(--link); }.attachment-copy { flex: 1; min-width: 0; display: grid; gap: 5px; }.attachment-copy strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }.attachment-copy span { color: var(--text-3); font-size: 11px; }.attachment-action { display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; color: var(--text-2); background: none; cursor: pointer; }.attachment-action:hover { background: var(--bg-hover); }.full-image { display: block; max-width: 100%; max-height: 70vh; margin: auto; object-fit: contain; }
</style>
