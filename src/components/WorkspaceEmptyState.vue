<!-- 业务列表空状态：在内容容器中居中展示加载、失败或空数据。 -->
<script setup>
import { computed } from 'vue'
import { CircleAlert, Inbox, LoaderCircle } from 'lucide-vue-next'
import { sectionSyncing, workspaceState, ws } from '../store/workspace.js'
import { isDesktop } from '../services/desktop.js'

const props = defineProps({
  text: { type: String, default: '暂无内容' },
  section: { type: String, default: '' },
  fill: Boolean,
})

const failed = computed(() => Boolean(props.section && isDesktop
  && (ws.value.errors?.[props.section] || workspaceState.error)))
const loading = computed(() => Boolean(props.section && isDesktop
  && (sectionSyncing(props.section) || (!failed.value && !ws.value.syncedSections?.[props.section]))))
const message = computed(() => loading.value ? '正在加载…' : failed.value ? '暂时无法加载' : props.text)
const icon = computed(() => loading.value ? LoaderCircle : failed.value ? CircleAlert : Inbox)
</script>

<template>
  <div
    class="workspace-empty"
    :class="{ fill }"
    :aria-busy="loading"
    role="status"
  >
    <div class="empty-content">
      <component
        :is="icon"
        :size="30"
        :stroke-width="1.5"
        :class="{ spinning: loading }"
        aria-hidden="true"
      />
      <p>{{ message }}</p>
    </div>
  </div>
</template>

<style scoped>
.workspace-empty {
  display: grid;
  place-items: center;
  min-height: 240px;
  width: 100%;
  padding: 24px;
  color: var(--text-3);
  text-align: center;
}

.workspace-empty.fill {
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 100%;
}

.empty-content p {
  overflow-wrap: anywhere;
}

.spinning {
  animation: empty-spin 900ms linear infinite;
}

@keyframes empty-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation-duration: 1800ms;
  }
}
</style>
