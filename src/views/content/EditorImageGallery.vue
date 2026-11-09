<!-- 贴图图集编辑：显式添加图片、移除图片与调整发布顺序。 -->
<script setup>
import { ArrowLeft, ArrowRight, X } from 'lucide-vue-next'
const props = defineProps({ draft: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['add', 'change'])

function move(index, offset) {
  const images = props.draft.images
  const target = index + offset
  if (props.disabled || target < 0 || target >= images.length) return
  const [item] = images.splice(index, 1)
  images.splice(target, 0, item)
  emit('change')
}

function remove(index) {
  if (props.disabled) return
  props.draft.images.splice(index, 1)
  emit('change')
}
</script>

<template>
  <section class="image-gallery">
    <div class="gallery-head">
      <span>贴图 · {{ draft.images?.length || 0 }} 张</span>
      <button
        class="weui-btn weui-btn_mini weui-btn_default"
        :disabled="disabled"
        @click="emit('add')"
      >添加图片</button>
    </div>
    <div class="gallery-list">
      <figure
        v-for="(image, index) in draft.images || []"
        :key="`${image.id}-${index}`"
        class="gallery-item"
      >
        <img :src="image.url" :alt="`第 ${index + 1} 张`">
        <figcaption>
          <span>{{ index + 1 }}</span>
          <button
            title="前移"
            aria-label="前移"
            :disabled="disabled || index === 0"
            @click="move(index, -1)"
          ><ArrowLeft :size="15" /></button>
          <button
            title="后移"
            aria-label="后移"
            :disabled="disabled || index === draft.images.length - 1"
            @click="move(index, 1)"
          ><ArrowRight :size="15" /></button>
          <button
            title="移除"
            aria-label="移除"
            :disabled="disabled"
            @click="remove(index)"
          ><X :size="15" /></button>
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.image-gallery {
  padding: 16px 0;
  border-top: 1px solid var(--border-light);
}
.gallery-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.gallery-head .weui-btn {
  margin: 0;
}
.gallery-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.gallery-item {
  margin: 0;
}
.gallery-item img {
  width: 100%;
  height: 180px;
  object-fit: contain;
  background: var(--bg-page);
}
figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 6px 0;
  font-size: 12px;
}
figcaption button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 2px 4px;
  border: 0;
  color: var(--link);
  background: none;
  cursor: pointer;
}
figcaption button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
