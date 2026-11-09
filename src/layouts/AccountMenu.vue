<!-- 账号菜单：显示已保存账号，提供切换、追加登录与退出操作。 -->
<script setup>
import { Plus, LogOut, Check } from 'lucide-vue-next'
import { accounts, session } from '../store/session.js'
import { accountDescription, accountStatusText, isDesktop } from '../services/desktop.js'

defineProps({ busy: Boolean })
defineEmits(['choose', 'logout', 'close'])

const methodText = (id) => (session.loginMethods[id] === 'password' ? '账号密码登录' : '扫码登录')
</script>

<template>
  <button
    class="menu-mask"
    aria-label="关闭账号菜单"
    tabindex="-1"
    @click="$emit('close')"
  />
  <div
    id="account-menu"
    class="account-menu"
    role="menu"
    aria-label="公众号账号"
  >
    <button
      v-for="account in accounts"
      :key="account.id"
      class="menu-item"
      role="menuitemradio"
      :aria-checked="account.id === session.accountId"
      :disabled="busy"
      @click="$emit('choose', account)"
    >
      <span
        class="avatar"
        :style="{ background: account.color }"
      >{{ account.initial }}</span>
      <span class="menu-copy">
        <span class="account-name">{{ account.name }}</span>
        <span class="description">{{ accountDescription(account) }}</span>
      </span>
      <Check
        v-if="account.id === session.accountId"
        class="icon-16 text-brand"
        aria-label="当前账号"
      />
      <span
        v-else-if="session.signedIds.includes(account.id)"
        class="status"
      >{{ isDesktop ? accountStatusText(account.status) : methodText(account.id) }}</span>
      <span
        v-else
        class="status"
      >未登录</span>
    </button>
    <div class="menu-actions">
      <button
        class="menu-item"
        role="menuitem"
        :disabled="busy"
        @click="$emit('choose', { id: null })"
      >
        <Plus class="icon-16" />登录其他公众号
      </button>
      <button
        class="menu-item"
        role="menuitem"
        :disabled="busy"
        @click="$emit('logout')"
      >
        <LogOut class="icon-16" />退出当前账号
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  border: 0;
  background: transparent;
  cursor: default;
}

.account-menu {
  position: absolute;
  top: calc(100% - 4px);
  right: 24px;
  z-index: 100;
  width: min(360px, calc(100vw - 32px));
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: var(--radius);
  color: var(--text-1);
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.menu-item:hover,
.menu-item:focus-visible {
  background: var(--bg-hover);
}

.menu-item:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
}

.menu-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.account-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description,
.status {
  color: var(--text-2);
  font-size: 12px;
}

.menu-actions {
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid var(--border-light);
}
</style>
