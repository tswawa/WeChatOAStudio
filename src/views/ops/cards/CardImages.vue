<!-- Reviewed article images remain local until the draft confirmation is executed. -->
<script setup>
import { ref } from 'vue'
import { ExternalLink, FolderOpen, Trash2, ImageOff } from 'lucide-vue-next'
import { invokeAction } from '../../../services/workspace.js'
import { isDesktop } from '../../../services/desktop.js'
import { toast } from '../../../store/ui.js'

defineProps({ images: { type: Array, default: () => [] }, editable: Boolean, disabled: Boolean })
defineEmits(['remove'])
const broken = ref(new Set())
async function reveal(id) {
  try { await invokeAction('images.reveal', { id }) }
  catch (error) { toast(error.message, 'warn') }
}
async function source(url) {
  try {
    if (isDesktop) await window.mpDesktop.openUrl(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch (error) { toast(error.message || '无法打开来源', 'warn') }
}
</script>

<template>
  <ul class="article-images" aria-label="已审核配图">
    <li v-for="image in images" :key="image.id" class="image-row">
      <div class="thumbnail">
        <ImageOff v-if="broken.has(image.id)" :size="22" aria-label="预览不可用" />
        <img v-else :src="image.previewUrl" :alt="image.review.description" loading="lazy" @error="broken.add(image.id)">
      </div>
      <div class="image-copy">
        <strong>{{ image.title }}</strong>
        <span>{{ image.review.description }}</span>
        <small>已完成视觉审核</small>
      </div>
      <div class="image-actions">
        <button v-if="image.sourcePage" class="icon-btn" type="button" title="打开原始来源" aria-label="打开原始来源" @click="source(image.sourcePage)">
          <ExternalLink :size="16" />
        </button>
        <button class="icon-btn" type="button" title="在文件夹中显示" aria-label="在文件夹中显示" @click="reveal(image.id)">
          <FolderOpen :size="16" />
        </button>
        <button v-if="editable" class="icon-btn" type="button" title="移除这张配图" aria-label="移除这张配图"
          :disabled="disabled" @click="$emit('remove', image.id)">
          <Trash2 :size="16" />
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.article-images { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.image-row { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border-light); }
.thumbnail { display: grid; place-items: center; width: 76px; aspect-ratio: 1; overflow: hidden; border: 1px solid var(--border-light); border-radius: 4px; color: var(--text-3); background: var(--bg-page); }
.thumbnail img { display: block; width: 100%; height: 100%; object-fit: contain; }
.image-copy { display: grid; min-width: 0; gap: 5px; overflow-wrap: anywhere; }
.image-copy strong { font-size: 13px; font-weight: 500; }
.image-copy span { color: var(--text-2); font-size: 12px; line-height: 1.6; }
.image-copy small { color: var(--text-3); font-size: 11px; }
.image-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px; max-width: 90px; }
.image-actions button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: #fff; color: var(--text-2); cursor: pointer; }
.image-actions button:hover { background: var(--bg-page); color: var(--text-1); }
.image-actions button:disabled { opacity: 0.5; cursor: default; }
.image-actions button:focus-visible { outline: 2px solid var(--brand-light); outline-offset: 2px; }
</style>
