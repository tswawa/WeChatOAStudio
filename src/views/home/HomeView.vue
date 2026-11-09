<!-- 首页：账号能不能用（登录状态与重新登录）、现在要处理什么（待处理）、接下来发什么（定时发表与运营任务），
     以及直接问 Bot、昨日数据和最近发表；数据在后台静默同步 -->
<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, ChevronRight, CircleAlert, Plus, ArrowUp } from 'lucide-vue-next'
import { accountStatusText, desktopAccounts, isDesktop } from '../../services/desktop.js'
import { refreshWorkspace, ws, tasksOfAccount, pendingScans, massQuota, apiPublishOf } from '../../store/workspace.js'
import { toast, openPublish } from '../../store/ui.js'
import { chat, sendMessage } from '../../assistant/chatStore.js'
import CoverThumb from '../../components/CoverThumb.vue'
import StatusTag from '../../components/StatusTag.vue'
import IncomeOverview from './IncomeOverview.vue'
import { session, currentAccount, refreshAccount } from '../../store/session.js'
import { scheduleText } from '../../store/taskModes.js'
import { fmtNumber, fmtDateTime } from '../../utils/time.js'

const router = useRouter()
const refreshing = ref(false)
const relogging = ref(false)
const question = ref('')
// 后台同步失败时才显示原因，正常同步不打扰
const syncErrors = computed(() => [...new Set(Object.entries(ws.value.errors || {}).filter(([key]) => key !== 'income').map(([,value]) => value).filter(Boolean))].join('；'))
const loginBroken = computed(() => isDesktop && ['expired', 'error'].includes(currentAccount.value?.status))

async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const result = await refreshWorkspace('home', { force: true })
    if (!Object.keys(result?.errors || {}).length) toast('已更新')
  } catch (error) {
    toast(error.message, 'warn')
  } finally {
    refreshing.value = false
  }
}

async function loginAgain() {
  if (relogging.value) return
  relogging.value = true
  try {
    if (currentAccount.value.status === 'error') await refreshAccount(session.accountId)
    else await desktopAccounts.login(session.accountId)
  } catch (error) {
    toast(error.message || '无法打开登录窗口', 'warn')
  } finally {
    relogging.value = false
  }
}

const quota = computed(() => massQuota(session.accountId))
const api = computed(() => apiPublishOf(session.accountId))
const unreadMessages = computed(() => ws.value.messages.filter((item) => item.unread).length)
const unrepliedComments = computed(() => ws.value.comments.filter((item) => !item.reply).length)
const recentPublished = computed(() => ws.value.published.filter((item) => !item.deleted).slice(0, 3))

// 待处理：每项一行，点整行直接去处理
const todos = computed(() => {
  const list = pendingScans.value.map((run) => {
    const draft = ws.value.drafts.find((item) => item.id === run.draftId)
    return { key: run.id, text: `「${draft?.title || '文章'}」已写好，等待扫码发表`, tone: 'warn',
      run: () => openPublish(run.draftId) }
  })
  if (unreadMessages.value) {
    list.push({ key: 'msg', text: `${unreadMessages.value} 位用户的私信未读`, run: () => router.push('/messages') })
  }
  if (unrepliedComments.value) {
    list.push({ key: 'cmt', text: `${unrepliedComments.value} 条留言未回复`, run: () => router.push('/comments') })
  }
  return list
})

// 接下来：已定时的稿件在前（按时间先后），再列运营任务
const upcoming = computed(() => [
  ...ws.value.drafts.filter((item) => item.scheduledAt).sort((a, b) => a.scheduledAt - b.scheduledAt)
    .map((item) => ({ key: `d${item.id}`, title: item.title || '无标题',
      meta: `定时发表 · ${fmtDateTime(item.scheduledAt)}`, tag: '', run: () => router.push('/drafts') })),
  ...tasksOfAccount.value.map((task) => ({ key: `t${task.id}`, title: task.name, meta: scheduleText(task.schedule),
    tag: task.enabled ? '' : '已暂停', run: () => router.push('/tasks') })),
])

// 直接问 Bot：发出后切到 Bot 页看回复；模型没连好时先去设置
const botReady = computed(() => !isDesktop
  || Boolean(ws.value.bot?.model?.name && ws.value.settings?.model?.apiKeyConfigured))
const botBusy = computed(() => chat.value.busy || ws.value.bot?.busy)

async function ask() {
  if (!botReady.value) {
    router.push('/bot-settings')
    return
  }
  const text = question.value.trim()
  if (!text || botBusy.value) return
  question.value = ''
  router.push('/bot')
  try {
    await sendMessage(text)
  } catch (error) {
    toast(error.message, 'warn')
  }
}
</script>

