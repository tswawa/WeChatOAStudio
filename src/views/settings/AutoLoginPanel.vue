<!-- 登录失效自动登录：加密保存公众号账号密码，失效时自动提交；扫码等安全验证仍需本人完成。 -->
<script setup>
import { computed, reactive, ref } from 'vue'
import { currentAccount, refreshAccount } from '../../store/session.js'
import { desktopAccounts } from '../../services/desktop.js'
import { toast, confirmAction } from '../../store/ui.js'

const status = computed(() => currentAccount.value?.autoLogin || { saved: false })
const editing = ref(false)
const busy = ref(false)
const error = ref('')
const form = reactive({ account: '', password: '' })

function edit() {
  Object.assign(form, { account: status.value.account || '', password: '' })
  error.value = ''
  editing.value = true
}

async function save() {
  if (busy.value) return
  if (!form.account.trim() || !form.password) {
    error.value = '请填写登录邮箱或微信号和密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await desktopAccounts.saveLogin(currentAccount.value.id, { account: form.account, password: form.password })
    form.password = ''
    editing.value = false
    toast('已保存，登录失效时会自动登录')
    if (currentAccount.value.status === 'expired') await refreshAccount(currentAccount.value.id)
  } catch (cause) {
    error.value = cause.message
  } finally {
    busy.value = false
  }
}

async function forget() {
  if (!await confirmAction({ title: '关闭自动登录', message: '删除保存的账号密码？之后登录失效需手动重新登录。', confirmText: '关闭' })) return
  busy.value = true
  try {
    await desktopAccounts.forgetLogin(currentAccount.value.id)
    toast('已关闭自动登录')
  } catch (cause) {
    toast(cause.message, 'warn')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auto-login">
    <div class="head">
      <strong>登录失效后自动登录</strong>
      <span class="state" :class="{ on: status.saved && !status.failure }">
        {{ !status.saved ? '未开启' : status.failure ? '已暂停' : '已开启' }}
      </span>
    </div>
    <template v-if="!editing">
      <p v-if="status.saved" class="muted">账号 {{ status.account }}</p>
      <p v-if="status.failure" class="error">{{ status.failure }} 请更新密码后恢复。</p>
      <p class="faint">微信要求扫码或手机确认时，会打开登录窗口由你完成。</p>
      <div class="actions">
        <button class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="edit">
          {{ status.saved ? '更新密码' : '设置账号密码' }}
        </button>
        <button v-if="status.saved" class="link danger" :disabled="busy" @click="forget">关闭</button>
      </div>
    </template>
    <form v-else class="form" @submit.prevent="save">
      <input v-model.trim="form.account" class="input" autocomplete="username" placeholder="邮箱 / 微信号" :disabled="busy">
      <input v-model="form.password" class="input" type="password" autocomplete="current-password" placeholder="密码" :disabled="busy">
      <p class="faint">密码用 Windows 加密保存在本机，只用于在微信官方登录页提交。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="weui-btn weui-btn_mini weui-btn_default" :disabled="busy" @click="editing = false">取消</button>
        <button type="submit" class="weui-btn weui-btn_mini weui-btn_primary" :disabled="busy">{{ busy ? '正在保存…' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.auto-login {
  display: grid;
  gap: 10px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-light);
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.state {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-page);
  color: var(--text-2);
  font-size: 12px;
}
.state.on {
  background: var(--brand-light);
  color: var(--brand);
}
.form {
  display: grid;
  gap: 10px;
  max-width: 360px;
}
.input {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
}
.faint {
  font-size: 12px;
}
.error {
  color: #b54737;
  font-size: 13px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.actions .weui-btn {
  width: auto;
  margin: 0;
}
.link {
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.link.danger {
  color: var(--danger);
}
</style>
