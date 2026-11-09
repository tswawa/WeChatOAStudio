<!-- 改稿方案卡：助手给出的修改（标题候选、摘要、精简后的正文），点「使用」才写回草稿 -->
<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ws, saveDraft } from '../../../store/workspace.js'
import { openPreview } from '../../../store/ui.js'
import { updateCard, pushBot } from '../../../assistant/chatStore.js'
import { plainText } from '../../../store/seed/articles.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const router = useRouter()
const card = computed(() => props.message.card)
const draft = computed(() => ws.value.drafts.find((item) => item.id === card.value.draftId))

const FIELD_TEXT = { title: '标题', digest: '摘要', html: '正文' }

function preview(option) {
  return card.value.field === 'html' ? plainText(option.value).slice(0, 80) + '…' : option.value
}

function use(option) {
  saveDraft({ ...draft.value, [card.value.field]: option.value })
  updateCard(props.message.id, { state: 'confirmed', chosen: option.label })
  pushBot(`已替换${FIELD_TEXT[card.value.field]}，草稿已保存。`)
}
</script>

<template>
  <div
    v-if="draft"
    class="ep"
  >
    <p class="faint ep-target">
      《{{ draft.title }}》的{{ FIELD_TEXT[card.field] }}
    </p>
    <div
      v-for="option in card.options"
      :key="option.label"
      class="ep-option"
      :class="{ on: card.chosen === option.label }"
    >
      <div class="ep-text">
        <span
          v-if="option.note"
          class="faint ep-note"
        >{{ option.note }}</span>
        <p>{{ preview(option) }}</p>
      </div>
      <button
        v-if="card.state === 'open'"
        class="weui-btn weui-btn_xmini weui-btn_primary"
        @click="use(option)"
      >
        使用
      </button>
      <span
        v-else-if="card.chosen === option.label"
        class="text-brand"
      >已使用</span>
    </div>
    <div class="ep-links">
      <a @click="openPreview(draft.id)">手机预览</a>
      <a @click="router.push('/editor/' + draft.id)">打开编辑器</a>
    </div>
  </div>
  <p
    v-else
    class="faint"
  >
    这篇草稿已经发表或删除
  </p>
</template>

<style scoped>
.ep {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 480px;
  max-width: 100%;
}

.ep-target {
  font-size: 12px;
}

.ep-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
}

.ep-option.on {
  border-color: var(--brand);
}

.ep-text {
  min-width: 0;
}

.ep-note {
  font-size: 12px;
}

.ep-links {
  display: flex;
  gap: 16px;
  font-size: 13px;
}
</style>
