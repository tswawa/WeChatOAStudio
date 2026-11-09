<!-- 私信设置：隐蔽关键词私信、折叠/屏蔽骚扰消息、回复前只接收一条消息、谁可以给我发私信；切换即提交 -->
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Settings } from 'lucide-vue-next'
import { toast } from '../../../store/ui.js'

const props = defineProps({
  settings: { type: Object, default: null },
  call: { type: Function, required: true },
})
const emit = defineEmits(['update'])
const open = ref(false)
const saving = ref(false)
const root = ref(null)
const SCOPES = [
  { value: 0, label: '所有人' },
  { value: 1, label: '已关注的人' },
  { value: 2, label: '已关注7天及以上的人' },
  { value: 3, label: '没有人' },
]

async function change(patch) {
  if (saving.value) return
  saving.value = true
  const value = await props.call('interaction.saveMessageSettings', patch, null)
  saving.value = false
  if (value) {
    emit('update', value)
    toast('已更新私信设置')
  }
}

function outside(event) {
  if (!root.value?.contains(event.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="message-settings">
    <button class="trigger" :aria-expanded="open" @click="open = !open">
      <Settings :size="14" />私信设置
    </button>
    <div v-if="open" class="panel">
      <p class="faint note">仅保存最近30天的私信，含图片、视频、语音等多媒体消息。</p>
      <p v-if="!settings" class="faint">正在读取设置…</p>
      <template v-else>
        <label class="row">
          <span>隐蔽关键词私信</span>
          <input
            type="checkbox"
            class="weui-switch"
            :checked="settings.hideKeywordMessages"
            :disabled="saving"
            @change="change({ hideKeywordMessages: $event.target.checked })"
          >
        </label>
        <label v-if="settings.grayFoldSpam" class="row">
          <span>折叠骚扰消息</span>
          <input
            type="checkbox"
            class="weui-switch"
            :checked="settings.foldSpam"
            :disabled="saving"
            @change="change({ foldSpam: $event.target.checked })"
          >
        </label>
        <label v-else class="row">
          <span>屏蔽骚扰消息</span>
          <input
            type="checkbox"
            class="weui-switch"
            :checked="settings.blockSpam"
            :disabled="saving"
            @change="change({ blockSpam: $event.target.checked })"
          >
        </label>
        <label class="row">
          <span>回复前只接收一条消息</span>
          <input
            type="checkbox"
            class="weui-switch"
            :checked="settings.oneMessageBeforeReply"
            :disabled="saving"
            @change="change({ oneMessageBeforeReply: $event.target.checked })"
          >
        </label>
        <p class="scope-title">谁可以给我发私信</p>
        <label
          v-for="item in SCOPES"
          :key="item.value"
          class="radio"
        >
          <input
            type="radio"
            name="message-scope"
            :checked="settings.scope === item.value"
            :disabled="saving"
            @change="change({ scope: item.value })"
          >
          {{ item.label }}
        </label>
      </template>
    </div>
  </div>
</template>

<style scoped>
.message-settings {
  position: relative;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  width: 300px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow-pop);
  font-size: 13px;
}

.note {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.scope-title {
  margin: 10px 0 6px;
  color: var(--text-2);
}

.radio {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  cursor: pointer;
}
</style>
