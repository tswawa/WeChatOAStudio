<!-- 尚未接入页面：明确真实数据的接入状态，并提供同账号公众平台入口。 -->
<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NAV_GROUPS } from '../../layouts/navItems.js'
import { currentAccount } from '../../store/session.js'
import OfficialPlatformButton from '../../components/OfficialPlatformButton.vue'

const route = useRoute()
const title = computed(() => NAV_GROUPS.flatMap((group) => group.items)
  .find((item) => item.to === route.path)?.label || '内容编辑')
const isAssistant = computed(() => ['/assistant', '/tasks'].includes(route.path))
</script>

<template>
  <div class="page">
    <h1>{{ title }}</h1>
    <section class="card connection-card">
      <h2>{{ title }}尚未接入</h2>
      <p class="muted">
        {{ isAssistant ? '运营助手和任务执行将在后续阶段接入。' : '这个页面尚未同步微信公众平台的数据。' }}
      </p>
      <p class="muted">
        当前账号：{{ currentAccount?.name || '公众号' }}。可以打开公众平台继续操作。
      </p>
      <OfficialPlatformButton />
    </section>
  </div>
</template>

<style scoped>
h1 {
  margin-bottom: 24px;
  font-size: 22px;
  font-weight: 600;
}

.connection-card {
  max-width: 900px;
  padding: 32px;
}

h2 {
  margin-bottom: 16px;
  font-size: 18px;
}

p {
  line-height: 1.9;
}

.connection-card :deep(.platform-button) {
  margin-top: 24px;
}
</style>