<template>
  <div class="page home-page">
    <div v-if="loginBroken" class="login-bar">
      <CircleAlert :size="16" />
      <span v-if="currentAccount.status === 'expired'">微信已确认需要重新登录，请完成微信验证。</span>
      <span v-else>暂时无法验证微信会话，稍后会自动重试。</span>
      <button class="weui-btn weui-btn_mini weui-btn_primary" :disabled="relogging" @click="loginAgain">
        {{ relogging ? '正在验证…' : currentAccount.status === 'expired' ? '重新登录' : '重新验证' }}
      </button>
    </div>

    <section class="card profile">
      <span class="avatar" :style="{ background: currentAccount.color }">{{ currentAccount.initial }}</span>
      <div class="profile-main">
        <h1 class="profile-name">
          {{ currentAccount.name }}
          <span class="type">{{ currentAccount.type }}</span>
        </h1>
        <div v-if="isDesktop" class="account-state">
          <span class="state-dot" :class="currentAccount.status" />
          <span>{{ accountStatusText(currentAccount.status) }}</span>
          <button class="refresh" :disabled="refreshing" title="立即从公众平台更新" @click="refreshNow">
            <RefreshCw :size="13" :class="{ spinning: refreshing }" />{{ refreshing ? '正在更新' : '更新数据' }}
          </button>
        </div>
        <p v-else class="muted">{{ currentAccount.intro }}</p>
        <p v-if="isDesktop && syncErrors && !loginBroken" class="sync-error">{{ syncErrors }}</p>
      </div>
      <dl class="profile-stats">
        <div>
          <dt>总用户数</dt>
          <dd>{{ fmtNumber(ws.followers) }}</dd>
        </div>
        <div>
          <dt>群发通知剩余</dt>
          <dd>{{ quota.left }}<small>/{{ quota.total }} {{ quota.period }}</small></dd>
        </div>
        <div>
          <dt>发表方式</dt>
          <dd class="small">{{ api.ready ? '接口自动发表' : '扫码发表' }}</dd>
        </div>
      </dl>
    </section>

    <IncomeOverview :income="ws.income" :loading="(ws.syncingSections || []).includes('income')" :loaded="!isDesktop || Boolean(ws.loaded)" />

    <form class="card ask" @submit.prevent="ask">
      <input v-model="question" maxlength="500" placeholder="让 Bot 帮你写一篇、回复留言或看看数据…">
      <button
        class="weui-btn weui-btn_mini weui-btn_primary"
        type="submit"
        :disabled="botReady && (!question.trim() || botBusy)"
      >
        <ArrowUp v-if="botReady" :size="15" />{{ botReady ? '发送' : '先连接模型' }}
      </button>
    </form>

    <div class="grid">
      <section class="card">
        <div class="card-title">
          待处理
          <span v-if="todos.length" class="weui-badge">{{ todos.length }}</span>
        </div>
        <button v-for="todo in todos" :key="todo.key" class="row" :class="todo.tone" @click="todo.run">
          <span class="row-text">{{ todo.text }}</span>
          <ChevronRight :size="16" class="chevron" />
        </button>
        <p v-if="!todos.length" class="empty">都处理完了</p>
      </section>

      <section class="card">
        <div class="card-title">
          接下来
          <button class="weui-btn weui-btn_xmini weui-btn_default title-btn" @click="router.push('/editor')">
            <Plus :size="13" />新的创作
          </button>
        </div>
        <button v-for="item in upcoming" :key="item.key" class="row" @click="item.run">
          <span class="row-text">
            {{ item.title }}
            <span class="faint small-text">{{ item.meta }}</span>
          </span>
          <StatusTag v-if="item.tag" tone="muted">{{ item.tag }}</StatusTag>
          <ChevronRight :size="16" class="chevron" />
        </button>
        <p v-if="!upcoming.length" class="empty">
          还没有安排，<router-link to="/bot">让 Bot 建一个运营任务</router-link>
        </p>
      </section>
    </div>

    <div class="grid">
      <section class="card">
        <div class="card-title">
          昨日数据
          <router-link to="/data" class="more">详情</router-link>
        </div>
        <dl class="kpis">
          <div>
            <dt>阅读</dt>
            <dd>{{ fmtNumber(ws.yesterday.reads) }}</dd>
          </div>
          <div>
            <dt>分享</dt>
            <dd>{{ fmtNumber(ws.yesterday.shares) }}</dd>
          </div>
          <div>
            <dt>新关注</dt>
            <dd>{{ fmtNumber(ws.yesterday.newFollowers) }}</dd>
          </div>
          <div>
            <dt>取消关注</dt>
            <dd>{{ fmtNumber(ws.yesterday.lost) }}</dd>
          </div>
        </dl>
      </section>

      <section class="card">
        <div class="card-title">
          最近发表
          <router-link to="/published" class="more">全部</router-link>
        </div>
        <div v-for="item in recentPublished" :key="item.id" class="pub">
          <CoverThumb :cover="item.cover" :width="64" />
          <div class="pub-main">
            <p class="pub-title">{{ item.title }}</p>
            <p class="faint small-text">{{ fmtDateTime(item.at) }} · 阅读 {{ fmtNumber(item.reads) }}</p>
          </div>
        </div>
        <p v-if="!recentPublished.length" class="empty">还没有发表记录</p>
      </section>
    </div>
  </div>
</template>

<style scoped src="./HomeView.css"></style>
