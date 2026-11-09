<!-- Display configured limits, estimated input and actual provider token usage. -->
<script setup>
import { computed } from 'vue'

const props = defineProps({ bot: { type: Object, default: () => ({}) } })
const count = computed(() => props.bot.session?.context?.estimatedInputTokens || 0)
const max = computed(() => props.bot.model?.contextWindow || 128000)
const usage = computed(() => props.bot.session?.usage)
const format = value => Number(value || 0).toLocaleString()
</script>

<template>
  <div class="bot-context">
    <span class="model">{{ bot.model?.name || '未配置模型' }}</span>
    <span>思考 {{ bot.model?.reasoningEffort || '模型默认' }}</span>
    <span class="context-count" title="o200k 本地估算；不同模型的实际 token 数以服务商返回为准">
      <progress :value="count" :max="max" aria-label="上下文用量" />
      ~{{ format(count) }} / {{ format(max) }}
    </span>
    <span v-if="usage" class="usage" title="最近一次模型调用，采用服务商返回的实际用量">
      输入 {{ format(usage.inputTokens) }} · 输出 {{ format(usage.outputTokens) }}
    </span>
  </div>
</template>

<style scoped>
.bot-context {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 9px 0 0;
  color: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.model {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
progress {
  width: 42px;
  height: 4px;
  accent-color: var(--brand);
}
</style>
