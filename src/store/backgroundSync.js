// 后台静默同步：进入页面时按缓存时效读取该页数据；无论停留在哪个页面（含 Bot、Bot 设置），都定时检查新私信和新留言，
// 不在界面显示同步状态。
import { onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { refreshWorkspace, workspaceSection } from './workspace.js'
import { session, currentAccount } from './session.js'

const INTERVAL = 2 * 60 * 1000

export function useBackgroundSync() {
  const route = useRoute()
  let timer = null
  let running = false

  async function sync(force, section = workspaceSection(route.path)) {
    const accountId = session.accountId
    // 窗口最小化时也照常检查，后台运行时同样能收到新私信和留言
    if (!accountId || running) return
    running = true
    try {
      // force=false 时主进程按 60 秒缓存时效决定是否真正读取，避免重复打开公众平台页面
      await refreshWorkspace(section, { force, accountId })
    } catch (error) {
      console.warn('后台同步公众平台失败', section, error.message)
    } finally {
      running = false
    }
  }

  watch([() => route.path, () => session.accountId], () => sync(false), { immediate: true })
  watch(() => currentAccount.value?.status, (value, previous) => {
    if (value === 'ready' && previous && previous !== 'ready') void sync(true)
  })
  timer = setInterval(async () => {
    await sync(false, 'watch')
    await sync(false)
  }, INTERVAL)
  onBeforeUnmount(() => clearInterval(timer))
}
