<!-- 工作台布局：顶部栏 + 左侧导航 + 内容区；切换公众号时内容区重新加载，页面数据在后台静默同步 -->
<script setup>
import TopBar from './TopBar.vue'
import SideNav from './SideNav.vue'
import { session } from '../store/session.js'
import { isDesktop } from '../services/desktop.js'
import { useBackgroundSync } from '../store/backgroundSync.js'

if (isDesktop) useBackgroundSync()
</script>

<template>
  <div
    v-if="session.loggedIn"
    class="workspace"
  >
    <TopBar />
    <div class="workspace-body">
      <SideNav />
      <main class="workspace-main">
        <router-view :key="$route.path + session.accountId" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.workspace-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  container-type: inline-size;
  container-name: workspace;
  overscroll-behavior: contain;
}
</style>
