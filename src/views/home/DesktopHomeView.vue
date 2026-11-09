<!-- 桌面首页：展示真实账号及登录状态，提供会话验证、重新登录和公众平台入口。 -->
<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import OfficialPlatformButton from '../../components/OfficialPlatformButton.vue'
import { currentAccount, refreshAccount, session } from '../../store/session.js'
import { accountDescription, accountStatusText, desktopAccounts } from '../../services/desktop.js'

const route = useRoute()
const busy = ref(false)
const error = ref('')
const account = currentAccount
const lastChecked = computed(() => {
  if (!account.value?.lastCheckedAt) return '尚未验证'
  return new Date(account.value.lastCheckedAt).toLocaleString('zh-CN', { hour12: false })
})
const statusHint = computed(() => ({
  ready: '登录状态已确认，可以打开公众平台处理内容。',
  checking: '正在向微信确认登录状态，请稍候。',
  expired: '微信登录已失效，请重新登录这个公众号。',
  error: '暂时无法确认登录状态。可以重新验证，或打开公众平台查看。',
}[account.value?.status] || '打开公众平台或重新验证，以确认当前登录状态。'))

async function refresh() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await refreshAccount(account.value.id)
  } catch (cause) {
    error.value = cause.message || '无法验证登录状态'
    console.error('验证账号失败：', cause)
  } finally {
    busy.value = false
  }
}

async function loginAgain() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await desktopAccounts.login(account.value.id)
  } catch (cause) {
    error.value = cause.message || '无法打开登录窗口'
    console.error('重新登录失败：', cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    v-if="account"
    class="page desktop-home"
  >
    <h1 class="page-title">
      {{ route.name === 'account' ? '账号资料' : '首页' }}
    </h1>
    <section class="card account-card">
      <div class="profile">
        <span
          class="avatar"
          :style="{ background: account.color || '#07c160' }"
        >{{ account.initial || '公' }}</span>
        <div class="profile-copy">
          <h2>{{ account.name || '公众号' }}</h2>
          <p class="muted">{{ accountDescription(account) }}</p>
        </div>
        <span
          class="status"
          :class="{ ready: account.status === 'ready', expired: account.status === 'expired' }"
        >{{ accountStatusText(account.status) }}</span>
      </div>
      <dl class="account-details">
        <div>
          <dt>公众号原始 ID</dt>
          <dd>{{ account.originalId || '暂未获取' }}</dd>
        </div>
        <div>
          <dt>最近验证</dt>
          <dd>{{ lastChecked }}</dd>
        </div>
      </dl>
      <p class="status-hint">{{ statusHint }}</p>
      <p
        v-if="error"
        class="error"
        role="alert"
      >{{ error }}</p>
      <div class="actions">
        <OfficialPlatformButton />
        <button
          class="weui-btn weui-btn_default"
          :disabled="busy || account.status === 'checking'"
          @click="refresh"
        >
          重新验证
        </button>
        <button
          class="weui-btn weui-btn_default"
          :disabled="busy"
          @click="loginAgain"
        >
          重新登录
        </button>
      </div>
    </section>
    <section class="card connection-note">
      <h2>公众号工作台</h2>
      <p class="muted">
        当前已接入真实登录和账号管理。草稿、素材、运营助手等功能尚未接入，
        可先打开微信公众平台继续处理。
      </p>
      <p
        v-if="session.notice"
        class="notice"
        :class="{ error: session.noticeKind === 'error' }"
        role="status"
      >{{ session.notice }}</p>
    </section>
  </div>
</template>

<style scoped>
.desktop-home {
  max-width: 1200px;
}

.page-title {
  margin-bottom: 24px;
  font-size: 22px;
  font-weight: 600;
}

.profile {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 50%;
  color: #fff;
  font-size: 18px;
}

.profile-copy {
  flex: 1;
  min-width: 0;
}

.profile-copy h2 {
  margin-bottom: 6px;
  font-size: 20px;
  overflow-wrap: anywhere;
}

.status {
  padding: 5px 10px;
  border-radius: 4px;
  color: var(--text-2);
  background: var(--bg-page);
  font-size: 13px;
}

.status.ready {
  color: var(--brand);
  background: var(--brand-light);
}

.status.expired {
  color: #a44621;
  background: #fff3e9;
}

.account-details {
  display: flex;
  flex-wrap: wrap;
  gap: 24px 64px;
  margin: 28px 0;
}

.account-details dt {
  color: var(--text-3);
  font-size: 13px;
}

.account-details dd {
  margin: 8px 0 0;
}

.status-hint,
.connection-note p {
  line-height: 1.9;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.actions .weui-btn {
  width: auto;
  margin: 0;
}

.connection-note h2 {
  margin-bottom: 12px;
  font-size: 16px;
}

.notice,
.error {
  margin-top: 12px;
  overflow-wrap: anywhere;
}

.error {
  color: #b54737;
}
</style>
