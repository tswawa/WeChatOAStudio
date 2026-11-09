<!-- 公众平台入口：使用当前账号的独立登录会话打开微信官方页面。 -->
<script setup>
import { ref } from 'vue'
import { desktopAccounts } from '../services/desktop.js'
import { session } from '../store/session.js'
import { toast } from '../store/ui.js'

const opening = ref(false)

async function open() {
  if (opening.value) return
  opening.value = true
  try {
    await desktopAccounts.openPlatform(session.accountId)
  } catch (error) {
    toast(error.message || '无法打开公众平台', 'warn')
    console.error('打开公众平台失败：', error)
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <button
    class="weui-btn weui-btn_mini weui-btn_primary platform-button"
    :disabled="opening || !session.accountId"
    @click="open"
  >
    {{ opening ? '正在打开…' : '打开微信公众平台' }}
  </button>
</template>

<style scoped>
.platform-button {
  width: auto;
  margin: 0;
}
</style>
