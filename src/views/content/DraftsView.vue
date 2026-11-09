<!-- 草稿箱：卡片列表；标记 Bot 生成/手动创作与定时状态；编辑、发表为按钮，预览、取消定时、删除收在“更多”里 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, MoreHorizontal } from 'lucide-vue-next'
import CoverThumb from '../../components/CoverThumb.vue'
import StatusTag from '../../components/StatusTag.vue'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
import { ws, db, cancelSchedule, deleteDraft } from '../../store/workspace.js'
import { openPublish, openPreview, toast, confirmAction } from '../../store/ui.js'
import { fmtDateTime } from '../../utils/time.js'
import { isDesktop } from '../../services/desktop.js'

const router = useRouter()
const filter = ref('all')
// 当前展开“更多”菜单的草稿；点菜单外任意位置收起
const menuFor = ref(null)
function outside(event) {
  if (!event.target.closest?.('.more')) menuFor.value = null
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
function menuAction(run) {
  menuFor.value = null
  run()
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'bot', label: 'Bot 生成' },
  { key: 'manual', label: '手动创作' },
  { key: 'scheduled', label: '已定时' },
]

const drafts = computed(() => {
  const list = [...ws.value.drafts].sort((a, b) => b.updatedAt - a.updatedAt)
  if (filter.value === 'scheduled') return list.filter((item) => item.scheduledAt)
  if (filter.value === 'all') return list
  return list.filter((item) => item.origin === filter.value)
})

function taskName(draft) {
  return db.tasks.find((item) => item.id === draft.taskId)?.name
}

async function remove(draft) {
  if (!await confirmAction({ title: '删除草稿', message: `删除《${draft.title || '无标题'}》？${isDesktop ? '公众平台草稿箱中的这篇也会删除，' : ''}删除后无法恢复。` })) return
  try {
    await deleteDraft(draft.id)
    toast('已删除')
  } catch (error) {
    toast(error.message, 'warn')
    console.error('删除草稿失败：', error)
  }
}

async function unschedule(draft) {
  try {
    await cancelSchedule(draft.id)
    toast(isDesktop ? '请在公众平台确认定时状态' : '已取消定时')
  } catch (error) {
    toast(error.message, 'warn')
    console.error('打开定时设置失败：', error)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          草稿箱
        </h1>
      </div>
      <button
        class="weui-btn weui-btn_mini weui-btn_primary head-btn"
        @click="router.push('/editor')"
      >
        <Plus class="icon-16" />新的创作
      </button>
    </div>

    <div class="filters">
      <button
        v-for="item in FILTERS"
        :key="item.key"
        class="filter"
        :class="{ on: filter === item.key }"
        @click="filter = item.key"
      >
        {{ item.label }}
      </button>
    </div>

    <div
      v-if="drafts.length"
      class="grid"
    >
      <article
        v-for="draft in drafts"
        :key="draft.id"
        class="draft"
      >
        <CoverThumb
          :cover="draft.cover"
          :width="268"
        />
        <div class="draft-body">
          <h3 class="draft-title">
            {{ draft.title || '无标题' }}
          </h3>
          <p class="faint draft-meta">
            {{ fmtDateTime(draft.updatedAt) }} 更新
          </p>
          <div class="tags">
            <StatusTag
              v-if="Number(draft.itemShowType) === 8"
              tone="muted"
            >贴图</StatusTag>
            <StatusTag :tone="draft.origin === 'bot' ? 'info' : 'muted'">
              {{ draft.origin === 'bot' ? 'Bot 生成' : '手动创作' }}
            </StatusTag>
            <StatusTag
              v-if="taskName(draft)"
              tone="muted"
            >
              {{ taskName(draft) }}
            </StatusTag>
            <StatusTag
              v-if="draft.scheduledAt"
              tone="warning"
            >
              {{ draft.scheduledVia === 'app' ? '到点自动发表' : '定时' }} {{ fmtDateTime(draft.scheduledAt) }}
            </StatusTag>
          </div>
        </div>
        <div class="draft-actions">
          <button
            class="weui-btn weui-btn_xmini weui-btn_default"
            @click="router.push('/editor/' + draft.id)"
          >编辑</button>
          <button
            v-if="!draft.scheduledAt"
            class="weui-btn weui-btn_xmini weui-btn_primary"
            :title="isDesktop ? '选择普通发表或群发通知' : ''"
            @click="openPublish(draft.id)"
          >发表</button>
          <div class="more">
            <button
              class="more-btn"
              title="更多"
              aria-label="更多"
              :aria-expanded="menuFor === draft.id"
              @click="menuFor = menuFor === draft.id ? null : draft.id"
            ><MoreHorizontal :size="16" /></button>
            <div v-if="menuFor === draft.id" class="menu">
              <button @click="menuAction(() => openPreview(draft.id))">预览</button>
              <button
                v-if="draft.scheduledAt"
                @click="menuAction(() => unschedule(draft))"
              >取消定时</button>
              <button class="danger" @click="menuAction(() => remove(draft))">删除</button>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div
      v-else
      class="card"
    >
      <WorkspaceEmptyState
        section="drafts"
        text="没有草稿"
      />
    </div>
  </div>
</template>

<style scoped>
.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 300px);
  gap: 16px;
}

.draft {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: #fff;
}

.draft:hover {
  box-shadow: var(--shadow-pop);
}

.draft-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}

.draft-meta {
  margin-top: 4px;
  font-size: 12px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.draft-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}

.more {
  position: relative;
  margin-left: auto;
}

.more-btn {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-2);
  cursor: pointer;
}

.more-btn:hover {
  background: var(--bg-hover);
}

.menu {
  position: absolute;
  right: 0;
  bottom: 100%;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 112px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.menu button {
  padding: 8px 10px;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.menu button:hover {
  background: var(--bg-hover);
}

.menu .danger {
  color: var(--danger);
}
</style>
