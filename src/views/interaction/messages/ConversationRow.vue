<!-- 私信左栏的一行：头像、昵称（收藏的人带星标）、未读、时间与最后一条消息 -->
<script setup>
import { Star } from 'lucide-vue-next'
import { fmtDateTime } from '../../../utils/time.js'

defineProps({
  avatar: { type: String, default: '' },
  name: { type: String, default: '' },
  text: { type: String, default: '' },
  at: { type: Number, default: 0 },
  active: Boolean,
  unread: Boolean,
  starred: Boolean,
})
</script>

<template>
  <li class="conv" :class="{ on: active }">
    <img v-if="avatar" :src="avatar" alt="" class="avatar" referrerpolicy="no-referrer">
    <span v-else class="avatar placeholder">{{ (name || '用').slice(0, 1) }}</span>
    <div class="conv-main">
      <div class="conv-head">
        <strong>{{ name || '公众号用户' }}</strong>
        <Star v-if="starred" :size="12" fill="currentColor" class="star" />
        <span v-if="unread" class="weui-badge weui-badge_dot" />
        <span class="faint conv-time">{{ at ? fmtDateTime(at) : '' }}</span>
      </div>
      <p class="faint conv-last">{{ text }}</p>
    </div>
  </li>
</template>

<style scoped>
.conv {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
}

.conv:hover,
.conv.on {
  background: var(--bg-hover);
}

.avatar {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 6px;
  object-fit: cover;
}

.avatar.placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-light);
  color: var(--brand);
}

.conv-main {
  flex: 1;
  min-width: 0;
}

.conv-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.conv-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.star {
  flex: none;
  color: var(--warning);
}

.conv-time {
  flex: none;
  margin-left: auto;
  font-size: 12px;
}

.conv-last {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
