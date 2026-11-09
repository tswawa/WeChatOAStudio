<!-- 定时助手任务表单：任务名称、消息内容以及闹钟式重复时间。 -->
<script setup>
import { computed } from 'vue'
import { apiPublishOf } from '../../store/workspace.js'
import { session } from '../../store/session.js'
import modes from '../../../electron/ops/publication-modes.json'
import MassQuota from '../../components/MassQuota.vue'
const props = defineProps({ form: { type: Object, required: true }, disabled: Boolean })
const api = computed(() => apiPublishOf(session.accountId))
const mode = computed({ get: () => props.form.publication?.mode || 'confirm', set: value => { props.form.publication = { mode: value } } })
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <div class="task-fields">
    <label>
      <span>任务名称</span>
      <input
        v-model="form.name"
        maxlength="100"
        :disabled="disabled"
        placeholder="例如：早间资讯"
      >
    </label>
    <label>
      <span>任务内容</span>
      <textarea
        v-model="form.content"
        rows="5"
        :disabled="disabled"
        placeholder="输入到点发送给 Bot 的任务"
      />
    </label>
    <label>
      <span>发表授权</span>
      <select v-model="mode" :disabled="disabled" aria-label="定时任务发表授权">
        <option v-for="option in modes" :key="option.id" :value="option.id" :disabled="option.id !== 'confirm' && !api.connected">{{ option.label }}</option>
      </select>
    </label>
    <MassQuota v-if="mode === 'mass'" :load="true" />
    <div class="schedule-row">
      <label>
        <span>时间</span>
        <input
          v-model="form.schedule.time"
          type="time"
          :disabled="disabled"
        >
      </label>
      <label>
        <span>重复</span>
        <select
          v-model="form.schedule.repeat"
          :disabled="disabled"
        >
          <option value="daily">每天</option>
          <option value="weekly">指定星期</option>
        </select>
      </label>
    </div>
    <div
      v-if="form.schedule.repeat === 'weekly'"
      class="weekdays"
    >
      <label
        v-for="(day, index) in weekdays"
        :key="day"
        class="weekday"
        :class="{ selected: (form.schedule.weekdays || []).includes(index + 1) }"
      >
        <input
          v-model="form.schedule.weekdays"
          type="checkbox"
          :value="index + 1"
          :disabled="disabled"
        >周{{ day }}
      </label>
    </div>
  </div>
</template>

<style scoped>
.task-fields,
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-fields {
  gap: 18px;
  text-align: left;
}

label > span {
  color: var(--text-2);
}

input:not([type='checkbox']),
textarea,
select {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  background: #fff;
}

textarea {
  resize: vertical;
  line-height: 1.6;
}

.schedule-row {
  display: flex;
  gap: 20px;
}

.schedule-row label {
  flex: 1;
}

.weekdays {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.weekday {
  flex-direction: row;
  align-items: center;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
}

.weekday.selected {
  color: var(--brand);
  border-color: var(--brand);
  background: var(--brand-light);
}

.weekday input {
  accent-color: var(--brand);
}
</style>
