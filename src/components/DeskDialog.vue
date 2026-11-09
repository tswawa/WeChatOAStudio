<!-- 桌面弹窗外壳：WeUI dialog 样式，标题、内容、底部按钮三个插槽；stacked 用于叠在另一个弹窗之上 -->
<script setup>
defineProps({
  title: { type: String, default: '' },
  width: { type: Number, default: 480 },
  stacked: { type: Boolean, default: false },
})

defineEmits(['close'])
</script>

<template>
  <div
    class="weui-mask"
    :class="{ stacked }"
    @click="$emit('close')"
  />
  <div
    class="weui-dialog desk-dialog"
    :class="{ stacked }"
    :style="{ width: width + 'px' }"
  >
    <div class="weui-dialog__hd dialog-hd">
      <strong class="weui-dialog__title">{{ title }}</strong>
      <button
        class="dialog-close"
        aria-label="关闭"
        @click="$emit('close')"
      >
        <i class="weui-icon-close-thin" />
      </button>
    </div>
    <div class="weui-dialog__bd dialog-bd">
      <slot />
    </div>
    <div
      v-if="$slots.footer"
      class="dialog-ft"
    >
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.weui-mask.stacked {
  z-index: 5050;
}

.weui-dialog.stacked {
  z-index: 5100;
}

.dialog-hd {
  position: relative;
  padding: 20px 24px 12px;
  text-align: left;
}

.dialog-close {
  position: absolute;
  top: 16px;
  right: 16px;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 4px;
}

.dialog-bd {
  padding: 0 24px 16px;
  color: var(--text-1);
  font-size: 14px;
}

.dialog-ft {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 24px 20px;
  border-top: 1px solid var(--border-light);
}
</style>
