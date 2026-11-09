<!-- 菜单动作表单：为一级菜单或子菜单指定网页链接或微信网页支持的文字回复。 -->
<script setup>
import { computed } from 'vue'
import { currentAccount } from '../../store/session.js'
import { ws } from '../../store/workspace.js'

const props = defineProps({ item: { type: Object, required: true } })
// 公众平台只对已认证账号开放外部网页链接，未认证账号只能链接本公众号的文章或页面（微信返回 105）
const verified = computed(() => (ws.value.account?.verified ?? currentAccount.value?.verified) === true)
const external = computed(() => {
  if (props.item.type !== 'view' || !props.item.url) return false
  try { return new URL(props.item.url).hostname !== 'mp.weixin.qq.com' } catch { return false }
})
</script>

<template>
  <div class="menu-target">
    <select
      v-model="item.type"
      :disabled="item.readonly"
    >
      <option value="view">打开网页</option>
      <option value="text">文字回复</option>
      <option
        v-if="item.readonly"
        :value="item.type"
      >请在公众平台编辑</option>
    </select>
    <input
      v-if="item.type === 'view'"
      v-model="item.url"
      :placeholder="verified ? 'https:// 开头的网页链接' : '本公众号文章链接 https://mp.weixin.qq.com/…'"
      :disabled="item.readonly"
    >
    <input
      v-else
      v-model="item.content"
      placeholder="点击菜单后回复的文字"
      :disabled="item.readonly"
    >
  </div>
  <p v-if="external && !verified" class="link-hint">
    未认证公众号只能链接本公众号的文章或页面，外部网站链接发布时会被微信拒绝。
  </p>
</template>

<style scoped>
.menu-target {
  display: flex;
  gap: 8px;
  width: 100%;
}

input,
select {
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
}

input {
  flex: 1;
}

.link-hint {
  width: 100%;
  margin: 6px 0 0;
  color: #b35c00;
  font-size: 12px;
}
</style>
