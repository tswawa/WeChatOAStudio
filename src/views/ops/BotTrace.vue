<!-- Show only provider-returned reasoning and actual tool execution events. -->
<script setup>
import { computed, ref } from 'vue'
import { Brain, ChevronDown, LoaderCircle, Check, X, Wrench } from 'lucide-vue-next'

const props = defineProps({ message: { type: Object, required: true } })
const expanded = ref(null)
const live = computed(() => ['streaming', 'working', 'compacting'].includes(props.message.state))
const isExpanded = computed(() => expanded.value ?? live.value)
const visible = computed(() => props.message.reasoning || props.message.activity?.length || live.value)
const toolLabels = { read_workspace: '读取公众号数据', propose_action: '准备确认操作', memory: '长期记忆',
  search_web: '联网搜索网页', search_images: '联网搜索配图', prepare_image: '审核并保存配图' }
function toolLabel(step) {
  if (step.name === 'read_workspace') {
    try {
      const kind = JSON.parse(step.arguments).kind
      const labels = { web_search: '联网搜索网页', image_search: '联网搜索配图', image_sources: '读取原始来源配图', image_prepare: '审核并保存配图',
        article_context: '读取当前文章', capabilities: '检查可用能力' }
      if (labels[kind]) return labels[kind]
    } catch {}
  }
  return toolLabels[step.name] || step.name
}
</script>

<template>
  <div v-if="visible" class="bot-trace">
    <button
      type="button"
      class="trace-toggle"
      :aria-expanded="isExpanded"
      @click="expanded = !isExpanded"
    >
      <LoaderCircle v-if="live" :size="15" class="spinning" />
      <Brain v-else :size="15" />
      <span>{{ live ? message.progress || '等待模型响应' : message.reasoning ? '思考过程' : '执行记录' }}</span>
      <ChevronDown :size="14" :class="{ rotated: isExpanded }" />
    </button>
    <div v-if="isExpanded" class="trace-content">
      <p v-if="message.reasoning" class="reasoning">{{ message.reasoning }}</p>
      <div v-for="step in message.activity || []" :key="step.id" class="tool-step">
        <div class="tool-title">
          <LoaderCircle v-if="step.state === 'running'" :size="13" class="spinning" />
          <Check v-else-if="step.state === 'done'" :size="13" class="success" />
          <X v-else :size="13" class="error" />
          <Wrench :size="12" />
          <span>{{ toolLabel(step) }}</span>
        </div>
        <details class="tool-details">
          <summary>调用详情</summary>
          <pre>{{ step.arguments }}</pre>
          <pre v-if="step.result">{{ step.result }}</pre>
        </details>
      </div>
      <span v-if="message.usage?.reasoningTokens" class="reasoning-usage">
        {{ message.usage.reasoningTokens.toLocaleString() }} reasoning tokens
      </span>
    </div>
  </div>
</template>

<style scoped>
.bot-trace {
  margin-bottom: 10px;
  color: var(--text-2);
  font-size: 13px;
}
.trace-toggle,
.tool-title {
  display: flex;
  align-items: center;
  gap: 7px;
}
.trace-toggle {
  max-width: 100%;
  padding: 4px 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.trace-toggle span {
  overflow-wrap: anywhere;
}
.trace-toggle > svg {
  flex: none;
}
.rotated {
  transform: rotate(180deg);
}
.trace-content {
  margin: 8px 0 12px 6px;
  padding-left: 16px;
  border-left: 2px solid #e5eae7;
}
.reasoning {
  margin: 0 0 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.tool-step {
  margin: 12px 0;
}
.tool-title {
  min-height: 22px;
}
.tool-details {
  margin: 4px 0 0 20px;
  font-size: 12px;
}
.tool-details summary {
  cursor: pointer;
}
.tool-details pre {
  max-height: 220px;
  overflow: auto;
  margin: 8px 0;
  padding: 8px;
  background: #f7f8f8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.success {
  color: var(--brand);
}
.error {
  color: var(--danger);
}
.reasoning-usage {
  color: var(--text-3);
  font-size: 12px;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
