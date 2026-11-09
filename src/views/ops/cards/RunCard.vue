<!-- 运行卡片：展示一次任务执行的五个步骤；执行中可停止，写好后提供「预览」「编辑」「去发表」 -->
<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Check, LoaderCircle, Circle, Minus } from 'lucide-vue-next'
import StatusTag from '../../../components/StatusTag.vue'
import { db, ws } from '../../../store/workspace.js'
import { runStatus } from '../../../store/taskModes.js'
import { openPublish, openPreview } from '../../../store/ui.js'
import { requestStop } from '../../../assistant/runner.js'
import { pushBot } from '../../../assistant/chatStore.js'
import { fmtDateTime } from '../../../utils/time.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const router = useRouter()

const run = computed(() => db.runs.find((item) => item.id === props.message.card.runId))
const task = computed(() => run.value && db.tasks.find((item) => item.id === run.value.taskId))
const draft = computed(() => run.value?.draftId && ws.value.drafts.find((item) => item.id === run.value.draftId))
const status = computed(() => runStatus(run.value))

const STEP_ICON = { done: Check, active: LoaderCircle, pending: Circle, skipped: Minus }

function publish() {
  openPublish(draft.value.id, ({ mode }) => {
    pushBot(mode === 'now' ? '已发表。' : '已设置定时发表，到时间会自动发出，不用再扫码。')
  })
}
</script>

<template>
  <div class="run-card">
    <div class="run-head">
      <strong>{{ task?.name || '已删除的任务' }}</strong>
      <StatusTag :tone="status.tone">
        {{ status.label }}
      </StatusTag>
      <span
        v-if="run"
        class="faint run-time"
      >{{ fmtDateTime(run.startedAt) }} 开始</span>
      <button
        v-if="run?.status === 'running'"
        class="weui-btn weui-btn_xmini weui-btn_default"
        :disabled="run.stopRequested"
        @click="requestStop(run)"
      >
        {{ run.stopRequested ? '正在停止' : '停止' }}
      </button>
    </div>
    <ol
      v-if="run"
      class="steps"
    >
      <li
        v-for="step in run.steps"
        :key="step.key"
        class="step"
        :class="'is-' + step.state"
      >
        <component
          :is="STEP_ICON[step.state]"
          class="icon-16 step-icon"
        />
        <span class="step-label">{{ step.label }}</span>
        <span class="faint step-note">{{ step.note }}</span>
      </li>
    </ol>
    <p
      v-if="run?.error"
      class="text-danger"
    >{{ run.error }}</p>
    <p
      v-if="!run"
      class="faint"
    >
      这次运行记录已随任务删除
    </p>
    <div
      v-if="draft"
      class="run-draft"
    >
      <span class="run-draft-title">{{ draft.title }}</span>
      <div class="row-actions">
        <button
          class="weui-btn weui-btn_xmini weui-btn_default"
          @click="openPreview(draft.id)"
        >
          预览
        </button>
        <button
          class="weui-btn weui-btn_xmini weui-btn_default"
          @click="router.push('/editor/' + draft.id)"
        >
          编辑
        </button>
        <button
          v-if="['waiting_scan', 'drafted'].includes(run.status)"
          class="weui-btn weui-btn_xmini weui-btn_primary"
          @click="publish"
        >
          去发表
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.run-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.run-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-time {
  margin-left: auto;
  font-size: 12px;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.step-icon {
  color: var(--text-3);
}

.is-done .step-icon {
  color: var(--brand);
}

.is-active .step-icon {
  color: var(--info);
  animation: spin 1s linear infinite;
}

.is-pending .step-label {
  color: var(--text-2);
}

.step-label {
  width: 84px;
  flex: none;
}

.step-note {
  font-size: 12px;
}

.run-draft {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--bg-hover);
}

.run-draft-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
