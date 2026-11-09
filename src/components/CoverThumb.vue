<!-- 文章封面缩略图：演示数据用渐变色块和文字代替真实图片 -->
<script setup>
defineProps({
  cover: { type: Object, default: () => ({}) },
  width: { type: Number, default: 96 },
  ratio: { type: Number, default: 2.35 },
})
</script>

<template>
  <div
    class="cover"
    :style="{
      width: width + 'px',
      height: Math.round(width / ratio) + 'px',
      background: cover?.url ? '#f5f5f5' : `linear-gradient(135deg, ${cover?.from || '#a6b4b0'}, ${cover?.to || '#d6dfdc'})`,
      fontSize: Math.max(11, Math.round(width / 9)) + 'px',
    }"
  >
    <img
      v-if="cover?.url"
      :src="cover.url"
      alt="封面"
      referrerpolicy="no-referrer"
    >
    <span v-else>{{ cover?.label || '封面' }}</span>
  </div>
</template>

<style scoped>
.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 4px;
  color: #fff;
  font-weight: 600;
  letter-spacing: 1px;
  overflow: hidden;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
