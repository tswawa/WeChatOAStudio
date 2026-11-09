<!-- 发表记录：已发表文章列表，区分群发通知与仅发表、Bot 生成与手动创作，显示阅读等数据并可打开原文 -->
<script setup>
import { ref, computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { toast } from '../../store/ui.js'
import CoverThumb from '../../components/CoverThumb.vue'
import StatusTag from '../../components/StatusTag.vue'
import ApiPublicationHistory from '../../components/ApiPublicationHistory.vue'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
import { ws } from '../../store/workspace.js'
import { fmtDateTime, fmtNumber } from '../../utils/time.js'

const filter = ref('active')

const FILTERS = [
  { key: 'active', label: '已发表' },
  { key: 'all', label: '全部' },
  { key: 'mass', label: '群发通知' },
  { key: 'silent', label: '仅发表' },
  { key: 'deleted', label: '已删除' },
]

const counts = computed(() => Object.fromEntries(FILTERS.map(({ key }) => [key, filterList(key).length])))
const totals = computed(() => {
  const active = filterList('active')
  return { count: active.length, reads: active.reduce((sum, item) => sum + (Number(item.reads) || 0), 0) }
})

async function openArticle(item) {
  try {
    if (window.mpDesktop) await window.mpDesktop.openUrl(item.url)
    else window.open(item.url, '_blank', 'noopener')
  } catch (error) {
    toast(error.message || '无法打开文章', 'warn')
  }
}

function filterList(key) {
  if (key === 'active') return ws.value.published.filter((item) => !item.deleted)
  if (key === 'deleted') return ws.value.published.filter((item) => item.deleted)
  if (key === 'mass') return ws.value.published.filter((item) => !item.deleted && item.mass === true)
  if (key === 'silent') return ws.value.published.filter((item) => !item.deleted && item.mass === false)
  return ws.value.published
}

const list = computed(() => {
  if (filter.value === 'active') return ws.value.published.filter((item) => !item.deleted)
  if (filter.value === 'deleted') return ws.value.published.filter((item) => item.deleted)
  if (filter.value === 'mass') return ws.value.published.filter((item) => !item.deleted && item.mass === true)
  if (filter.value === 'silent') return ws.value.published.filter((item) => !item.deleted && item.mass === false)
  return ws.value.published
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          发表记录
        </h1>
      </div>
      <p v-if="totals.count" class="muted summary">
        已发表 {{ totals.count }} 篇 · 累计阅读 {{ fmtNumber(totals.reads) }}
      </p>
    </div>

    <ApiPublicationHistory />
    <div class="filters">
      <button
        v-for="item in FILTERS"
        :key="item.key"
        class="filter"
        :class="{ on: filter === item.key }"
        @click="filter = item.key"
      >
        {{ item.label }}<span class="count">{{ counts[item.key] }}</span>
      </button>
    </div>

    <div class="card">
      <table
        v-if="list.length"
        class="table"
      >
        <thead>
          <tr>
            <th>文章</th>
            <th>发表时间</th>
            <th>方式</th>
            <th class="num">阅读</th>
            <th class="num">点赞</th>
            <th class="num">分享</th>
            <th class="num">留言</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in list"
            :key="item.id"
          >
            <td>
              <div class="article">
                <CoverThumb
                  :cover="item.cover"
                  :width="80"
                />
                <div class="article-main">
                  <a
                    v-if="item.url && !item.deleted"
                    class="article-title"
                    :title="'打开原文：' + item.title"
                    @click="openArticle(item)"
                  >{{ item.title }}<ExternalLink :size="12" /></a>
                  <p v-else class="article-title">{{ item.title }}</p>
                  <div class="tags">
                    <StatusTag
                      v-if="item.deleted"
                      tone="danger"
                    >已删除</StatusTag>
                    <StatusTag :tone="item.origin === 'bot' ? 'info' : 'muted'">
                      {{ item.origin === 'bot' ? 'Bot 生成' : '手动创作' }}
                    </StatusTag>
                  </div>
                </div>
              </div>
            </td>
            <td class="muted">
              {{ fmtDateTime(item.at) }}
            </td>
            <td>
              <StatusTag :tone="item.mass ? 'success' : 'muted'">
                {{ item.mass == null ? '未获取' : item.mass ? '群发通知' : '仅发表' }}
              </StatusTag>
            </td>
            <td class="num">{{ fmtNumber(item.reads) }}</td>
            <td class="num">{{ fmtNumber(item.likes) }}</td>
            <td class="num">{{ fmtNumber(item.shares) }}</td>
            <td class="num">{{ fmtNumber(item.comments) }}</td>
          </tr>
        </tbody>
      </table>
      <WorkspaceEmptyState
        v-else
        section="published"
        text="没有记录"
      />
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.filter {
  padding: 4px 14px;
  border: 0;
  border-radius: 16px;
  background: #fff;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}

.filter.on {
  color: var(--brand);
  background: var(--brand-light);
}

.article {
  display: flex;
  align-items: center;
  gap: 12px;
}

.summary {
  font-size: 13px;
}

.count {
  margin-left: 6px;
  font-size: 12px;
  opacity: 0.7;
}

.article-main {
  min-width: 0;
}

.article-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  color: var(--text-1);
  font-weight: 500;
  overflow-wrap: anywhere;
}

a.article-title {
  cursor: pointer;
}

a.article-title:hover {
  color: var(--link);
}

.tags {
  display: flex;
  gap: 6px;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
