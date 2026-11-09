<!-- Configure one persistent Bot identity and memory policy for all entry points. -->
<script setup>
import { computed, ref } from 'vue'
import engines from '../../../electron/ops/search-engines.json'
import { FolderOpen } from 'lucide-vue-next'
import { invokeAction } from '../../services/workspace.js'
import { toast } from '../../store/ui.js'

const props = defineProps({ form: { type: Object, required: true }, images: { type: Object, required: true },
  search: { type: Object, required: true }, disabled: Boolean })
const primaryEngine = computed({ get: () => props.search.engines[0], set: id => {
  props.search.engines = [id, ...props.search.engines.filter(value => value !== id)]
} })
function toggleEngine(id, checked) {
  if (checked && !props.search.engines.includes(id)) props.search.engines.push(id)
  else if (!checked && props.search.engines.length > 1) props.search.engines = props.search.engines.filter(value => value !== id)
}
const choosing = ref(false)
async function chooseDirectory() {
  choosing.value = true
  try {
    const result = await invokeAction('images.chooseDirectory')
    if (result.directory) props.images.downloadDirectory = result.directory
  } catch (error) { toast(error.message, 'warn') }
  finally { choosing.value = false }
}
</script>

<template>
  <fieldset class="profile-fields" :disabled="disabled">
    <label class="field">
      <span>Bot 名称</span>
      <input v-model="form.name">
    </label>
    <label class="field">
      <span>身份与规则</span>
      <textarea v-model="form.instructions" rows="5" />
    </label>
    <label class="switch-field">
      <span>长期记忆</span>
      <input v-model="form.memoryEnabled" type="checkbox" class="weui-switch">
    </label>
    <label class="switch-field">
      <span>自动记录稳定偏好与事实</span>
      <input v-model="form.autoRemember" type="checkbox" class="weui-switch" :disabled="!form.memoryEnabled">
    </label>
    <label class="field">
      <span>首选搜索引擎</span>
      <select v-model="primaryEngine" aria-label="首选搜索引擎">
        <option v-for="engine in engines.filter(item => search.engines.includes(item.id))" :key="engine.id" :value="engine.id">{{ engine.name }}</option>
      </select>
    </label>
    <fieldset class="search-engines">
      <legend>可用搜索源</legend>
      <label v-for="engine in engines" :key="engine.id">
        <input type="checkbox" :checked="search.engines.includes(engine.id)"
          :disabled="disabled || (search.engines.length === 1 && search.engines[0] === engine.id)"
          @change="toggleEngine(engine.id, $event.target.checked)">
        {{ engine.name }}
      </label>
    </fieldset>
    <label class="field">
      <span>配图保存目录</span>
      <div class="directory-field">
        <input :value="images.downloadDirectory" readonly aria-label="配图保存目录" placeholder="尚未选择目录">
        <button type="button" class="icon-btn" :disabled="disabled || choosing" title="选择配图保存目录"
          aria-label="选择配图保存目录" @click="chooseDirectory"><FolderOpen :size="18" /></button>
      </div>
    </label>
    <label class="field">
      <span>单条消息最多模型调用次数</span>
      <input v-model.number="form.maxSteps" type="number" min="1" class="step-input">
    </label>
  </fieldset>
</template>

<style scoped>
.search-engines { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; border: 0; padding: 0; margin: 0; min-width: 0; }
.search-engines legend { margin-bottom: 12px; font-size: 13px; color: var(--text-2); }
.search-engines label { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.search-engines input { width: 15px; height: 15px; flex: none; }
.directory-field { display: flex; align-items: center; gap: 8px; min-width: 0; }
.directory-field input { flex: 1; min-width: 0; }
.directory-field button { display: grid; place-items: center; flex: none; width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: #fff; color: var(--text-2); cursor: pointer; }
.directory-field button:hover { background: var(--bg-page); }
.directory-field button:disabled { opacity: 0.5; cursor: default; }
.directory-field button:focus-visible { outline: 2px solid var(--brand-light); outline-offset: 2px; }
.profile-fields {
  display: grid;
  gap: 22px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.field {
  display: grid;
  gap: 8px;
}
.field > span {
  color: var(--text-2);
  font-size: 13px;
}
.field input,
.field select,
.field textarea {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--text-1);
  font: inherit;
}
.field textarea {
  resize: vertical;
}
.field .step-input {
  width: 120px;
}
.switch-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
</style>
