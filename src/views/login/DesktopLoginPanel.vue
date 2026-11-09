<!-- 真实登录入口：打开微信页面，显示等待状态，在收到成功账号资料后进入工作台。 -->
<script setup>
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentAccount, session, loadAccounts } from '../../store/session.js'
import { desktopAccounts } from '../../services/desktop.js'

const route = useRoute()
const router = useRouter()
const opening = ref(false)
const waiting = ref(false)
const error = ref('')
let previousAccount = null
let previousCheck = null

async function openLogin() {
  if (opening.value) return
  opening.value = true
  error.value = ''
  session.notice = ''
  previousAccount = currentAccount.value?.id
  previousCheck = currentAccount.value?.lastCheckedAt
  waiting.value = true
  try {
    await desktopAccounts.login()
  } catch (cause) {
    waiting.value = false
    error.value = cause.message || '无法打开登录窗口'
    console.error('打开微信登录失败：', cause)
  } finally {
    opening.value = false
  }
}

watch(() => session.revision, () => {
  const account = currentAccount.value
  if (!waiting.value || account?.status !== 'ready') return
  if (account.id === previousAccount && account.lastCheckedAt === previousCheck) return
  waiting.value = false
  const next = typeof route.query.next === 'string' ? route.query.next : '/home'
  router.replace(next.startsWith('/') ? next : '/home')
})
</script>

<template>
  <div class="desktop-login">
    <div class="login-mark">微</div>
    <p class="description">
      在微信公众平台页面中扫码，或选择账号密码登录，并在手机上完成确认。
    </p>
    <button
      class="weui-btn weui-btn_primary"
      :disabled="opening"
      @click="openLogin"
    >
      {{ opening ? '正在打开…' : waiting ? '返回微信登录窗口' : '打开微信公众平台登录' }}
    </button>
    <p
      v-if="waiting"
      class="faint"
    >
      完成登录后会自动回到工作台。关闭微信窗口可取消本次登录。
    </p>
    <p
      v-if="error || session.notice"
      class="feedback"
      :class="{ 'is-error': error || session.noticeKind === 'error' }"
      role="status"
    >
      {{ error || session.notice }}
    </p>
    <div
      v-if="session.loadError"
      class="feedback is-error"
    >
      <p>{{ session.loadError }}</p>
      <button
        class="weui-btn weui-btn_mini weui-btn_default"
        @click="loadAccounts"
      >
        重新读取账号
      </button>
    </div>
  </div>
</template>

<style scoped>
.desktop-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
  text-align: center;
}

.login-mark {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 18px;
  color: var(--brand);
  background: var(--brand-light);
  font-size: 34px;
}

.description,
.feedback {
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.desktop-login .weui-btn {
  width: 100%;
  margin: 0;
}

.faint {
  font-size: 12px;
  line-height: 1.8;
}

.is-error {
  color: #b54737;
}
</style>
