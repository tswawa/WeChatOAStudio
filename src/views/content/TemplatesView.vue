<!-- 文章模板：卡片网格，每张卡片是模板范文的缩略预览；点卡片进入像 Word 一样的模板编辑页 -->
<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Star, Pencil, Trash2 } from 'lucide-vue-next'
import { ws, executeAction } from '../../store/workspace.js'
import { toast, confirmAction } from '../../store/ui.js'
import { cleanArticleHtml } from '../../services/articleHtml.js'

const router = useRouter()
const templates = computed(() => [...(ws.value.templates || [])]
  .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt - a.updatedAt))

function edit(template) {
  router.push(template ? `/template-editor/${template.id}` : '/template-editor')
}

async function makeDefault(template) {
  try {
    await executeAction('template.save', { ...template, isDefault: !template.isDefault })
    toast(template.isDefault ? '已取消默认' : `已把「${template.name}」设为默认模板`)
  } catch (error) {
    toast(error.message, 'warn')
  }
}

async function remove(template) {
  if (!await confirmAction({ title: '删除模板', message: `删除模板「${template.name}」？删除后无法恢复。` })) return
  try {
    await executeAction('template.delete', { id: template.id })
    toast('已删除')
  } catch (error) {
    toast(error.message, 'warn')
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">文章模板</h1>
        <p class="page-desc">把一篇排好版的范文存成模板。对 Bot 说“用「模板名」写一篇……”，它会照着范文的结构和格式写。</p>
      </div>
      <button class="weui-btn weui-btn_mini weui-btn_primary head-btn" @click="edit(null)">
        <Plus class="icon-16" />新建模板
      </button>
    </div>

    <div class="card">
      <div class="grid">
        <article v-for="template in templates" :key="template.id" class="item" @click="edit(template)">
          <div class="thumb">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="thumb-article" v-html="cleanArticleHtml(template.html)" />
            <span v-if="template.isDefault" class="default"><Star :size="12" fill="currentColor" />默认</span>
          </div>
          <div class="meta">
            <div class="name-row">
              <strong class="name" :title="template.name">{{ template.name }}</strong>
              <div class="actions" @click.stop>
                <button :title="template.isDefault ? '取消默认' : '设为默认'" @click="makeDefault(template)">
                  <Star :size="15" :fill="template.isDefault ? 'currentColor' : 'none'" />
                </button>
                <button title="编辑" @click="edit(template)"><Pencil :size="15" /></button>
                <button class="danger" title="删除" @click="remove(template)"><Trash2 :size="15" /></button>
              </div>
            </div>
            <p class="faint desc">{{ template.description || '未填写适用场景' }}</p>
          </div>
        </article>

        <button class="item add" @click="edit(null)">
          <Plus :size="28" />
          <span>新建模板</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.page-desc {
  margin-top: 4px;
  color: var(--text-2);
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 24px;
}

.item {
  min-width: 0;
  cursor: pointer;
}

.thumb {
  position: relative;
  height: 280px;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: #fff;
  transition: box-shadow 160ms ease, border-color 160ms ease;
}

.item:hover .thumb {
  border-color: var(--border);
  box-shadow: var(--shadow-pop);
}

/* 按 375px 手机宽度排版，再缩小显示，缩略图和读者看到的一致 */
.thumb-article {
  width: 375px;
  padding: 20px 16px;
  transform: scale(0.6);
  transform-origin: top left;
  pointer-events: none;
  font-size: 16px;
  line-height: 1.8;
  color: #333;
  word-break: break-word;
}

.thumb-article :deep(p) {
  margin: 0 0 16px;
}

.thumb-article :deep(h1),
.thumb-article :deep(h2),
.thumb-article :deep(h3) {
  margin: 20px 0 12px;
  line-height: 1.5;
}

.thumb-article :deep(img) { display: block; max-width: 100%; height: auto; }

.thumb::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 48px;
  background: linear-gradient(transparent, #fff);
}

.default {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--warning-light);
  color: var(--warning);
  font-size: 12px;
}

.meta {
  margin-top: 10px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}

.actions {
  display: flex;
  gap: 2px;
}

.actions button {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-3);
  cursor: pointer;
}

.actions button:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.actions .danger:hover {
  color: var(--danger);
}

.desc {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 280px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-hover);
  color: var(--text-2);
  font: inherit;
}

.add:hover {
  border-color: var(--brand);
  color: var(--brand);
}
</style>
