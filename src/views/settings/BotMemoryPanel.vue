<!-- Review and edit account-isolated long-term Bot memories. -->
<script setup>
import { onMounted, ref, reactive, watch } from 'vue'
import { Plus, Pencil, Trash2, LoaderCircle, Pin } from 'lucide-vue-next'
import { invokeAction } from '../../services/workspace.js'
import { session } from '../../store/session.js'
import { confirmAction } from '../../store/ui.js'

const items = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const editing = ref(false)
const form = reactive({ id: '', title: '', content: '', pinned: false })
async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = await invokeAction('memory.list')
  } catch (failure) {
    error.value = failure.message
  } finally {
    loading.value = false
  }
}
function edit(item = {}) {
  Object.assign(form, { id: '', title: '', content: '', pinned: false }, item)
  editing.value = true
}
async function save() {
  busy.value = true
  error.value = ''
  try {
    await invokeAction('memory.save', form)
    editing.value = false
    await load()
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
async function remove(item) {
  if (!await confirmAction({ title: '删除记忆', message: `删除「${item.title}」？Bot 之后不会再参考这条记忆。` })) return
  busy.value = true
  try {
    await invokeAction('memory.delete', { id: item.id })
    await load()
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
watch(() => session.accountId, () => {
  editing.value = false
  load()
})
onMounted(load)
</script>

<template>
  <div class="memory-panel">
    <div class="memory-head">
      <span>{{ items.length }} 条记忆</span>
      <button class="icon-btn" title="新增记忆" aria-label="新增记忆" :disabled="busy" @click="edit()">
        <Plus :size="18" />
      </button>
    </div>
    <form v-if="editing" class="memory-form" @submit.prevent="save">
      <label>
        <span>标题</span>
        <input v-model="form.title" required>
      </label>
      <label>
        <span>内容</span>
        <textarea v-model="form.content" rows="4" required />
      </label>
      <label class="pin-field">
        <input v-model="form.pinned" type="checkbox">
        优先放入上下文
      </label>
      <div class="form-actions">
        <button type="button" class="weui-btn weui-btn_mini weui-btn_default" @click="editing = false">
          取消
        </button>
        <button class="weui-btn weui-btn_mini weui-btn_primary" :disabled="busy">
          <LoaderCircle v-if="busy" :size="14" class="spinning" />保存
        </button>
      </div>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="loading" class="memory-empty"><LoaderCircle :size="18" class="spinning" /></div>
    <div v-else-if="!items.length && !editing" class="memory-empty">暂无长期记忆</div>
    <ul v-else class="memory-list">
      <li v-for="item in items" :key="item.id">
        <div class="memory-content">
          <strong><Pin v-if="item.pinned" :size="13" />{{ item.title }}</strong>
          <p>{{ item.content }}</p>
          <span class="memory-source">{{ item.source === 'bot' ? 'Bot 记录' : item.source === 'preset' ? '出厂预设' : '手动记录' }}</span>
        </div>
        <div class="row-actions">
          <button class="icon-btn" title="编辑记忆" aria-label="编辑记忆" :disabled="busy" @click="edit(item)">
            <Pencil :size="15" />
          </button>
          <button class="icon-btn" title="删除记忆" aria-label="删除记忆" :disabled="busy" @click="remove(item)">
            <Trash2 :size="15" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.memory-head,
.form-actions,
.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.memory-head {
  justify-content: space-between;
  margin-bottom: 16px;
  color: var(--text-2);
  font-size: 13px;
}
.memory-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.memory-list li {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 0;
  border-top: 1px solid var(--border-light);
}
.memory-content {
  flex: 1;
  min-width: 0;
}
.memory-content strong {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.memory-content p {
  margin: 8px 0;
  color: var(--text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.memory-source {
  color: var(--text-3);
  font-size: 12px;
}
.memory-empty {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: var(--text-3);
}
.memory-form {
  display: grid;
  gap: 14px;
  margin-bottom: 24px;
}
.memory-form label {
  display: grid;
  gap: 6px;
}
.memory-form label > span {
  color: var(--text-2);
  font-size: 13px;
}
.memory-form input:not([type='checkbox']),
.memory-form textarea {
  width: 100%;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--text-1);
  font: inherit;
}
.memory-form .pin-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.form-actions {
  justify-content: flex-end;
}
.form-actions .weui-btn {
  margin: 0;
}
.error {
  color: var(--danger);
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
