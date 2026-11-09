<!-- 全局确认框：删除等不可撤销操作前确认，Esc 或点遮罩为取消 -->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DeskDialog from './DeskDialog.vue'
import { ui, settleConfirm } from '../store/ui.js'

const confirmButton = ref(null)
watch(() => ui.confirm, (value) => {
  if (value) nextTick(() => confirmButton.value?.focus())
})
function onKeydown(event) {
  if (event.key === 'Escape' && ui.confirm) settleConfirm(false)
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <DeskDialog
    v-if="ui.confirm"
    :title="ui.confirm.title"
    :width="420"
    stacked
    @close="settleConfirm(false)"
  >
    <p v-if="ui.confirm.message" class="confirm-message">{{ ui.confirm.message }}</p>
    <template #footer>
      <button class="weui-btn weui-btn_mini weui-btn_default" @click="settleConfirm(false)">取消</button>
      <button
        ref="confirmButton"
        class="weui-btn weui-btn_mini"
        :class="ui.confirm.danger ? 'weui-btn_warn' : 'weui-btn_primary'"
        @click="settleConfirm(true)"
      >{{ ui.confirm.confirmText }}</button>
    </template>
  </DeskDialog>
</template>

<style scoped>
.confirm-message {
  color: var(--text-2);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
</style>
