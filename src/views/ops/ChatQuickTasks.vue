<!-- 常用指令菜单：填入已保存内容，保留新增与删除入口。 -->
<script setup>
import { computed, ref } from 'vue'
import { ListPlus, Plus, X } from 'lucide-vue-next'
import { ws, executeAction } from '../../store/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import ShortcutDialog from './ShortcutDialog.vue'
import { confirmAction } from '../../store/ui.js'

const emit = defineEmits(['select'])
const menu = ref(null)
const adding = ref(false)
const removing = ref(null)
const error = ref('')
const shortcuts = computed(() => ws.value.shortcuts || [])

function close() { menu.value?.removeAttribute('open') }
function select(item) {
  emit('select', item.content)
  close()
}
function add() {
  close()
  adding.value = true
}
async function remove(item) {
  if (removing.value) return
  close()
  if (!await confirmAction({ title: '删除常用指令', message: `删除「${item.name}」？` })) return
  removing.value = item.id
  error.value = ''
  try {
    if (isDesktop) await executeAction('shortcut.delete', { id: item.id })
    else ws.value.shortcuts = shortcuts.value.filter((entry) => entry.id !== item.id)
  } catch (cause) {
    error.value = cause.message
    console.error('删除常用指令失败：', cause)
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <details ref="menu" class="quick-tasks" @keydown.esc="close">
    <summary><ListPlus :size="16" />常用指令</summary>
    <div class="task-menu">
      <div v-for="item in shortcuts" :key="item.id" class="task-option">
        <button class="task-name" @click="select(item)">{{ item.name }}</button>
        <button
          class="task-delete"
          :disabled="Boolean(removing)"
          :aria-label="'删除常用指令：' + item.name"
          title="删除"
          @click="remove(item)"
        ><X :size="14" /></button>
      </div>
      <button class="task-add" @click="add"><Plus :size="16" />新增常用指令</button>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
  </details>
  <ShortcutDialog v-if="adding" @close="adding = false" />
</template>

<style scoped>
.quick-tasks {
  position: relative;
  color: var(--text-2);
  font-size: 13px;
}

summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid #dfe4e1;
  border-radius: 6px;
  list-style: none;
  cursor: pointer;
}

summary::-webkit-details-marker { display: none; }

.task-menu {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  z-index: 20;
  width: min(360px, calc(100vw - 300px));
  max-height: 260px;
  padding: 6px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 4px 18px rgb(0 0 0 / 8%);
}

.task-option { display: flex; align-items: center; }
.task-option:hover { background: var(--bg-hover); }

button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.task-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.task-delete { flex: none; color: var(--text-3); }
.task-delete:hover { color: var(--danger); }
.task-add { width: 100%; color: var(--brand); border-top: 1px solid var(--border-light); }
.error { padding: 8px; color: var(--danger); overflow-wrap: anywhere; }
</style>
