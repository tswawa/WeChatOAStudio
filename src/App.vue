<!-- 根组件：页面路由出口、全局弹窗（发表、预览、确认、轻提示）与定时检查（定时发表、任务到点执行） -->
<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { releaseDueDrafts } from './store/workspace.js'
import { runDueTasks } from './assistant/scheduler.js'
import { session, disposeSession } from './store/session.js'
import { isDesktop } from './services/desktop.js'
import { toast } from './store/ui.js'
import PublishDialog from './components/PublishDialog.vue'
import ApiPublishDialog from './components/ApiPublishDialog.vue'
import PhonePreviewDialog from './components/PhonePreviewDialog.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'

const router = useRouter()

watch(() => session.loggedIn, (loggedIn) => {
  if (isDesktop && !loggedIn) router.replace('/login')
})
watch(() => session.notice, (message) => {
  if (isDesktop && message && session.noticeKind !== 'info') {
    toast(message, session.noticeKind === 'error' ? 'warn' : 'success')
  }
})

// 每 30 秒检查一次：到点的定时草稿发出去，到准备时间的任务开始执行
function tick() {
  releaseDueDrafts()
  runDueTasks()
}

let timer = null
onMounted(() => {
  if (isDesktop) return
  tick()
  timer = setInterval(tick, 30 * 1000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  disposeSession()
})
</script>

<template>
  <router-view />
  <template v-if="session.loggedIn">
    <PublishDialog v-if="!isDesktop" />
    <ApiPublishDialog v-else />
    <PhonePreviewDialog />
  </template>
  <ConfirmHost />
  <ToastHost />
</template>
