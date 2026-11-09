<!-- 文章模板编辑页：像 Word 一样排一篇范文（段落样式、字号、颜色、行距、缩进等），右侧手机预览；
     左侧填写模板名称、适用场景、结构要求，可设为默认模板。Bot 写稿时照着范文的结构和格式写 -->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ChevronLeft, Star, Trash2 } from 'lucide-vue-next'
import FormatToolbar from './FormatToolbar.vue'
import TemplateImageTools from './TemplateImageTools.vue'
import { useRichText } from './useRichText.js'
import { ws, executeAction } from '../../store/workspace.js'
import { toast, confirmAction } from '../../store/ui.js'
import { cleanArticleHtml } from '../../services/articleHtml.js'

// 新模板的起始范文：给出常见的公众号结构，直接在上面改
const STARTER = [
  '<h2 style="font-size:20px;color:#07c160;text-align:center">在这里写小标题</h2>',
  '<p style="font-size:15px;line-height:2;text-indent:2em;margin-bottom:20px">这是正文段落。'
    + '选中文字后用上方工具栏设置字号、颜色、加粗、行距和首行缩进，Bot 写的文章会照这个样子排版。</p>',
  '<blockquote style="margin:16px 0;padding:12px 16px;background:#f4f7f6;border-left:3px solid #07c160;color:#666">'
    + '<p>这是引用，适合放金句或重点。</p></blockquote>',
  '<h3 style="font-size:17px;color:#333">这是三级标题</h3>',
  '<p style="font-size:15px;line-height:2;text-indent:2em;margin-bottom:20px">'
    + '<strong>加粗的文字</strong>会被当作重点样式，结尾可以留一句互动提问。</p>',
].join('')

const route = useRoute()
const router = useRouter()
const bodyRef = ref(null)
const busy = ref(false)
const imageBusy = ref(false)
const imageTools = ref(null)
const html = ref('')
const form = ref(blank())
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form.value, html: html.value })
const dirty = computed(() => saved.value !== '' && snapshot() !== saved.value)
const isNew = computed(() => !route.params.id)

function blank() {
  return { id: '', name: '', description: '', structure: '', isDefault: false }
}

function onInput() {
  if (bodyRef.value) html.value = cleanArticleHtml(bodyRef.value.innerHTML)
}
const rich = useRichText(bodyRef, onInput)

async function load() {
  const id = String(route.params.id || '')
  const template = id ? (ws.value.templates || []).find((item) => item.id === id) : null
  if (id && !template) {
    toast('模板不存在或已删除', 'warn')
    router.replace('/templates')
    return
  }
  form.value = template
    ? { id: template.id, name: template.name, description: template.description || '',
      structure: template.structure || '', isDefault: Boolean(template.isDefault) }
    : blank()
  html.value = cleanArticleHtml(template?.html || STARTER)
  await nextTick()
  if (bodyRef.value) bodyRef.value.innerHTML = html.value
  imageTools.value?.select(null)
  saved.value = snapshot()
}

async function save() {
  if (busy.value || imageBusy.value) return
  onInput()
  if (!form.value.name.trim()) return toast('请填写模板名称', 'warn')
  busy.value = true
  try {
    const result = await executeAction('template.save', { ...form.value, id: form.value.id || undefined,
      html: html.value })
    form.value.id = result.id
    if (result.html) {
      html.value = cleanArticleHtml(result.html)
      if (bodyRef.value) bodyRef.value.innerHTML = html.value
      imageTools.value?.select(null)
    }
    saved.value = snapshot()
    toast('模板已保存')
    if (isNew.value) router.replace(`/template-editor/${result.id}`)
  } catch (error) {
    toast(error.message, 'warn')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!form.value.id) return
  if (!await confirmAction({ title: '删除模板', message: `删除模板「${form.value.name}」？删除后无法恢复。` })) return
  try {
    await executeAction('template.delete', { id: form.value.id })
    saved.value = snapshot()
    toast('已删除')
    router.replace('/templates')
  } catch (error) {
    toast(error.message, 'warn')
  }
}

onMounted(load)
watch(() => route.params.id, (id, old) => { if (id !== form.value.id || !old) load() })
onBeforeRouteLeave(async () => !imageBusy.value && (!dirty.value || await confirmAction({
  title: '放弃未保存的修改？', message: '模板有修改尚未保存。', confirmText: '放弃修改',
})))
</script>

