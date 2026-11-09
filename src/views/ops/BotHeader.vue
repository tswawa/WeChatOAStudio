<!-- Manage the active Bot conversation without deleting archived history. -->
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { History, SquarePen, Settings, Trash2, Check, AlarmClock } from 'lucide-vue-next'

const props = defineProps({ bot: { type: Object, default: () => ({}) }, busy: Boolean })
defineEmits(['new', 'select', 'delete'])
const menuOpen = ref(false)
const root = ref(null)
// 定时任务会话固定排在最前，其余按最近使用排序
const sessions = computed(() => [...(props.bot.sessions || [])]
  .sort((a, b) => Number(b.kind === 'schedule') - Number(a.kind === 'schedule')))
const title = computed(() => props.bot.session?.kind === 'schedule' ? '定时任务记录'
  : props.bot.session?.title && props.bot.session.title !== '新会话' ? props.bot.session.title : '')
function outside(event) {
  if (!root.value?.contains(event.target)) menuOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <header ref="root" class="bot-header" @keydown.esc="menuOpen = false">
    <div class="heading">
      <h1 :title="bot.profile?.name || '公众号 Bot'">{{ bot.profile?.name || '公众号 Bot' }}</h1>
      <span v-if="title" class="session-title" :title="title">{{ title }}</span>
    </div>
    <div class="header-actions">
      <div class="history-menu">
        <button
          class="header-btn"
          title="历史会话"
          aria-label="历史会话"
          :aria-expanded="menuOpen"
          :disabled="busy"
          @click="menuOpen = !menuOpen"
        >
          <History :size="16" />历史
        </button>
        <div v-if="menuOpen" class="session-menu">
          <div v-for="item in sessions" :key="item.id" class="session-row" :class="{ current: item.id === bot.session?.id }">
            <button
              class="session-select"
              :title="item.title"
              @click="$emit('select', item.id); menuOpen = false"
            >
              <AlarmClock v-if="item.kind === 'schedule'" :size="14" class="row-icon" />
              <Check v-else-if="item.id === bot.session?.id" :size="14" class="row-icon" />
              <span v-else class="row-icon" />
              <span class="row-title">{{ item.title }}</span>
            </button>
            <button
              class="header-btn small"
              title="删除会话"
              aria-label="删除会话"
              @click="$emit('delete', item); menuOpen = false"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
      <router-link to="/bot-settings" class="header-btn" title="Bot 设置" aria-label="Bot 设置">
        <Settings :size="16" />设置
      </router-link>
      <button class="new-chat" :disabled="busy" @click="$emit('new')">
        <SquarePen :size="16" />新对话
      </button>
    </div>
  </header>
</template>

<style scoped>
.bot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  gap: 12px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--border-light);
}
.heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.bot-header h1 {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  color: var(--text-1);
  font-size: 16px;
  font-weight: 600;
}
.session-title {
  overflow: hidden;
  color: var(--text-3);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-actions,
.session-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.header-actions {
  flex: none;
}
.header-btn,
.new-chat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}
.header-btn {
  gap: 4px;
  padding: 0 10px;
}

.header-btn.small {
  width: 28px;
  padding: 0;
}
.header-btn.small {
  width: 28px;
  height: 28px;
  color: var(--text-3);
}
.new-chat {
  gap: 6px;
  margin-left: 4px;
  padding: 0 12px;
  border: 1px solid var(--border);
  color: var(--text-1);
  font-size: 13px;
}
.header-btn:hover,
.new-chat:hover {
  background: var(--bg-hover);
}
.header-btn.small:hover {
  color: var(--danger);
}
.header-btn:focus-visible,
.new-chat:focus-visible {
  outline: 2px solid #07c16066;
  outline-offset: 1px;
}
.header-btn:disabled,
.new-chat:disabled {
  opacity: 0.45;
  cursor: default;
}
.history-menu {
  position: relative;
}
.session-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 10;
  width: min(340px, 70vw);
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}
.session-row {
  min-height: 38px;
  border-radius: 6px;
}
.session-row.current,
.session-row:hover {
  background: var(--bg-hover);
}
.session-select {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 8px;
  border: 0;
  background: transparent;
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.row-icon {
  flex: none;
  width: 14px;
  color: var(--brand);
}
.row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
