<!-- 运营任务页：直接新建定时任务，兼容已有写稿任务的管理与运行记录。 -->
<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus } from 'lucide-vue-next'
import StatusTag from '../../components/StatusTag.vue'
import TaskDetail from './TaskDetail.vue'
import AssistantTaskDetail from './AssistantTaskDetail.vue'
import ScheduledTaskDialog from './ScheduledTaskDialog.vue'
import { tasksOfAccount, runsOfTask } from '../../store/workspace.js'
import { scheduleText, nextRunText, runStatus, taskModeText } from '../../store/taskModes.js'

const route = useRoute()
const router = useRouter()
const creating = ref(false)

const selected = computed(() => {
  const list = tasksOfAccount.value
  return list.find((task) => task.id === route.query.id) || list[0]
})

function lastRun(task) {
  return runsOfTask(task.id)[0]
}

function select(task) {
  router.replace({ path: '/tasks', query: { id: task.id } })
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          运营任务
        </h1>
      </div>
      <button
        class="weui-btn weui-btn_mini weui-btn_primary head-btn"
        @click="creating = true"
      >
        <Plus class="icon-16" />新增定时任务
      </button>
    </div>

    <div
      v-if="tasksOfAccount.length"
      class="layout"
    >
      <div class="list card">
        <div
          v-for="task in tasksOfAccount"
          :key="task.id"
          class="item"
          :class="{ on: selected && task.id === selected.id }"
          @click="select(task)"
        >
          <div class="item-head">
            <strong>{{ task.name }}</strong>
            <StatusTag :tone="task.enabled ? 'success' : 'muted'">
              {{ task.enabled ? '已开启' : '已暂停' }}
            </StatusTag>
          </div>
          <p class="faint">
            {{ scheduleText(task.schedule) }}<template v-if="task.enabled"> · {{ nextRunText(task) }}</template>
          </p>
          <p class="faint">
            {{ taskModeText(task) }}
            <template v-if="lastRun(task)">
              · 最近：{{ runStatus(lastRun(task)).label }}
            </template>
          </p>
        </div>
      </div>
      <TaskDetail
        v-if="selected && selected.type !== 'assistant'"
        :task="selected"
        class="detail"
        @removed="router.replace('/tasks')"
      />
      <AssistantTaskDetail
        v-else-if="selected"
        :key="selected.id"
        :task="selected"
        class="detail"
        @removed="router.replace('/tasks')"
      />
    </div>

    <div
      v-else
      class="card empty"
    >
      <p>还没有运营任务</p>
    </div>
    <ScheduledTaskDialog
      v-if="creating"
      @close="creating = false"
      @saved="select"
    />
  </div>
</template>

<style scoped>
.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.layout {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.list {
  width: 280px;
  flex: none;
  padding: 8px;
}

.item {
  padding: 12px;
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
}

.item:hover {
  background: var(--bg-hover);
}

.item.on {
  background: var(--brand-light);
}

.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 14px;
}

.detail {
  flex: 1;
  min-width: 0;
}
</style>
