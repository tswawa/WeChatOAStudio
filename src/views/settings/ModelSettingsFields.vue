<!-- 模型连接表单：编辑兼容接口地址、模型名称和加密保存的密钥。 -->
<script setup>
import ModelRuntimeFields from './ModelRuntimeFields.vue'
import formats from '../../../electron/bot/api-formats.json'
const props = defineProps({ form: { type: Object, required: true }, disabled: Boolean })
function changeFormat() {
  const standard = new Set([...formats.map(format => format.baseUrl), 'https://api.deepseek.com'])
  if (!props.form.baseUrl || standard.has(props.form.baseUrl.replace(/\/$/, ''))) {
    props.form.baseUrl = formats.find(format => format.id === props.form.apiFormat).baseUrl
  }
}
</script>

<template>
  <fieldset class="model-fields" :disabled="disabled">
    <label class="field">
      <span>API 格式</span>
      <select v-model="form.apiFormat" aria-label="API 格式" @change="changeFormat">
        <option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }}</option>
      </select>
    </label>
    <label class="field">
      <span>接口地址</span>
      <input
        v-model="form.baseUrl"
        type="url"
        spellcheck="false"
        placeholder="https://api.deepseek.com"
      >
    </label>
    <label class="field">
      <span>模型名称</span>
      <input
        v-model="form.name"
        spellcheck="false"
        placeholder="按服务商文档填写"
      >
    </label>
    <label class="field">
      <span>API Key</span>
      <input
        v-model="form.apiKey"
        type="password"
        autocomplete="new-password"
        :placeholder="form.apiKeyConfigured ? '已保存，留空保持原密钥' : '填写 API Key'"
      >
    </label>
    <ModelRuntimeFields :form="form" />
  </fieldset>
</template>

<style scoped>
.model-fields {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field > span {
  color: var(--text-2);
  font-size: 13px;
}

input,
select {
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

input:focus,
select:focus {
  outline: 2px solid var(--brand-light);
  border-color: var(--brand);
}

input:disabled,
select:disabled {
  background: var(--bg-hover);
}
</style>
