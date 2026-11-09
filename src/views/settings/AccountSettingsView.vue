<!-- 账号设置：公众号基本信息（名称、类型、主体、认证、原始ID、登录邮箱、介绍）与当前登录方式 -->
<script setup>
import { computed } from 'vue'
import { session, currentAccount } from '../../store/session.js'
import { isDesktop, accountStatusText } from '../../services/desktop.js'
import OfficialPlatformButton from '../../components/OfficialPlatformButton.vue'
import AutoLoginPanel from './AutoLoginPanel.vue'
import { ws } from '../../store/workspace.js'
import SettingsTabs from '../../components/SettingsTabs.vue'

const profile = computed(() => ({
  ...currentAccount.value,
  ...Object.fromEntries(Object.entries(ws.value.account || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')),
}))

const rows = computed(() => {
  const account = profile.value
  return [
    { label: '名称', value: account.name },
    { label: '账号类型', value: account.type },
    { label: '主体类型', value: account.subject },
    { label: '微信认证', value: account.verified == null ? '未获取' : account.verified ? '已认证' : '未认证' },
    { label: '原始 ID', value: account.originalId },
    { label: '登录邮箱', value: account.email },
    { label: '介绍', value: account.intro },
    { label: '本次登录', value: isDesktop ? accountStatusText(account.status)
      : session.loginMethods[account.id] === 'password' ? '账号密码 + 微信确认' : '微信扫码' },
  ]
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <SettingsTabs />
    </div>
    <div class="card">
      <div class="profile">
        <span
          class="avatar"
          :style="{ background: currentAccount.color }"
        >{{ currentAccount.initial }}</span>
        <strong>{{ profile.name }}</strong>
      </div>
      <dl class="info">
        <template
          v-for="row in rows"
          :key="row.label"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value || '未获取' }}</dd>
        </template>
      </dl>
      <OfficialPlatformButton v-if="isDesktop" />
      <AutoLoginPanel v-if="isDesktop" />
    </div>
  </div>
</template>

<style scoped>
.profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border-light);
  font-size: 16px;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  color: #fff;
}

.info {
  display: grid;
  grid-template-columns: 120px 1fr;
  margin: 0;
}

.info dt,
.info dd {
  margin: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-light);
}

.info dt {
  color: var(--text-2);
}

.card > :deep(.platform-button) {
  margin-top: 20px;
}
</style>
