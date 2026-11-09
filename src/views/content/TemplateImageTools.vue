<!-- Template image files stay local; editing an example never writes to the WeChat account. -->
<script setup>
import { ref, shallowRef } from 'vue'
import { ImagePlus, Trash2, TextAlignStart, TextAlignCenter, TextAlignEnd } from 'lucide-vue-next'
import { invokeAction } from '../../services/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { toast } from '../../store/ui.js'

const props = defineProps({ rich: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['change', 'busy'])
const input = ref(null)
const active = shallowRef(null)
const loading = ref(false)
const description = ref('')
const width = ref(100)
const alignments = [{ value: 'left', icon: TextAlignStart, label: '图片左对齐' },
  { value: 'center', icon: TextAlignCenter, label: '图片居中' }, { value: 'right', icon: TextAlignEnd, label: '图片右对齐' }]

function select(image) {
  active.value = image?.tagName === 'IMG' ? image : null
  if (active.value) {
    description.value = image.alt || ''
    width.value = image.style.width.endsWith('%') ? parseFloat(image.style.width) : 100
  }
}
function update() {
  if (!active.value?.isConnected) return select(null)
  active.value.alt = description.value.slice(0, 200)
  active.value.style.width = `${Math.max(10, Math.min(100, Number(width.value) || 100))}%`
  active.value.style.height = 'auto'
  emit('change')
}
function align(value) {
  if (!active.value?.isConnected) return select(null)
  active.value.style.display = 'block'
  active.value.style.marginLeft = value === 'left' ? '0' : 'auto'
  active.value.style.marginRight = value === 'right' ? '0' : 'auto'
  emit('change')
}
function remove() {
  active.value?.remove()
  select(null)
  emit('change')
}
async function loadFiles(files) {
  if (loading.value || props.disabled || !files.length) return
  loading.value = true
  emit('busy', true)
  try {
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('请选择 8MB 以内的 JPG、PNG 或 WebP 图片')
      let image
      if (isDesktop) image = await invokeAction('template.image.prepare', {
        bytes: [...new Uint8Array(await file.arrayBuffer())], mimeType: file.type, name: file.name,
      })
      else {
        const src = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('无法读取图片'))
          reader.readAsDataURL(file)
        })
        image = { src, alt: file.name.replace(/\.[^.]+$/, '') }
      }
      select(props.rich.insertImage(image))
    }
  } catch (error) { toast(error.message, 'warn') }
  finally { loading.value = false; emit('busy', false); if (input.value) input.value.value = '' }
}
function choose() { props.rich.remember(); input.value?.click() }
function paste(event) {
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'))
  if (files.length) { event.preventDefault(); props.rich.remember(); void loadFiles(files) }
}
function drop(event) {
  const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (range && event.currentTarget.contains(range.startContainer)) {
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    props.rich.remember()
  }
  void loadFiles(files)
}
defineExpose({ select, paste, drop })
</script>

<template>
  <div class="template-image-tools" :aria-busy="loading">
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="loadFiles([...$event.target.files])">
    <button type="button" class="image-tool" title="插入模板图片" aria-label="插入模板图片" :disabled="disabled || loading" @mousedown.prevent @click="choose"><ImagePlus :size="16" /></button>
    <template v-if="active?.isConnected">
      <label>图片说明<input v-model="description" aria-label="模板图片说明" maxlength="200" :disabled="disabled || loading" @input="update"></label>
      <label>宽度<input v-model.number="width" aria-label="模板图片宽度" type="number" min="10" max="100" step="5" :disabled="disabled || loading" @input="update">%</label>
      <button v-for="alignment in alignments" :key="alignment.value" type="button" class="image-tool" :title="alignment.label" :aria-label="alignment.label" :disabled="disabled || loading" @mousedown.prevent @click="align(alignment.value)"><component :is="alignment.icon" :size="16" /></button>
      <button type="button" class="image-tool" title="移除模板图片" aria-label="移除模板图片" :disabled="disabled || loading" @mousedown.prevent @click="remove"><Trash2 :size="16" /></button>
    </template>
  </div>
</template>

<style scoped>
.template-image-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.image-tool { display: grid; place-items: center; flex: none; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--text-1); cursor: pointer; }
.image-tool:hover { background: var(--bg-hover); }
.image-tool:disabled { opacity: 0.5; cursor: default; }
label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-2); }
label input { width: 160px; min-width: 0; height: 30px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; font: inherit; color: var(--text-1); }
label input[type=number] { width: 62px; }
</style>
