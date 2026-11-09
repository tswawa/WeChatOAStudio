<!-- 新增或编辑定时任务，并在保存成功后返回任务列表。 -->
<script setup>
import { reactive, ref } from 'vue'
import DeskDialog from '../../components/DeskDialog.vue'
import AssistantTaskFields from './AssistantTaskFields.vue'
import { addTask } from '../../store/workspace.js'

const props = defineProps({ task: { type: Object, default: null } })
const emit = defineEmits(['close', 'saved'])
const source = props.task ? JSON.parse(JSON.stringify(props.task)) : {}
const form = reactive({
  type: 'assistant', name: '', content: '', enabled: true, ...source,
  publication: { mode: 'confirm', ...source.publication },
  schedule: {
    time: '08:00', repeat: 'daily', ...source.schedule,
    weekdays: Array.isArray(source.schedule?.weekdays) ? source.schedule.weekdays : [1, 2, 3, 4, 5],
  },
})
const busy = ref(false)
const error = ref('')

async function save() {
  if (busy.value) return
  error.value = ''
  if (!form.name.trim() || !form.content.trim()) {
    error.value = '请填写任务名称和任务内容'
    return
  }
  if (form.schedule.repeat === 'weekly' && !form.schedule.weekdays.length) {
    error.value = '请至少选择一天'
    return
  }
  busy.value = true
  try {
    const task = await addTask(form)
    emit('saved', task)
    emit('close')
  } catch (cause) {
    error.value = cause.message
    console.error('保存定时任务失败：', cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DeskDialog
    :title="task ? '编辑定时任务' : '新增定时任务'"
    :width="600"
    @close="!busy && emit('close')"
  >
    <AssistantTaskFields
      :form="form"
      :disabled="busy"
    />
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
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
.error {
  margin-top: 14px;
  text-align: left;
  color: var(--danger);
  overflow-wrap: anywhere;
}
</style>
