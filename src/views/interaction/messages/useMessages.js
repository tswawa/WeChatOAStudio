// 私信页共享状态：会话列表（按私信状态/未读/排序筛选）、收藏的人（公众平台“星标用户”）、搜索、当前会话的完整对话与私信设置。
// 已读取的对话和各筛选下的会话列表持久保存在本机（按公众号、联系人隔离），离开页面或重启后直接显示，
// 再在后台静默向公众平台刷新并合并新消息，不出现“正在读取”。
import { computed, reactive, ref, watch } from 'vue'
import { ws } from '../../../store/workspace.js'
import { session } from '../../../store/session.js'
import { isDesktop } from '../../../services/desktop.js'
import { invokeAction } from '../../../services/workspace.js'
import { toast } from '../../../store/ui.js'

export const TIME_RANGES = [
  { value: 7, label: '最近30天' },
  { value: 0, label: '今天' },
  { value: 1, label: '昨天' },
  { value: 2, label: '前天' },
  { value: 11, label: '3天前' },
]

export const SORTS = [
  { value: 0, label: '按时间' },
  { value: 1, label: '按赞赏总额' },
  { value: 2, label: '按留言总数' },
  { value: 3, label: '按精选留言总数' },
]

export function useMessages() {
  const view = ref('recent')
  const filter = reactive({ unread: false, day: 7, sort: 0 })
  // 每种筛选条件的会话列表都保留，切回时直接显示，后台再静默刷新
  const lists = reactive({})
  const filterKey = computed(() => `${filter.unread ? 1 : 0}-${filter.day}-${filter.sort}`)
  const filtered = computed({
    get: () => lists[filterKey.value] ?? null,
    set: (value) => { lists[filterKey.value] = value },
  })
  const listMore = ref(false)
  const settings = ref(null)
  const keyword = ref('')
  const results = ref(null)
  // 收藏的人：公众平台“星标用户”标签里的用户，会话列表和对话头部据此显示星标
  const starredUsers = ref([])
  const starredIds = computed(() => new Set(starredUsers.value.map((user) => user.id)))
  const loadingStarred = ref(false)
  const starring = ref(false)
  let starredKnown = false
  const loadingList = ref(false)
  const activeId = ref(ws.value.messages[0]?.id)
  const threads = reactive({})
  const loadingThread = ref(false)
  const loadingOlder = ref(false)
  const conversation = computed(() => threads[activeId.value] || null)

  // 默认条件直接用后台静默同步的列表；改了筛选条件或加载过更多时，改用向公众平台按条件查询的列表
  const custom = computed(() => filter.unread || filter.day !== 7 || filter.sort !== 0 || filtered.value !== null)
  const loadingMore = ref(false)
  const conversations = computed(() => custom.value ? filtered.value || [] : ws.value.messages)
  // 收藏的人：带上近期私信里的会话资料和最后一条消息，按最近私信时间排列，最近没有私信的排在后面
  const starredPeople = computed(() => starredUsers.value.map((user) => {
    const known = ws.value.messages.find((item) => item.id === user.id)
    if (known) return { ...user, ...known, user: known.user || user.user, avatar: known.avatar || user.avatar }
    const last = threads[user.id]?.items.at(-1)
    return { ...user, last: last?.content || '', at: last?.at || 0, unread: false }
  }).sort((a, b) => b.at - a.at))
  // 当前视图的列表；“已收藏私信”视图只打开收藏的人的对话
  const visible = computed(() => view.value === 'star' ? starredPeople.value : conversations.value)
  const active = computed(() => visible.value.find((item) => item.id === activeId.value)
    || (view.value === 'star' ? undefined : ws.value.messages.find((item) => item.id === activeId.value)))
  const thread = conversation
  // 对话页没有昵称或头像时（如很久没有私信的收藏的人），用列表里的资料
  const current = computed(() => {
    if (!thread.value) return active.value
    return { ...thread.value, user: thread.value.user || active.value?.user || '',
      avatar: thread.value.avatar || active.value?.avatar || '' }
  })

  // 这个页面所属的公众号；切换公众号后页面会重建，旧请求的结果不再写入
  const accountId = session.accountId
  const stale = () => session.accountId !== accountId

  async function call(action, payload, fallback) {
    if (!isDesktop) return fallback
    try {
      return await invokeAction(action, payload, accountId)
    } catch (error) {
      if (!stale()) toast(error.message, 'warn')
      return fallback
    }
  }

  // 读取本机已保存的会话列表和对话；先显示缓存，再静默刷新
  async function restore(contactId) {
    if (!isDesktop) return null
    try {
      return await invokeAction('interaction.cachedMessages', { contactId }, accountId)
    } catch (error) {
      console.warn('读取本机私信缓存失败', error.message)
      return null
    }
  }

  async function loadList() {
    const key = filterKey.value
    const query = { ...filter }
    const first = !lists[key] && (filter.unread || filter.day !== 7 || filter.sort !== 0)
    if (first) loadingList.value = true
    const value = await call('interaction.listMessages', query, null)
    if (first) loadingList.value = false
    if (!value || stale()) return
    settings.value = value.settings
    if (key !== filterKey.value) return
    listMore.value = value.hasMore
    if (query.unread || query.day !== 7 || query.sort !== 0) lists[key] = value.conversations
  }

  // 加载更多会话：时间排序按最早一条消息编号继续，其他排序按已加载数量继续
  async function loadMoreList() {
    if (loadingMore.value || !listMore.value) return
    const list = conversations.value
    const earliest = list.flatMap((item) => item.items || []).map((item) => item.id).filter((id) => /^\d+$/.test(id))
      .reduce((min, id) => (min === null || BigInt(id) < BigInt(min) ? id : min), null)
    loadingMore.value = true
    const value = await call('interaction.listMessages', { ...filter, before: earliest, offset: list.length }, null)
    loadingMore.value = false
    if (!value) return
    const known = new Set(list.map((item) => item.id))
    filtered.value = [...list, ...value.conversations.filter((item) => !known.has(item.id))]
    listMore.value = value.hasMore && value.conversations.length > 0
  }

  // 加载这个用户更早的消息，接在已加载记录之前
  async function loadOlder() {
    const current = thread.value
    if (!current?.hasMore || loadingOlder.value) return
    const id = current.id
    loadingOlder.value = true
    const value = await call('interaction.conversation', { id, before: current.items[0]?.id }, null)
    loadingOlder.value = false
    // 主进程已把更早的消息合并进本机缓存并返回完整对话
    if (value && !stale()) threads[id] = value
  }

  // 先显示本机保存的对话，再刷新最新一页；主进程把它与已保存的更早消息合并，同一条消息以最新读取的为准
  async function loadThread(id = activeId.value) {
    if (!isDesktop || !id) return
    if (!threads[id]) {
      const saved = await restore(id)
      if (saved?.thread && !threads[id] && !stale()) threads[id] = saved.thread
    }
    const first = !threads[id]
    if (first) loadingThread.value = true
    try {
      const value = await invokeAction('interaction.conversation', { id }, accountId)
      if (!stale()) threads[id] = value
    } catch (error) {
      console.warn('读取私信对话失败', error.message)
    } finally {
      if (first) loadingThread.value = false
    }
  }

  // 向公众平台读取收藏的人；本机已保存过列表时直接显示，不出现“正在读取”
  async function loadStarred() {
    if (!starredKnown) loadingStarred.value = true
    const value = await call('interaction.starredUsers', {}, null)
    loadingStarred.value = false
    if (!value || stale()) return
    starredUsers.value = value
    starredKnown = true
  }

  function showStarred() {
    view.value = 'star'
    loadStarred()
  }

  // 收藏/取消收藏一个人：把他加入或移出公众平台“星标用户”标签
  async function setStar(person, value) {
    if (starring.value) return
    starring.value = true
    const done = await call('interaction.starUser', { id: person.id, starred: value }, null)
    starring.value = false
    if (!done || stale()) return
    const others = starredUsers.value.filter((user) => user.id !== done.user.id)
    starredUsers.value = value ? [done.user, ...others] : others
    toast(value ? '已收藏' : '已取消收藏')
  }

  async function downloadMessage(message) {
    try {
      const result = await invokeAction('interaction.downloadMessageFile', { messageId: message.id }, accountId)
      if (result.saved) toast(`已保存：${result.name}`)
    } catch (error) {
      toast(error.message, 'warn')
    }
  }

  async function saveMedia(message) {
    const done = await call('interaction.saveMessageMedia', { messageId: message.id, kind: message.kind }, null)
    if (done) toast(message.kind === 'voice' ? '已保存到音频素材' : '已保存到素材库')
  }

  let searchTimer = null
  watch(keyword, (value) => {
    clearTimeout(searchTimer)
    if (!value.trim()) {
      results.value = null
      return
    }
    searchTimer = setTimeout(async () => {
      loadingList.value = true
      results.value = await call('interaction.searchMessages', { keyword: value.trim() }, [])
      loadingList.value = false
    }, 400)
  })

  watch(filterKey, () => loadList())
  // 列表正在读取时保持当前会话；读取完成后当前会话不在当前视图的列表里才换到第一个
  watch([visible, loadingList, loadingStarred], ([list, loadingRecent, loadingStar]) => {
    if ((view.value === 'star' ? loadingStar : loadingRecent) || !list.length) return
    if (!list.some((item) => item.id === activeId.value)) activeId.value = list[0].id
  })
  // 后台同步到新消息时，静默刷新已打开的对话和当前筛选列表
  watch(() => ws.value.messages, (list) => {
    if (lists[filterKey.value]) loadList()
    const latest = list.find((item) => item.id === activeId.value)
    if (latest && thread.value && latest.at > (thread.value.items.at(-1)?.at || 0)) loadThread()
  })
  watch(activeId, (id) => loadThread(id), { immediate: true })

  // 预先读取“未读”列表，首次切换也能直接显示
  async function prefetchUnread() {
    const value = await call('interaction.listMessages', { ...filter, unread: true }, null)
    if (value && !stale()) lists[`1-${filter.day}-${filter.sort}`] = value.conversations
  }

  // 恢复本机保存的各筛选列表和收藏的人后再刷新；只恢复还没有新数据的部分，避免旧缓存覆盖刚读取的结果
  restore(null).then((saved) => {
    if (stale()) return
    const { star, ...filters } = saved?.lists || {}
    if (Array.isArray(star) && !starredKnown) {
      starredUsers.value = star
      starredKnown = true
    }
    for (const [key, value] of Object.entries(filters)) {
      if (key !== '0-7-0' && !lists[key] && Array.isArray(value)) lists[key] = value
    }
  }).finally(() => loadList().then(prefetchUnread).then(loadStarred))

  return {
    view, filter, settings, keyword, results, starredPeople, starredIds, loadingStarred, starring, loadingList, activeId,
    conversation, loadingThread, loadingOlder, conversations, active, thread, current, call, loadList, loadThread,
    showStarred, setStar,
    downloadMessage, saveMedia,
    listMore, loadMoreList, loadOlder, loadingMore,
    stopSearch: () => clearTimeout(searchTimer),
  }
}
