<!-- 任务资讯来源：选择已有来源或添加真实网页、RSS 地址。 -->
<script setup>
import { ref } from 'vue'
import { ws, addSource } from '../../store/workspace.js'
import { toast } from '../../store/ui.js'

const props = defineProps({ form: { type: Object, required: true } })
const newSource = ref('')
const saving = ref(false)

async function add() {
  if (!newSource.value.trim() || saving.value) return
  saving.value = true
  try {
    const source = await addSource(newSource.value)
    props.form.sourceIds.push(source.id)
    newSource.value = ''
  } catch (error) {
    toast(error.message, 'warn')
    console.error('添加资讯来源失败：', error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="sources">
    <span class="label">资讯来源</span>
    <div class="options">
      <label
        v-for="source in ws.sources"
        :key="source.id"
        class="choice"
      >
        <input
          v-model="form.sourceIds"
          type="checkbox"
          :value="source.id"
        >{{ source.name }}<span class="faint">（{{ source.kind }}）</span>
      </label>
      <span class="add-source">
        <input
          v-model="newSource"
          placeholder="添加网址或 RSS"
          :disabled="saving"
          @keydown.enter.prevent="add"
        >
        <button
          class="weui-btn weui-btn_xmini weui-btn_default"
          :disabled="saving"
          @click="add"
        >添加</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.sources {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.label {
  width: 72px;
  flex: none;
  padding-top: 5px;
  color: var(--text-2);
}

.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  flex: 1;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-top: 5px;
}

.choice input {
  accent-color: var(--brand);
}

.add-source {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-source input {
  width: 180px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: 13px;
}
</style>
