<!-- 私信筛选：私信状态（时间范围）与排序，选项与公众平台私信页一致，选中即生效 -->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { SlidersHorizontal } from 'lucide-vue-next'
import { TIME_RANGES, SORTS } from './useMessages.js'

const props = defineProps({ filter: { type: Object, required: true } })
const open = ref(false)
const root = ref(null)
const active = computed(() => props.filter.day !== 7 || props.filter.sort !== 0)

function outside(event) {
  if (!root.value?.contains(event.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="message-filter">
    <button
      class="trigger"
      :class="{ on: active }"
      :aria-expanded="open"
      @click="open = !open"
    >
      <SlidersHorizontal :size="13" />筛选
    </button>
    <div v-if="open" class="panel">
      <p class="title">私信状态</p>
      <div class="options">
        <button
          v-for="item in TIME_RANGES"
          :key="item.value"
          :class="{ on: filter.day === item.value }"
          @click="filter.day = item.value"
        >{{ item.label }}</button>
      </div>
      <p class="title">排序</p>
      <div class="options">
        <button
          v-for="item in SORTS"
          :key="item.value"
          :class="{ on: filter.sort === item.value }"
          @click="filter.sort = item.value"
        >{{ item.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-filter {
  position: relative;
  margin-left: auto;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}

.trigger.on {
  color: var(--brand);
}

.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  width: 260px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.title {
  margin: 0 0 8px;
  color: var(--text-3);
  font-size: 12px;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.options:last-child {
  margin-bottom: 0;
}

.options button {
  padding: 3px 10px;
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: #fff;
  color: var(--text-1);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.options button.on {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-light);
}
</style>
