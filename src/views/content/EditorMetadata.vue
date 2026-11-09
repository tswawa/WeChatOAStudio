<!-- 图文附加信息：封面上传、摘要以及需在公众平台确认的文章设置。 -->
<script setup>
import CoverThumb from '../../components/CoverThumb.vue'
import { isDesktop } from '../../services/desktop.js'

defineProps({ draft: { type: Object, required: true }, disabled: Boolean })
defineEmits(['choose-cover', 'change'])
</script>

<template>
  <section class="ed-meta">
    <div
      v-if="Number(draft.itemShowType) !== 8"
      class="meta-row"
    >
      <span class="meta-label">封面</span>
      <CoverThumb
        :cover="draft.cover"
        :width="160"
      />
      <button
        v-if="isDesktop"
        class="weui-btn weui-btn_mini weui-btn_default"
        :disabled="disabled"
        @click="$emit('choose-cover')"
      >上传封面</button>
    </div>
    <label class="meta-row">
      <span class="meta-label">摘要</span>
      <textarea
        v-model="draft.digest"
        class="meta-input"
        maxlength="120"
        rows="2"
        :disabled="disabled"
        @input="$emit('change')"
        placeholder="选填，不填写则默认抓取正文开头部分文字"
      />
    </label>
    <div class="meta-row">
      <span class="meta-label">原创</span>
      <span class="faint">{{ isDesktop ? '在公众平台确认' : '未声明 ›' }}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">留言</span>
      <span class="faint">{{ isDesktop ? '在公众平台确认' : '留言自动精选公开 ›' }}</span>
    </div>
  </section>
</template>

<style scoped>
.ed-meta {
  margin-top: 32px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light);
}

.meta-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 0;
}

.meta-label {
  width: 48px;
  flex: none;
  color: var(--text-2);
}

.meta-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  resize: vertical;
}
</style>
