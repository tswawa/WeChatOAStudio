<!-- 全局轻提示：成功 1.8 秒消失；错误停留 5 秒，点击可关闭 -->
<script setup>
import { ui, closeToast } from '../store/ui.js'
</script>

<template>
  <div
    v-if="ui.toast"
    class="weui-toast toast-host"
    :class="{ warn: ui.toast.type === 'warn' }"
    :role="ui.toast.type === 'warn' ? 'alert' : 'status'"
    @click="closeToast"
  >
    <i
      class="weui-icon_toast"
      :class="ui.toast.type === 'warn' ? 'weui-icon-warn' : 'weui-icon-success-no-circle'"
    />
    <p class="weui-toast__content">
      {{ ui.toast.text }}
    </p>
  </div>
</template>

<style scoped>
.toast-host {
  z-index: 6000;
  width: auto;
  min-width: 136px;
  max-width: 360px;
  padding: 0 16px;
  cursor: pointer;
}
.toast-host.warn .weui-toast__content {
  overflow-wrap: anywhere;
}
</style>
