<!-- 数据同步状态：显示真实同步错误并提供刷新与官方后台入口。 -->
<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { workspaceState, ws, refreshWorkspace, workspaceSection, sectionSyncing } from '../store/workspace.js'
import { currentAccount, session } from '../store/session.js'
import { accountStatusText } from '../services/desktop.js'
import OfficialPlatformButton from './OfficialPlatformButton.vue'

const route = useRoute()
const requests = ref(new Set())
const error = ref(null)
const section = computed(() => workspaceSection(route.path))
const requestKey = computed(() => `${session.accountId}:${section.value}`)
const syncing = computed(() => requests.value.has(requestKey.value) || sectionSyncing(section.value))
const errors = computed(() => {
  const values = ws.value.errors || {}
  const key = section.value
  const relevant = values[key] || (key === 'home'
    ? ['drafts', 'published', 'comments', 'data'].map((part) => values[part]).filter(Boolean).join('；') : '')
  const local = error.value?.key === requestKey.value ? error.value.message : ''
  return local || workspaceState.error || relevant
})

async function refresh(force = true) {
  const accountId = session.accountId
  const targetSection = section.value
  const key = `${accountId}:${targetSection}`
  if (!accountId || requests.value.has(key)) return
  requests.value.add(key)
  error.value = null
  try {
    await refreshWorkspace(targetSection, { force, accountId })
  } catch (cause) {
    error.value = { key, message: cause.message }
    console.error('同步公众平台失败：', cause)
  } finally {
    requests.value.delete(key)
  }
}

watch([() => route.path, () => session.accountId], () => refresh(false), { immediate: true })
</script>

<template>
  <div class="workspace-status">
    <div class="status-copy">
      <span>{{ accountStatusText(currentAccount?.status) }}</span>
      <span v-if="syncing"> · 正在同步…</span>
      <p
        v-if="errors"
        class="error"
        role="status"
      >{{ errors }}</p>
    </div>
    <button
      class="weui-btn weui-btn_mini weui-btn_default"
      :disabled="syncing"
      @click="refresh()"
    >同步数据</button>
    <OfficialPlatformButton />
  </div>
</template>

<style scoped>
.workspace-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-light);
  background: #fff;
  font-size: 12px;
}

.status-copy {
  flex: 1;
  color: var(--text-2);
}

.error {
  color: #b54737;
  overflow-wrap: anywhere;
}

.workspace-status :deep(.weui-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 32px;
  min-height: 32px;
  margin: 0;
  padding: 0 14px;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 30px;
}
</style>
