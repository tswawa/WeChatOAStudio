<!-- 账号密码登录：输入邮箱/原始ID 和密码 → 选择验证身份的微信并在手机上确认 → 登录 -->
<script setup>
import { ref, computed } from 'vue'
import { findAccountByEmail, accounts } from '../../store/session.js'
import { db } from '../../store/workspace.js'

const emit = defineEmits(['success', 'switch-qr'])

const email = ref('')
const password = ref('')
const remember = ref(true)
const error = ref('')
const stage = ref('form')
const matched = ref(null)
const verifier = ref('')

const canSubmit = computed(() => email.value.trim() && password.value)
const verifiers = computed(() => db.data[matched.value.id].members.map((item) => `${item.name}（${item.role}）`))

function submit() {
  error.value = ''
  const account = findAccountByEmail(email.value) || accounts.find((item) => item.originalId === email.value.trim())
  if (!account || password.value.length < 6) {
    error.value = '帐号或密码错误'
    return
  }
  matched.value = account
  stage.value = 'verify'
}

function fillDemo(account) {
  email.value = account.email
  password.value = 'demo123456'
}

function sendVerify() {
  stage.value = 'confirming'
}
</script>

<template>
  <div class="pwd-login">
    <template v-if="stage === 'form'">
      <div class="field">
        <input
          v-model="email"
          class="weui-input"
          placeholder="邮箱 / 原始ID"
        >
      </div>
      <div class="field">
        <input
          v-model="password"
          class="weui-input"
          type="password"
          placeholder="密码"
          @keyup.enter="canSubmit && submit()"
        >
      </div>
      <p
        v-if="error"
        class="text-danger err"
      >
        {{ error }}
      </p>
      <div class="extra">
        <label class="remember">
          <input
            v-model="remember"
            type="checkbox"
          >记住账号
        </label>
        <a>找回账号或密码</a>
      </div>
      <button
        class="weui-btn weui-btn_primary login-btn"
        :class="{ 'weui-btn_disabled': !canSubmit }"
        :disabled="!canSubmit"
        @click="submit"
      >
        登录
      </button>
      <p class="faint demo">
        演示账号：
        <a
          v-for="account in accounts"
          :key="account.id"
          @click="fillDemo(account)"
        >{{ account.name }}</a>
      </p>
    </template>

    <template v-else>
      <p class="verify-title">
        登录「{{ matched.name }}」需要验证身份
      </p>
      <p class="muted">
        请选择验证身份的微信，验证申请会发送到对方手机微信。
      </p>
      <div class="verifiers">
        <label
          v-for="name in verifiers"
          :key="name"
          class="verifier"
          :class="{ on: verifier === name }"
        >
          <input
            v-model="verifier"
            type="radio"
            :value="name"
          >{{ name }}
        </label>
      </div>
      <button
        v-if="stage === 'verify'"
        class="weui-btn weui-btn_primary login-btn"
        :class="{ 'weui-btn_disabled': !verifier }"
        :disabled="!verifier"
        @click="sendVerify"
      >
        发送验证
      </button>
      <template v-else>
        <p class="text-brand">
          已发送，请在手机上确认登录
        </p>
        <button
          class="weui-btn weui-btn_primary login-btn"
          @click="emit('success', matched.id)"
        >
          演示：手机上已确认
        </button>
      </template>
      <a @click="stage = 'form'">返回</a>
    </template>

    <p class="switch">
      <a @click="emit('switch-qr')">扫码登录</a>
    </p>
  </div>
</template>

<style scoped>
.pwd-login {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 300px;
}

.field {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.field:focus-within {
  border-color: var(--brand);
}

.err {
  font-size: 13px;
}

.extra {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.remember {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
}

.login-btn {
  width: 100%;
  max-width: none;
}

.demo {
  display: flex;
  gap: 10px;
  font-size: 12px;
}

.verify-title {
  font-size: 16px;
  font-weight: 600;
}

.verifiers {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.verifier {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.verifier.on {
  border-color: var(--brand);
}

.verifier input {
  accent-color: var(--brand);
}

.switch {
  text-align: center;
  font-size: 13px;
}
</style>
