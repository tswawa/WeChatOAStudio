<!-- 任务摘要卡：任务名称、时间、执行方式、启停状态，可跳转任务详情 -->
<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import StatusTag from '../../../components/StatusTag.vue'
import { db } from '../../../store/workspace.js'
import { taskModeText, scheduleText } from '../../../store/taskModes.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const router = useRouter()
const task = computed(() => db.tasks.find((item) => item.id === props.message.card.taskId))
</script>

<template>
  <div
    v-if="task"
    class="task-card"
  >
    <div class="tk-main">
      <div class="tk-head">
        <strong>{{ task.name }}</strong>
        <StatusTag :tone="task.enabled ? 'success' : 'muted'">
          {{ task.enabled ? '运行中' : '已暂停' }}
        </StatusTag>
      </div>
      <p class="faint">
        {{ scheduleText(task.schedule) }} · {{ taskModeText(task) }}
      </p>
    </div>
    <button
      class="weui-btn weui-btn_xmini weui-btn_default"
      @click="router.push({ path: '/tasks', query: { id: task.id } })"
    >
      查看
    </button>
  </div>
  <p
    v-else
    class="faint"
  >
    任务已删除
  </p>
</template>

<style scoped>
.task-card {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 420px;
  max-width: 100%;
}

.tk-main {
  flex: 1;
  font-size: 13px;
}

.tk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
</style>
