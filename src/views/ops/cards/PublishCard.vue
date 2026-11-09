<!-- 发表卡：要发表的草稿。已定时的显示定时时间并可取消；否则点「发表」打开发表弹窗并扫码验证 -->
<script setup>
import { computed } from 'vue'
import CoverThumb from '../../../components/CoverThumb.vue'
import { ws, cancelSchedule } from '../../../store/workspace.js'
import { openPublish, openPreview } from '../../../store/ui.js'
import { updateCard, pushBot } from '../../../assistant/chatStore.js'
import { fmtDateTime } from '../../../utils/time.js'

const props = defineProps({
  message: { type: Object, required: true },
})

const draft = computed(() => ws.value.drafts.find((item) => item.id === props.message.card.draftId))

function publish() {
  openPublish(draft.value.id, ({ mode }) => {
    updateCard(props.message.id, { state: 'confirmed' })
    pushBot(mode === 'now' ? '已发表。' : '已设置定时发表，到时间自动发出，不用再扫码。')
  })
}

function unschedule() {
  cancelSchedule(draft.value.id)
  pushBot('已取消定时，草稿还在草稿箱。')
}
</script>

<template>
  <div
    v-if="draft"
    class="pc"
  >
    <CoverThumb
      :cover="draft.cover"
      :width="96"
    />
    <div class="pc-main">
      <strong>{{ draft.title }}</strong>
      <p
        v-if="draft.scheduledAt"
        class="text-brand"
      >
        已定时 {{ fmtDateTime(draft.scheduledAt) }} 发表
      </p>
      <p
        v-if="draft.scheduledAt"
        class="faint"
      >
        {{ draft.scheduledVia === 'app' ? '到点由本应用通过开发接口发出，需保持应用运行' : '定时保存在公众平台，应用关闭也会按时发出' }}
      </p>
      <p
        v-else
        class="faint"
      >
        发表需要管理员或运营者扫码验证
      </p>
    </div>
    <div class="row-actions">
      <button
        class="weui-btn weui-btn_xmini weui-btn_default"
        @click="openPreview(draft.id)"
      >
        预览
      </button>
      <button
        v-if="draft.scheduledAt"
        class="weui-btn weui-btn_xmini weui-btn_default"
        @click="unschedule"
      >
        取消定时
      </button>
      <button
        v-else
        class="weui-btn weui-btn_xmini weui-btn_primary"
        @click="publish"
      >
        发表
      </button>
    </div>
  </div>
  <p
    v-else
    class="faint"
  >
    这篇已经发表或删除
  </p>
</template>

<style scoped>
.pc {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 480px;
  max-width: 100%;
}

.pc-main {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}
</style>
