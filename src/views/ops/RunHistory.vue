<!-- 运行记录：一次执行一行，展开看五个步骤；等待扫码的记录可直接去发表 -->
<script setup>
import { ref, computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import StatusTag from '../../components/StatusTag.vue'
import { runsOfTask, ws } from '../../store/workspace.js'
import { runStatus } from '../../store/taskModes.js'
import { openPublish } from '../../store/ui.js'
import { fmtDateTime } from '../../utils/time.js'

const props = defineProps({
  taskId: { type: String, required: true },
})

const runs = computed(() => runsOfTask(props.taskId))
const openId = ref(null)

const hasDraft = (run) => run.draftId && ws.value.drafts.some((item) => item.id === run.draftId)
</script>

<template>
  <div class="history">
    <div
      v-for="run in runs"
      :key="run.id"
      class="run"
    >
      <div
        class="run-row"
        @click="openId = openId === run.id ? null : run.id"
      >
        <ChevronRight
          class="icon-16 arrow"
          :class="{ open: openId === run.id }"
        />
        <span class="run-time">{{ fmtDateTime(run.startedAt) }}</span>
        <StatusTag :tone="runStatus(run).tone">
          {{ runStatus(run).label }}
        </StatusTag>
        <span class="faint run-note">{{ run.error || run.steps.find((step) => step.state !== 'done')?.note
          || run.steps.at(-1)?.note }}</span>
        <button
          v-if="run.status === 'waiting_scan' && hasDraft(run)"
          class="weui-btn weui-btn_xmini weui-btn_primary"
          @click.stop="openPublish(run.draftId)"
        >
          扫码发表
        </button>
      </div>
      <ol
        v-if="openId === run.id"
        class="run-steps"
      >
        <li
          v-for="step in run.steps"
          :key="step.key"
        >
          <span
            class="dot"
            :class="'is-' + step.state"
          />
          <span class="step-label">{{ step.label }}</span>
          <span class="faint">{{ step.note || '—' }}</span>
        </li>
      </ol>
    </div>
    <p
      v-if="!runs.length"
      class="empty"
    >
      还没有运行记录
    </p>
  </div>
</template>

<style scoped>
.run + .run {
  border-top: 1px solid var(--border-light);
}

.run-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 4px;
  cursor: pointer;
}

.arrow {
  color: var(--text-3);
  transition: transform 0.15s;
}

.arrow.open {
  transform: rotate(90deg);
}

.run-time {
  width: 96px;
  flex: none;
}

.run-note {
  flex: 1;
  font-size: 13px;
}

.run-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 12px 30px;
  padding: 10px 12px;
  list-style: none;
  border-radius: var(--radius);
  background: var(--bg-hover);
  font-size: 13px;
}

.run-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-3);
}

.dot.is-done {
  background: var(--brand);
}

.dot.is-active {
  background: var(--info);
}

.dot.is-pending {
  background: var(--warning);
}

.step-label {
  width: 84px;
}
</style>