<template>
  <div class="tpl-editor">
    <header class="ed-head">
      <a class="back" @click="router.push('/templates')"><ChevronLeft class="icon-16" />文章模板</a>
      <input v-model="form.name" class="name" placeholder="模板名称，例如：科技观点短文">
      <span v-if="dirty" class="faint dirty">有未保存的修改</span>
    </header>
    <FormatToolbar :rich="rich" :disabled="busy || imageBusy">
      <template #insert><TemplateImageTools ref="imageTools" :rich="rich" :disabled="busy" @change="onInput" @busy="imageBusy = $event" /></template>
    </FormatToolbar>

    <div class="ed-body">
      <aside class="side">
        <label class="field">
          <span>适用场景</span>
          <input v-model="form.description" placeholder="例如：每周的科技热点解读">
        </label>
        <label class="field">
          <span>结构要求</span>
          <textarea
            v-model="form.structure"
            rows="8"
            placeholder="例如：开头一个生活场景；正文三个小标题；结尾一句互动提问。不填就按范文的结构写。"
          />
        </label>
        <label class="check">
          <input v-model="form.isDefault" type="checkbox">
          <Star :size="14" />设为默认模板（没点名模板时 Bot 用它）
        </label>
        <p class="faint tip">
          右侧这篇范文就是模板：小标题、正文、引用、加粗的字号、颜色、行距和缩进都会照搬到 Bot 写的文章里；
          语气和写法也会参考它，但内容会重新写。
        </p>
      </aside>

      <main class="ed-main">
        <div class="paper">
          <div
            ref="bodyRef"
            class="ed-content"
            :contenteditable="!busy && !imageBusy"
            data-placeholder="在这里排一篇范文"
            @input="onInput"
            @mouseup="rich.onMouseUp"
            @click="imageTools?.select($event.target)"
            @paste="imageTools?.paste($event)"
            @drop="imageTools?.drop($event)"
            @dragover.prevent
          />
        </div>
      </main>

      <aside class="preview">
        <p class="faint preview-title">手机预览</p>
        <div class="phone">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="article" v-html="html || '<p style=&quot;color:#bbb&quot;>范文为空</p>'" />
        </div>
      </aside>
    </div>

    <footer class="ed-foot">
      <button v-if="form.id" class="delete" @click="remove"><Trash2 :size="14" />删除模板</button>
      <span v-else />
      <div class="row-actions">
        <button class="weui-btn weui-btn_mini weui-btn_default" @click="router.push('/templates')">返回</button>
        <button class="weui-btn weui-btn_mini weui-btn_primary" :disabled="busy || imageBusy || (!dirty && !isNew)" @click="save">
          {{ busy ? '正在保存…' : '保存模板' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.tpl-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-page);
}

.ed-head {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: #fff;
  flex: none;
}

.back {
  display: inline-flex;
  align-items: center;
  color: var(--text-2);
  white-space: nowrap;
}

.name {
  flex: 1;
  max-width: 420px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
}

.name:hover,
.name:focus {
  border-color: var(--border);
  outline: 0;
}

.dirty {
  font-size: 12px;
}

.ed-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 260px;
  flex: none;
  padding: 20px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: #fff;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
}

.field input,
.field textarea {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
  resize: vertical;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.check svg {
  color: var(--warning);
}

.tip {
  font-size: 12px;
  line-height: 1.7;
}

.ed-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px;
}

.paper {
  max-width: 720px;
  min-height: 100%;
  margin: 0 auto;
  padding: 40px 56px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.ed-content {
  min-height: 480px;
  outline: 0;
  font-size: 16px;
  line-height: 1.8;
  color: #333;
  word-break: break-word;
}

.ed-content:empty::before {
  content: attr(data-placeholder);
  color: var(--text-3);
}

.ed-content :deep(img), .article :deep(img) { max-width: 100%; height: auto; }

.ed-content :deep(p) {
  margin: 0 0 16px;
}

.preview {
  display: flex;
  flex-direction: column;
  width: 360px;
  flex: none;
  padding: 16px;
  border-left: 1px solid var(--border);
  background: #fff;
}

.preview-title {
  margin-bottom: 8px;
  font-size: 12px;
}

.phone {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
  border: 6px solid #1f1f1f;
  border-radius: 24px;
}

.article {
  font-size: 16px;
  line-height: 1.8;
  color: #333;
  word-break: break-word;
}

.article :deep(p) {
  margin: 0 0 16px;
}

.ed-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 24px;
  border-top: 1px solid var(--border);
  background: #fff;
  flex: none;
}

.row-actions {
  display: flex;
  gap: 8px;
}

.delete {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: var(--danger);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
</style>
