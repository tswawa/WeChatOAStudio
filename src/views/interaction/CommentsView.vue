<!-- 留言管理：按文章展示留言，支持筛选、精选、回复 -->
<script setup>
import { ref, computed } from 'vue'
import StatusTag from '../../components/StatusTag.vue'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
import { ws, executeAction } from '../../store/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { toast } from '../../store/ui.js'
import { fmtDateTime } from '../../utils/time.js'

const filter = ref('all')
const editing = ref(null)
const replyText = ref('')

const list = computed(() => {
  if (filter.value === 'todo') return ws.value.comments.filter((item) => !item.reply)
  if (filter.value === 'featured') return ws.value.comments.filter((item) => item.featured)
  return ws.value.comments
})
// 按文章分组，文章内按留言时间倒序
const groups = computed(() => {
  const map = new Map()
  for (const comment of [...list.value].sort((a, b) => b.at - a.at)) {
    const key = comment.articleId || comment.article
    if (!map.has(key)) map.set(key, { key, article: comment.article, items: [] })
    map.get(key).items.push(comment)
  }
  return [...map.values()]
})
const counts = computed(() => ({
  all: ws.value.comments.length,
  todo: ws.value.comments.filter((item) => !item.reply).length,
  featured: ws.value.comments.filter((item) => item.featured).length,
}))

function startReply(comment) {
  editing.value = comment.id
  replyText.value = ''
}


async function send(comment) {
  if (isDesktop) {
    try {
      await executeAction('interaction.reply', {
        kind: 'comment', id: comment.id, articleId: comment.articleId, text: replyText.value.trim(),
      })
      editing.value = null
      toast('已回复')
    } catch (error) {
      toast(error.message, 'warn')
      console.error('回复留言失败：', error)
    }
    return
  }
  comment.reply = replyText.value.trim()
  editing.value = null
  toast('已回复')
}

async function feature(comment) {
  if (!isDesktop) {
    comment.featured = !comment.featured
    return
  }
  try {
    await executeAction('interaction.featureComment', {
      id: comment.id, articleId: comment.articleId, featured: !comment.featured,
    })
  } catch (error) {
    toast(error.message, 'warn')
    console.error('精选留言失败：', error)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          留言
        </h1>
      </div>
    </div>

    <div class="filters">
      <button
        v-for="item in [{ key: 'all', label: '全部' }, { key: 'todo', label: '未回复' }, { key: 'featured', label: '已精选' }]"
        :key="item.key"
        class="filter"
        :class="{ on: filter === item.key }"
        @click="filter = item.key"
      >
        {{ item.label }}<span class="count">{{ counts[item.key] }}</span>
      </button>
    </div>

    <section
      v-for="group in groups"
      :key="group.key"
      class="card"
    >
      <div class="article-title">
        <strong>《{{ group.article || '未命名文章' }}》</strong>
        <span class="faint">{{ group.items.length }} 条留言</span>
      </div>
      <div
        v-for="comment in group.items"
        :key="comment.id"
        class="comment"
      >
        <div class="c-head">
          <strong>{{ comment.user }}</strong>
          <StatusTag
            v-if="comment.featured"
            tone="success"
          >
            已精选
          </StatusTag>
          <StatusTag
            v-if="!comment.reply"
            tone="warning"
          >
            未回复
          </StatusTag>
          <span class="faint c-time">{{ fmtDateTime(comment.at) }}</span>
        </div>
        <p class="c-content">
          {{ comment.content }}
        </p>
        <p
          v-if="comment.reply"
          class="c-reply"
        >
          作者回复：{{ comment.reply }}
        </p>
        <div
          v-if="editing === comment.id"
          class="c-editor"
        >
          <textarea
            v-model="replyText"
            rows="2"
            placeholder="回复内容"
          />
          <div class="row-actions">
            <button
              class="weui-btn weui-btn_xmini weui-btn_default"
              @click="editing = null"
            >
              取消
            </button>
            <button
              class="weui-btn weui-btn_xmini weui-btn_primary"
              :disabled="!replyText.trim()"
              @click="send(comment)"
            >
              发送
            </button>
          </div>
        </div>
        <div
          v-else
          class="c-actions"
        >
          <a @click="feature(comment)">{{ comment.featured ? '取消精选' : '精选' }}</a>
          <a
            v-if="!comment.reply"
            @click="startReply(comment)"
          >回复</a>
        </div>
      </div>
    </section>
    <div
      v-if="!groups.length"
      class="card"
    >
      <WorkspaceEmptyState
        section="comments"
        :text="filter === 'all' ? '没有留言' : filter === 'todo' ? '留言都已回复' : '没有精选留言'"
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

.count {
  margin-left: 6px;
  font-size: 12px;
  opacity: 0.7;
}

.article-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.article-title strong {
  overflow-wrap: anywhere;
}

.comment {
  padding: 16px 0;
}

.comment + .comment {
  border-top: 1px solid var(--border-light);
}

.c-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.c-time {
  margin-left: auto;
}

.c-content {
  margin: 8px 0;
}

.c-reply {
  padding: 8px 12px;
  border-left: 3px solid var(--brand);
  border-radius: var(--radius);
  background: var(--bg-hover);
  color: var(--text-2);
  font-size: 13px;
}

.c-actions {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 13px;
}

.c-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.c-editor textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  resize: vertical;
}

.c-editor .row-actions {
  justify-content: flex-end;
}
</style>
