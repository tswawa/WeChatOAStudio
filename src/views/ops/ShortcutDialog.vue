<!-- 常用指令：保存名称和完整内容，供 Bot 输入框一键填入。 -->
<script setup>
import { reactive, ref } from 'vue'
import DeskDialog from '../../components/DeskDialog.vue'
import { executeAction, ws } from '../../store/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { uid } from '../../utils/time.js'

const emit = defineEmits(['close'])
const form = reactive({ name: '', content: '' })
const busy = ref(false)
const error = ref('')

async function save() {
  if (busy.value) return
  if (!form.name.trim() || !form.content.trim()) {
    error.value = '请填写名称和指令内容'
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (isDesktop) await executeAction('shortcut.save', form)
    else {
      if (!ws.value.shortcuts) ws.value.shortcuts = []
      ws.value.shortcuts.push({ id: uid('shortcut'), ...form })
    }
    emit('close')
  } catch (cause) {
    error.value = cause.message
    console.error('保存常用指令失败：', cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DeskDialog
    title="新增常用指令"
    :width="560"
    @close="!busy && emit('close')"
  >
    <div class="shortcut-form">
      <label>
        <span>名称</span>
        <input
          v-model="form.name"
          :disabled="busy"
        >
      </label>
      <label>
        <span>指令内容</span>
        <textarea
          v-model="form.content"
          rows="6"
          :disabled="busy"
        />
      </label>
      <p
        v-if="error"
        class="text-danger"
        role="alert"
      >{{ error }}</p>
    </div>
    <template #footer>
      <button
        class="weui-btn weui-btn_mini weui-btn_default"
        :disabled="busy"
        @click="emit('close')"
      >取消</button>
      <button
        class="weui-btn weui-btn_mini weui-btn_primary"
        :disabled="busy"
        @click="save"
      >{{ busy ? '正在保存…' : '保存' }}</button>
    </template>
  </DeskDialog>
</template>

<style scoped>
.shortcut-form,
label {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.shortcut-form {
  gap: 20px;
}

input,
textarea {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  line-height: 1.6;
}

textarea {
  resize: vertical;
}
</style>
