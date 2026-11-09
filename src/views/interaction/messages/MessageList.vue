<!-- 私信左栏：近期私信为搜索私信内容/用户昵称、全部/未读、筛选，以及会话或搜索结果列表；已收藏私信为收藏的人 -->
<script setup>
import { computed } from 'vue'
import { Search, X } from 'lucide-vue-next'
import WorkspaceEmptyState from '../../../components/WorkspaceEmptyState.vue'
import MessageFilter from './MessageFilter.vue'
import ConversationRow from './ConversationRow.vue'

const props = defineProps({ state: { type: Object, required: true } })
const emit = defineEmits(['open', 'open-result'])
const state = props.state
const keyword = computed({ get: () => state.keyword.value, set: (value) => { state.keyword.value = value } })
const results = computed(() => state.results.value)
const unreadCount = computed(() => state.conversations.value.filter((item) => item.unread).length)
</script>

<template>
  <aside class="message-list">
    <ul v-if="state.view.value === 'star'" class="list">
      <li v-if="state.loadingStarred.value && !state.starredPeople.value.length" class="hint">正在读取…</li>
      <li v-else-if="!state.starredPeople.value.length" class="hint">还没有收藏的人</li>
      <ConversationRow
        v-for="item in state.starredPeople.value"
        :key="item.id"
        :avatar="item.avatar"
        :name="item.user"
        :text="item.last"
        :at="item.at"
        :active="item.id === state.activeId.value"
        :unread="item.unread"
        @click="emit('open', item)"
      />
    </ul>
    <template v-else>
      <label class="search">
        <Search :size="14" />
        <input v-model="keyword" placeholder="搜索私信内容 / 用户昵称">
        <button v-if="keyword" aria-label="清除搜索" @click="keyword = ''"><X :size="13" /></button>
      </label>
      <div v-if="!results" class="filters">
        <button :class="{ on: !state.filter.unread }" @click="state.filter.unread = false">全部</button>
        <button :class="{ on: state.filter.unread }" @click="state.filter.unread = true">
          未读<span v-if="!state.filter.unread && unreadCount" class="count">{{ unreadCount }}</span>
        </button>
        <MessageFilter :filter="state.filter" />
      </div>

      <ul v-if="results" class="list">
        <li v-if="state.loadingList.value" class="hint">正在读取…</li>
        <li v-else-if="!results.length" class="hint">没有找到相关私信</li>
        <ConversationRow
          v-for="item in results"
          :key="item.id"
          :avatar="item.avatar"
          :name="item.user"
          :text="item.content"
          :at="item.at"
          :starred="state.starredIds.value.has(item.userId)"
          @click="emit('open-result', item)"
        />
      </ul>
      <WorkspaceEmptyState
        v-else-if="!state.conversations.value.length && !state.loadingList.value && !state.filter.unread"
        section="messages"
        text="最近没有私信"
        fill
      />
      <ul v-else class="list">
        <li v-if="state.loadingList.value && !state.conversations.value.length" class="hint">正在读取…</li>
        <li v-else-if="!state.conversations.value.length" class="hint">没有符合条件的私信</li>
        <ConversationRow
          v-for="item in state.conversations.value"
          :key="item.id"
          :avatar="item.avatar"
          :name="item.user"
          :text="item.last"
          :at="item.at"
          :active="item.id === state.activeId.value"
          :unread="item.unread"
          :starred="state.starredIds.value.has(item.id)"
          @click="emit('open', item)"
        />
        <li v-if="state.listMore.value" class="more">
          <button :disabled="state.loadingMore.value" @click="state.loadMoreList">
            {{ state.loadingMore.value ? '正在加载…' : '加载更多' }}
          </button>
        </li>
      </ul>
    </template>
  </aside>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  width: 300px;
  flex: none;
  border-right: 1px solid var(--border-light);
}

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 12px 8px;
  padding: 0 10px;
  border-radius: var(--radius);
  background: var(--bg-page);
  color: var(--text-3);
}

.search input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
}

.search button {
  display: inline-flex;
  border: 0;
  background: none;
  color: var(--text-3);
  cursor: pointer;
}

.filters {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px 8px;
  font-size: 13px;
}

.filters > button {
  border: 0;
  background: none;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}

.filters > button.on {
  color: var(--brand);
  font-weight: 500;
}

.count {
  margin-left: 4px;
  font-size: 12px;
}

.list {
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}

.hint {
  padding: 24px 16px;
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
}

.more {
  padding: 10px 16px 16px;
  text-align: center;
}

.more button {
  border: 0;
  background: none;
  color: var(--link);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
</style>
