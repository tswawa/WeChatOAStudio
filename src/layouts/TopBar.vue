<!-- 顶部栏：平台标识、当前公众号与切换、添加账号、退出登录 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, LoaderCircle } from 'lucide-vue-next'
import AppBrand from '../components/AppBrand.vue'
import AccountMenu from './AccountMenu.vue'
import { session, currentAccount, switchAccount, logoutCurrent } from '../store/session.js'
import { toast } from '../store/ui.js'

const router = useRouter()
const open = ref(false)
const busy = ref(false)

async function choose(account) {
  if (busy.value) return
  open.value = false
  if (session.signedIds.includes(account.id)) {
    busy.value = true
    try {
      // 切换后留在当前页面，内容区按新公众号重新加载
      await switchAccount(account.id)
    } catch (error) {
      toast(error.message || '切换账号失败', 'warn')
      console.error('切换账号失败：', error)
    } finally {
      busy.value = false
    }
    return
  }
  router.push({ name: 'login', query: { add: '1' } })
}

async function logout() {
  if (busy.value) return
  open.value = false
  busy.value = true
  try {
    await logoutCurrent()
    await router.push(session.loggedIn ? '/home' : '/login')
  } catch (error) {
    toast(error.message || '退出账号失败', 'warn')
    console.error('退出账号失败：', error)
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <header
    v-if="currentAccount"
    class="top-bar"
    @keydown.esc="open = false"
  >
    <AppBrand />
    <button
      class="account"
      :disabled="busy"
      :aria-expanded="open"
      aria-controls="account-menu"
      aria-haspopup="menu"
      :aria-label="'切换公众号：' + currentAccount.name"
      @click="open = !open"
    >
      <span
        class="avatar"
        :style="{ background: currentAccount.color }"
      >{{ currentAccount.initial }}</span>
      <span class="account-name">{{ currentAccount.name }}</span>
      <span
        v-if="currentAccount.type"
        class="account-type"
      >{{ currentAccount.type }}</span>
      <LoaderCircle
        v-if="busy"
        class="icon-16 spinning"
      />
      <ChevronDown
        v-else
        class="icon-16 account-chevron"
        :class="{ rotated: open }"
      />
    </button>
    <AccountMenu
      v-if="open"
      :busy="busy"
      @choose="choose"
      @logout="logout"
      @close="open = false"
    />
  </header>
</template>

<style scoped>
.top-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: var(--header-h);
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.account {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  max-width: 42%;
  min-width: 0;
  padding: 4px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 0;
  background: transparent;
  font: inherit;
}

.account:hover {
  background: var(--bg-hover);
}

.account:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.account-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  flex: none;
}

.account-type {
  flex: none;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--text-2);
  background: #f2f2f4;
}

.account-chevron {
  flex: none;
  color: var(--text-2);
  transition: transform 150ms ease;
}

.account-chevron.rotated {
  transform: rotate(180deg);
}

.spinning {
  flex: none;
  animation: spin 800ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
