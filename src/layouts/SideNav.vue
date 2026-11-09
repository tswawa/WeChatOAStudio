<!-- 左侧导航：按业务分组展示可滚动的页面入口。 -->
<script setup>
import { NAV_GROUPS } from './navItems.js'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { pendingScans, ws } from '../store/workspace.js'

// Bot 显示待你确认的操作卡数量，运营任务显示等待扫码发表的稿件数量
const openCards = computed(() => (ws.value.chatMessages || [])
  .filter((item) => item.role === 'card' && item.card?.state === 'open').length)
const badge = (to) => to === '/bot' ? openCards.value : to === '/tasks' ? pendingScans.value.length : 0
// 合并入口（如“设置”）在它的各个子页面上也高亮
const route = useRoute()
const isActive = (item) => route.path === item.to || (item.match || []).some((path) => route.path.startsWith(path))
</script>

<template>
  <nav class="side-nav" aria-label="主导航">
    <div class="nav-scroll">
      <section
        v-for="(group, index) in NAV_GROUPS"
        :key="index"
        class="nav-group"
      >
        <h3
          v-if="group.title"
          class="nav-group-title"
        >
          {{ group.title }}
        </h3>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ 'is-active': isActive(item) }"
        >
          <component
            :is="item.icon"
            class="icon-16"
          />
          <span class="nav-label">{{ item.label }}</span>
          <span
            v-if="badge(item.to)"
            class="weui-badge"
            :title="item.to === '/bot' ? '待确认的操作' : '等待扫码发表'"
          >{{ badge(item.to) }}</span>
        </router-link>
      </section>
    </div>
  </nav>
</template>

<style scoped>
.side-nav {
  display: flex;
  flex-direction: column;
  width: var(--nav-w);
  flex: none;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border-right: 1px solid var(--border);
}

.nav-scroll {
  flex: 1;
  min-height: 0;
  padding: 12px 12px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.nav-group + .nav-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light);
}

.nav-group-title {
  padding: 8px 12px 4px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-3);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius);
  color: var(--text-1);
}

.nav-item:hover {
  background: var(--bg-hover);
}

.nav-item.is-active {
  color: var(--brand);
  background: var(--brand-light);
  font-weight: 600;
}

.nav-label {
  flex: 1;
}

</style>
