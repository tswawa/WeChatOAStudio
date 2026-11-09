<!-- 二维码：根据文本生成，可叠加「已扫码」「已过期」遮罩 -->
<script setup>
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'

const props = defineProps({
  text: { type: String, required: true },
  size: { type: Number, default: 180 },
  state: { type: String, default: 'ready' },
})

defineEmits(['refresh'])

const dataUrl = ref('')

watchEffect(async () => {
  dataUrl.value = await QRCode.toDataURL(props.text, { width: props.size * 2, margin: 1 })
})
</script>

<template>
  <div
    class="qr"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <img
      v-if="dataUrl"
      :src="dataUrl"
      alt="二维码"
    >
    <div
      v-if="state === 'scanned'"
      class="qr-mask"
    >
      <i class="weui-icon-success weui-icon_msg" />
      <span>扫码成功</span>
    </div>
    <div
      v-else-if="state === 'expired'"
      class="qr-mask"
    >
      <span>二维码已过期</span>
      <a @click="$emit('refresh')">点击刷新</a>
    </div>
  </div>
</template>

<style scoped>
.qr {
  position: relative;
  flex: none;
}

.qr img {
  width: 100%;
  height: 100%;
  display: block;
}

.qr-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.94);
  font-size: 15px;
}
</style>
