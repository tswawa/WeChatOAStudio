<!-- 设置页标题与页签：账号、人员、开发接口三个页面共用，左侧导航只保留一个“设置”入口 -->
<script setup>
import { SETTINGS_TABS } from '../layouts/navItems.js'
</script>

<template>
  <div class="settings-tabs">
    <h1 class="page-title">设置</h1>
    <nav class="tabs" aria-label="设置分类">
      <router-link
        v-for="tab in SETTINGS_TABS"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        active-class="on"
      >{{ tab.label }}</router-link>
    </nav>
  </div>
</template>

<style scoped>
.settings-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
}

.tabs {
  display: flex;
  gap: 18px;
}

.tab {
  padding: 4px 0;
  border-bottom: 2px solid transparent;
  color: var(--text-2);
}

.tab:hover {
  color: var(--text-1);
}

.tab.on {
  color: var(--brand);
  border-bottom-color: var(--brand);
}
</style>
