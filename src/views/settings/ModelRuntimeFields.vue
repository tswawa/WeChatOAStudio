<!-- Model context window and the reasoning effort sent to the provider as written. -->
<script setup>
defineProps({ form: { type: Object, required: true } })
</script>

<template>
  <div class="runtime-fields">
    <label class="field">
      <span>上下文窗口（tokens）</span>
      <input v-model.number="form.contextWindow" type="number" min="1" step="1">
      <small>按模型文档填写；对话接近输入上限时自动整理旧内容，原记录保留</small>
    </label>
    <label class="field">
      <span>思考强度</span>
      <input
        v-model.trim="form.reasoningEffort"
        spellcheck="false"
        placeholder="留空使用模型默认，如 low / high / max"
      >
      <small>原样发送给服务商（reasoning_effort / reasoning.effort），可用值见服务商文档</small>
    </label>
  </div>
</template>

<style scoped>
.runtime-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.field {
  display: grid;
  gap: 8px;
  align-content: start;
}
.field > span {
  font-size: 13px;
  color: var(--text-2);
}
.field small {
  color: var(--text-3);
  font-size: 12px;
}
input {
  width: 100%;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--text-1);
  font: inherit;
}
@container workspace (max-width: 650px) {
  .runtime-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
