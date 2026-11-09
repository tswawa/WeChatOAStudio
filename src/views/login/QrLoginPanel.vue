<!-- 扫码登录：微信扫码 → 手机上选择公众号并确认 → 登录；二维码 2 分钟过期 -->
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import QrCode from '../../components/QrCode.vue'
import { accounts } from '../../store/session.js'

const emit = defineEmits(['success', 'switch-password'])

const EXPIRE_MS = 120 * 1000
const stage = ref('ready')
const qrText = ref('')
let timer = null

function refresh() {
  stage.value = 'ready'
  qrText.value = 'https://mp.weixin.qq.com/login/' + Date.now()
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (stage.value === 'ready') stage.value = 'expired'
  }, EXPIRE_MS)
}

onMounted(refresh)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="qr-login">
    <QrCode
      :text="qrText || 'loading'"
      :size="200"
      :state="stage === 'choose' ? 'scanned' : stage"
      @refresh="refresh"
    />
    <template v-if="stage === 'ready'">
      <p class="tip">
        微信扫一扫，选择公众平台账号登录
      </p>
      <button
        class="weui-btn weui-btn_xmini weui-btn_default"
        @click="stage = 'choose'"
      >
        演示：模拟扫码
      </button>
    </template>
    <template v-else-if="stage === 'expired'">
      <p class="tip">
        二维码已过期
      </p>
    </template>
    <template v-else>
      <p class="tip">
        扫码成功，请在微信中选择账号登录
      </p>
      <div class="phone-choose">
        <p class="faint">
          演示：手机上显示的可登录账号
        </p>
        <button
          v-for="account in accounts"
          :key="account.id"
          class="choose-item"
          @click="emit('success', account.id)"
        >
          <span
            class="avatar"
            :style="{ background: account.color }"
          >{{ account.initial }}</span>
          <span>{{ account.name }}</span>
          <span class="faint">{{ account.type }}</span>
        </button>
        <a @click="refresh">重新扫码</a>
      </div>
    </template>
    <p class="switch">
      <a @click="emit('switch-password')">使用账号登录</a>
    </p>
  </div>
</template>

<style scoped>
.qr-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.tip {
  color: var(--text-2);
}

.phone-choose {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 260px;
  padding: 12px;
  border-radius: var(--radius-lg);
  background: var(--bg-hover);
  text-align: center;
}

.choose-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius);
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}

.choose-item:hover {
  box-shadow: inset 0 0 0 1px var(--brand);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
}

.switch {
  margin-top: 6px;
  font-size: 13px;
}
</style>
