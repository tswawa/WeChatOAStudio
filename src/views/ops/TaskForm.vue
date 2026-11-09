<!-- 任务设置表单：写什么、写作要求、资讯来源（可添加网址）、时间、执行方式、群发通知。聊天确认卡与任务详情共用；compact 用于聊天卡片 -->
<script setup>
import { computed, watch } from 'vue'
import { apiPublishOf } from '../../store/workspace.js'
import MassQuota from '../../components/MassQuota.vue'
import { session } from '../../store/session.js'
import { TASK_MODES } from '../../store/taskModes.js'
import TaskCoverField from './TaskCoverField.vue'
import TaskSourcesField from './TaskSourcesField.vue'
import { isDesktop } from '../../services/desktop.js'

const props = defineProps({
  form: { type: Object, required: true },
  compact: { type: Boolean, default: false },
})

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const apiReady = computed(() => apiPublishOf(session.accountId).ready)

const massHint = computed(() => {
  if (!props.form.massNotify) return '只发表，不推送，不占次数'
  const base = '推送给粉丝，占用群发次数；次数不足则停止并保留草稿'
  if (props.form.mode !== 'auto_publish') return base
  return base + '。微信要求安全确认时暂停等待处理'
})

watch(
  () => props.form.schedule.repeat,
  (repeat) => {
    props.form.schedule.weekday = repeat === 'weekly' ? props.form.schedule.weekday || 1 : null
  },
)

</script>

<template>
  <div
    class="form"
    :class="{ compact }"
  >
    <label class="f-row">
      <span class="f-label">任务名称</span>
      <input
        v-model="form.name"
        class="f-input"
      >
    </label>
    <label class="f-row">
      <span class="f-label">写什么</span>
      <input
        v-model="form.topic"
        class="f-input"
      >
    </label>
    <label
      v-if="!compact"
      class="f-row"
    >
      <span class="f-label">写作要求</span>
      <textarea
        v-model="form.style"
        class="f-input f-area"
        rows="2"
      />
    </label>
    <TaskCoverField
      v-if="isDesktop"
      :form="form"
    />
    <TaskSourcesField :form="form" />
    <div class="f-row">
      <span class="f-label">时间</span>
      <div class="f-wrap">
        <select
          v-model="form.schedule.repeat"
          class="f-input f-short"
        >
          <option value="daily">
            每天
          </option>
          <option value="weekly">
            每周
          </option>
        </select>
        <select
          v-if="form.schedule.repeat === 'weekly'"
          v-model.number="form.schedule.weekday"
          class="f-input f-short"
        >
          <option
            v-for="(day, index) in WEEKDAYS"
            :key="day"
            :value="index + 1"
          >
            周{{ day }}
          </option>
        </select>
        <input
          v-model="form.schedule.prepareAt"
          class="f-input f-short"
          type="time"
        >开始准备
        <input
          v-model="form.schedule.publishAt"
          class="f-input f-short"
          type="time"
        >发表
      </div>
    </div>
    <div class="f-row">
      <span class="f-label">执行方式</span>
      <div class="f-modes">
        <label
          v-for="(mode, key) in TASK_MODES"
          :key="key"
          class="f-mode"
          :class="{ on: form.mode === key, off: key === 'auto_publish' && !apiReady }"
        >
          <input
            v-model="form.mode"
            type="radio"
            :value="key"
            :disabled="key === 'auto_publish' && !apiReady"
          >
          <strong>{{ mode.label }}</strong>
          <span class="faint">{{ key === 'auto_publish' && !apiReady ? '需接入官方接口，权限以微信实际返回为准' : mode.desc }}</span>
        </label>
      </div>
    </div>
    <label class="f-row">
      <span class="f-label">群发通知</span>
      <input
        v-model="form.massNotify"
        class="weui-switch"
        type="checkbox"
      >
      <span class="faint f-hint">{{ massHint }}</span>
      <MassQuota v-if="form.massNotify" :load="true" />
    </label>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.f-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.f-label {
  width: 72px;
  flex: none;
  padding-top: 5px;
  color: var(--text-2);
}

.f-input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  background: #fff;
}

.f-area {
  height: auto;
  padding: 6px 10px;
  resize: vertical;
}

.f-short {
  flex: none;
}

.f-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  flex: 1;
}

.f-mode input {
  accent-color: var(--brand);
}

.f-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  flex: 1;
}

.f-mode {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
}

.f-mode strong {
  font-size: 14px;
}

.f-mode.on {
  border-color: var(--brand);
  background: var(--brand-light);
}

.f-mode.off {
  cursor: not-allowed;
  opacity: 0.55;
}

.compact {
  gap: 10px;
  font-size: 13px;
}

.compact .f-label {
  width: 60px;
}

.compact .f-input {
  height: 30px;
}

.compact .f-modes {
  grid-template-columns: 1fr;
}

.compact .f-mode {
  padding: 8px 10px;
}

.f-hint {
  padding-top: 6px;
  font-size: 12px;
}
</style>
