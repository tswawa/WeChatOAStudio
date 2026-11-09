<!-- 发表前检查卡：对照公众平台的限制（标题 64 字、摘要 120 字）和排版规范（不用定位样式、脚本），列出需要处理的项 -->
<script setup>
import { computed } from 'vue'
import { ws } from '../../../store/workspace.js'
import { plainText } from '../../../store/seed/articles.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const draft = computed(() => ws.value.drafts.find((item) => item.id === props.message.card.draftId))

const checks = computed(() => {
  const item = draft.value
  const words = plainText(item.html).length
  return [
    { ok: item.title.length > 0 && item.title.length <= 64, text: `标题 1～64 字（当前 ${item.title.length} 字）` },
    { ok: item.digest.length <= 120, text: `摘要不超过 120 字（当前 ${item.digest.length} 字）` },
    { ok: Boolean(item.cover), text: '已设置封面' },
    { ok: !/position:\s*(absolute|fixed)/.test(item.html), text: '没有使用定位样式' },
    { ok: !/<script|<iframe/i.test(item.html), text: '没有脚本和内嵌框架' },
    { ok: words > 0, text: `正文不为空（当前 ${words} 字）` },
  ]
})

const failed = computed(() => checks.value.filter((item) => !item.ok).length)
</script>

<template>
  <div
    v-if="draft"
    class="ck"
  >
    <p>
      <strong>《{{ draft.title }}》</strong>
      <span :class="failed ? 'text-danger' : 'text-brand'">
        {{ failed ? `有 ${failed} 项需要处理` : '全部通过，可以发表' }}
      </span>
    </p>
    <ul class="ck-list">
      <li
        v-for="item in checks"
        :key="item.text"
        :class="item.ok ? 'muted' : 'text-danger'"
      >
        <i :class="item.ok ? 'weui-icon-success-no-circle' : 'weui-icon-warn'" />
        {{ item.text }}
      </li>
    </ul>
  </div>
  <p
    v-else
    class="faint"
  >
    这篇草稿已经发表或删除
  </p>
</template>

<style scoped>
.ck {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 420px;
  max-width: 100%;
}

.ck-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}

.ck-list li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ck-list i {
  width: 16px;
  height: 16px;
}
</style>
