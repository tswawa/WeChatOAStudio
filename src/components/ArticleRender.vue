<!-- 文章渲染：微信文章页的标题、作者行与正文，用于手机预览和编辑器右侧预览 -->
<script setup>
import { computed } from 'vue'
import { currentAccount } from '../store/session.js'
import { fmtDateTime } from '../utils/time.js'
import { cleanArticleHtml } from '../services/articleHtml.js'

const props = defineProps({
  draft: { type: Object, required: true },
})

const meta = computed(() => `${props.draft.author || currentAccount.value.name} · ${fmtDateTime(props.draft.updatedAt)}`)
</script>

<template>
  <article class="wx-article">
    <h1 class="wx-title">
      {{ draft.title || '请输入标题' }}
    </h1>
    <p class="wx-meta">
      <span class="wx-account">{{ currentAccount.name }}</span>
      <span>{{ meta }}</span>
    </p>
    <div
      v-if="Number(draft.itemShowType) === 8 && draft.images?.length"
      class="article-images"
    >
      <img
        v-for="(image, index) in draft.images"
        :key="`${image.id}-${index}`"
        :src="image.url"
        :alt="`第 ${index + 1} 张`"
      >
    </div>
    <div
      class="wx-content"
      v-html="cleanArticleHtml(draft.html) || '<p style=&quot;color:#bbb&quot;>正文为空</p>'"
    />
  </article>
</template>

<style scoped>
.wx-article {
  padding: 20px 16px 32px;
}

.wx-title {
  font-size: 22px;
  line-height: 1.4;
  font-weight: 600;
  margin-bottom: 12px;
}

.wx-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 14px;
  color: var(--text-3);
}

.wx-account {
  color: var(--link);
}

.wx-content {
  word-break: break-word;
}

.article-images img {
  display: block;
  width: 100%;
  height: auto;
  margin-bottom: 8px;
}
</style>
