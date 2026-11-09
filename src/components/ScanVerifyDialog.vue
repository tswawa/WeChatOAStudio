<!-- 微信验证弹窗：发表、定时发表等操作前的扫码验证。管理员和运营者可直接验证；其他微信号扫码后需管理员通过 -->
<script setup>
import { ref, computed } from 'vue'
import QrCode from './QrCode.vue'
import DeskDialog from './DeskDialog.vue'
import { ws } from '../store/workspace.js'

const props = defineProps({
  title: { type: String, default: '微信验证' },
  purpose: { type: String, required: true },
})

const emit = defineEmits(['verified', 'cancel'])

// 演示步骤：ready 等待扫码 → scanned 已扫码待确认 → waiting_admin 等管理员通过 → done
const stage = ref('ready')
const scanner = ref(null)
const qrText = 'https://mp.weixin.qq.com/verify/' + Date.now()

const verifiers = computed(() => ws.value.members)

function simulateScan(member) {
  scanner.value = member
  stage.value = 'scanned'
}

function confirmOnPhone() {
  if (scanner.value.role === '其他') {
    stage.value = 'waiting_admin'
    return
  }
  finish()
}

function finish() {
  stage.value = 'done'
  setTimeout(() => emit('verified', scanner.value), 500)
}
</script>

<template>
  <DeskDialog
    :title="title"
    :width="560"
    stacked
    @close="emit('cancel')"
  >
    <div class="scan-body">
      <QrCode
        :text="qrText"
        :size="168"
        :state="stage === 'ready' ? 'ready' : 'scanned'"
      />
      <div class="scan-copy">
        <p class="scan-purpose">
          {{ purpose }}
        </p>
        <template v-if="stage === 'ready'">
          <p class="muted">
            请使用管理员或运营者微信扫码验证。非管理员微信号扫码后，需管理员验证通过。
          </p>
          <div class="sim">
            <span class="faint">演示：选择扫码人</span>
            <button
              v-for="member in verifiers"
              :key="member.name"
              class="weui-btn weui-btn_xmini weui-btn_default"
              @click="simulateScan(member)"
            >
              {{ member.name }}（{{ member.role }}）
            </button>
            <button
              class="weui-btn weui-btn_xmini weui-btn_default"
              @click="simulateScan({ name: '访客微信', role: '其他' })"
            >
              其他微信号
            </button>
          </div>
        </template>
        <template v-else-if="stage === 'scanned'">
          <p>{{ scanner.name }} 已扫码，请在手机微信中确认。</p>
          <button
            class="weui-btn weui-btn_mini weui-btn_primary"
            @click="confirmOnPhone"
          >
            演示：在手机上确认
          </button>
        </template>
        <template v-else-if="stage === 'waiting_admin'">
          <p>扫码人不是管理员或运营者，已发送验证申请给管理员。</p>
          <button
            class="weui-btn weui-btn_mini weui-btn_primary"
            @click="finish"
          >
            演示：管理员已通过
          </button>
        </template>
        <p
          v-else
          class="text-brand"
        >
          验证成功
        </p>
      </div>
    </div>
  </DeskDialog>
</template>

<style scoped>
.scan-body {
  display: flex;
  gap: 24px;
  padding: 8px 0 4px;
}

.scan-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  color: var(--text-1);
}

.scan-purpose {
  font-size: 15px;
  font-weight: 600;
}

.sim {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: var(--radius);
  background: var(--bg-hover);
}
</style>
