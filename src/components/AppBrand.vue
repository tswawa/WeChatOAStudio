<!-- 应用品牌：在工作台和登录页展示统一 Logo 与产品名。 -->
<script setup>
import logoUrl from '../assets/wechat-oa-copilot-logo.png'
import { APP_NAME } from '../config/brand.js'
</script>

<template>
  <div class="app-brand">
    <img
      class="brand-logo"
      :src="logoUrl"
      :alt="APP_NAME"
      width="34"
      height="34"
      draggable="false"
    >
    <span class="brand-name">{{ APP_NAME }}</span>
  </div>
</template>

<style scoped>
.app-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--text-1);
}

.brand-logo {
  display: block;
  width: 34px;
  height: 34px;
  flex: none;
  object-fit: contain;
}

.brand-name {
  font-size: 19px;
  font-weight: 650;
  line-height: 1.2;
}

</style>
