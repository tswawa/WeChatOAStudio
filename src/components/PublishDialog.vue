<!-- 发表弹窗：选择立即/定时、是否群发通知（显示剩余次数），确认后进入扫码验证 -->
<script setup>
import { ref, computed, watch } from 'vue'
import DeskDialog from './DeskDialog.vue'
import ScanVerifyDialog from './ScanVerifyDialog.vue'
import CoverThumb from './CoverThumb.vue'
import { ui, closePublish, toast } from '../store/ui.js'
import { db, ws, massQuota, publishDraft, plannedPublishAt } from '../store/workspace.js'
import { session } from '../store/session.js'
import { fmtDateInput, fmtDateTime } from '../utils/time.js'

const HOUR = 60 * 60 * 1000

const mode = ref('now')
const massNotify = ref(true)
const scheduleInput = ref('')
const scanning = ref(false)

const draft = computed(() => ui.publish && ws.value.drafts.find((item) => item.id === ui.publish.draftId))
const scheduledAt = computed(() => new Date(scheduleInput.value).getTime())
// 次数按发表时间所在的天/月算：定时到明天，用的是明天的次数
const quota = computed(() => {
  const ts = mode.value === 'schedule' && scheduledAt.value ? scheduledAt.value : Date.now()
  return massQuota(session.accountId, ts, ui.publish?.draftId)
})

const scheduleError = computed(() => {
  if (mode.value !== 'schedule') return ''
  if (!scheduleInput.value) return '请选择发表时间'
  if (scheduledAt.value < Date.now() + 5 * 60 * 1000) return '定时时间需晚于当前 5 分钟'
  if (scheduledAt.value > Date.now() + 7 * 24 * HOUR) return '最多可定时到 7 天内'
  return ''
})

const purpose = computed(() => {
  const when = mode.value === 'now' ? '立即发表' : '定时于 ' + fmtDateTime(scheduledAt.value) + ' 发表'
  return `${when}「${draft.value.title}」${massNotify.value ? '，并群发通知' : '，不推送通知'}`
})

// 运营任务备好、等待扫码的稿件：原定发表时间还没到，就默认定时到那个时间
function plannedFor(draftId) {
  const run = db.runs.find((item) => item.draftId === draftId && item.status === 'waiting_scan')
  const planned = run && plannedPublishAt(run)
  return planned && planned > Date.now() + 5 * 60 * 1000 ? planned : null
}

watch(
  () => quota.value.left,
  (left) => {
    if (left <= 0) massNotify.value = false
  },
)

watch(
  () => ui.publish,
  (value) => {
    if (!value) return
    const target = ws.value.drafts.find((item) => item.id === value.draftId)
    const planned = plannedFor(target.id)
    mode.value = planned ? 'schedule' : 'now'
    scheduleInput.value = fmtDateInput(planned || Date.now() + 2 * HOUR)
    massNotify.value = quota.value.left > 0 && target.massNotify
    scanning.value = false
  },
)

function onVerified(scanner) {
  const payload = { mode: mode.value, scheduledAt: scheduledAt.value, massNotify: massNotify.value }
  const onDone = ui.publish.onDone
  publishDraft(draft.value.id, payload)
  closePublish()
  toast(payload.mode === 'now' ? '已发表' : '已设置定时发表')
  if (onDone) onDone({ ...payload, scanner })
}
</script>

<template>
  <template v-if="draft">
    <DeskDialog
      title="发表"
      :width="560"
      @close="closePublish"
    >
      <div class="pub-article">
        <CoverThumb
          :cover="draft.cover"
          :width="112"
        />
        <div>
          <p class="pub-title">
            {{ draft.title }}
          </p>
          <p class="muted">
            {{ draft.digest }}
          </p>
        </div>
      </div>

      <div class="pub-row">
        <span class="pub-label">发表时间</span>
        <div class="pub-options">
          <label class="radio">
            <input
              v-model="mode"
              type="radio"
              value="now"
            >立即发表
          </label>
          <label class="radio">
            <input
              v-model="mode"
              type="radio"
              value="schedule"
            >定时发表
          </label>
          <input
            v-if="mode === 'schedule'"
            v-model="scheduleInput"
            class="pub-time"
            type="datetime-local"
          >
          <p
            v-if="scheduleError"
            class="text-danger pub-tip"
          >
            {{ scheduleError }}
          </p>
          <p
            v-else-if="mode === 'schedule'"
            class="faint pub-tip"
          >
            现在扫码验证一次，到时间自动发表，无需再次扫码
          </p>
        </div>
      </div>

      <div class="pub-row">
        <span class="pub-label">群发通知</span>
        <div class="pub-options">
          <label class="switch-line">
            <input
              v-model="massNotify"
              class="weui-switch"
              type="checkbox"
              :disabled="quota.left <= 0"
            >
            <span>{{ massNotify ? '推送到粉丝的消息列表' : '不推送，只出现在公众号主页' }}</span>
          </label>
          <p class="faint pub-tip">
            {{ quota.period }}剩余 {{ quota.left }}/{{ quota.total }} 次。关闭群发通知的发表不占次数，也不限篇数。
          </p>
        </div>
      </div>

      <template #footer>
        <button
          class="weui-btn weui-btn_mini weui-btn_default"
          @click="closePublish"
        >
          取消
        </button>
        <button
          class="weui-btn weui-btn_mini weui-btn_primary"
          :class="{ 'weui-btn_disabled': scheduleError }"
          :disabled="Boolean(scheduleError)"
          @click="scanning = true"
        >
          {{ mode === 'now' ? '发表' : '定时发表' }}
        </button>
      </template>
    </DeskDialog>

    <ScanVerifyDialog
      v-if="scanning"
      :purpose="purpose"
      @verified="onVerified"
      @cancel="scanning = false"
    />
  </template>
</template>

<style scoped>
.pub-article {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 16px;
  border-radius: var(--radius);
  background: var(--bg-hover);
}

.pub-title {
  font-weight: 600;
}

.pub-row {
  display: flex;
  gap: 16px;
  padding: 12px 0;
}

.pub-label {
  width: 64px;
  flex: none;
  color: var(--text-2);
}

.pub-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  flex: 1;
}

.radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.radio input {
  accent-color: var(--brand);
}

.pub-time {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: inherit;
}

.pub-tip {
  width: 100%;
  font-size: 12px;
}

.switch-line {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
</style>
