<!-- 自定义菜单手机预览：底部菜单栏按微信样式，键盘图标右侧由菜单项等分铺满；添加按钮放在手机下方，不占菜单栏 -->
<script setup>
import { Keyboard, Plus } from 'lucide-vue-next'

defineProps({
  menus: { type: Array, required: true },
  activeIndex: { type: Number, required: true },
  title: { type: String, default: '公众号' },
})
const emit = defineEmits(['select', 'add'])
</script>

<template>
  <div class="preview">
    <div class="phone">
      <div class="phone-bar">{{ title }}</div>
      <div class="phone-screen">
        <p v-if="!menus.length" class="faint phone-empty">还没有菜单，点下方“添加菜单”</p>
      </div>
      <div class="phone-menu">
        <span class="keyboard" aria-hidden="true"><Keyboard :size="18" /></span>
        <button
          v-for="(menu, index) in menus"
          :key="index"
          class="pm"
          :class="{ on: index === activeIndex }"
          @click="emit('select', index)"
        >
          <span class="pm-name">{{ menu.name || '菜单名称' }}</span>
          <ul
            v-if="index === activeIndex && menu.subs.length"
            class="pm-subs"
          >
            <li
              v-for="(sub, subIndex) in menu.subs"
              :key="subIndex"
            >
              {{ sub.name || '子菜单名称' }}
            </li>
          </ul>
        </button>
        <button
          v-if="!menus.length"
          class="pm add"
          @click="emit('add')"
        >
          <Plus :size="16" />
          <span>添加菜单</span>
        </button>
      </div>
    </div>
    <button
      v-if="menus.length && menus.length < 3"
      class="add-below"
      @click="emit('add')"
    >
      <Plus :size="14" />
      添加菜单（{{ menus.length }}/3）
    </button>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: none;
  gap: 12px;
}

.phone {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 300px;
  height: 540px;
  border: 8px solid #1f1f1f;
  border-radius: 28px;
  background: #1f1f1f;
}

.phone-bar {
  padding: 14px 16px 10px;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 20px 20px 0 0;
  background: #ededed;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
}

.phone-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  background: #ededed;
}

.phone-empty {
  padding: 0 24px;
  font-size: 12px;
  text-align: center;
}

.phone-menu {
  display: flex;
  height: 50px;
  border-top: 1px solid #dcdcdc;
  border-radius: 0 0 20px 20px;
  background: #f7f7f7;
}

.keyboard {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  flex: none;
  border-right: 1px solid #e3e3e3;
  border-bottom-left-radius: 20px;
  color: var(--text-3);
}

.pm {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  border: 0;
  border-right: 1px solid #e3e3e3;
  background: none;
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.pm:last-child {
  border-right: 0;
  border-bottom-right-radius: 20px;
}

.pm-name {
  overflow: hidden;
  padding: 0 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm.on {
  color: var(--brand);
  font-weight: 500;
  background: var(--brand-light);
}

/* 没有菜单时整条底栏是添加按钮 */
.pm.add {
  gap: 4px;
  color: var(--text-3);
}

.add-below {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.add-below:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.pm-subs {
  position: absolute;
  bottom: 58px;
  left: 4px;
  right: 4px;
  z-index: 2;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-1);
}

.pm-subs li {
  overflow: hidden;
  padding: 10px 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-subs li + li {
  border-top: 1px solid var(--border-light);
}
</style>
