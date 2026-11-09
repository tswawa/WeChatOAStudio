// 桌面桥接：向主进程请求账号操作，前端只接收账号资料和会话状态。
const bridge = window.mpDesktop

export const isDesktop = Boolean(bridge)

export const desktopAccounts = {
  list: () => bridge.accounts.list(),
  login: (accountId) => bridge.accounts.login(accountId),
  switch: (accountId) => bridge.accounts.switch(accountId),
  logout: (accountId) => bridge.accounts.logout(accountId),
  refresh: (accountId) => bridge.accounts.refresh(accountId),
  openPlatform: (accountId) => bridge.accounts.openPlatform(accountId),
  saveLogin: (accountId, value) => bridge.accounts.saveLogin(accountId, value),
  forgetLogin: (accountId) => bridge.accounts.forgetLogin(accountId),
}

export function subscribeDesktop(onAccounts, onStatus) {
  if (!isDesktop) return () => {}
  const stopAccounts = bridge.onAccountsChanged(onAccounts)
  const stopStatus = bridge.onStatus(onStatus)
  return () => {
    stopAccounts()
    stopStatus()
  }
}

export function accountStatusText(status) {
  return {
    ready: '已登录',
    checking: '正在验证登录状态',
    expired: '登录已失效',
    error: '暂时无法验证',
  }[status] || '等待验证'
}

export function accountDescription(account) {
  const details = [account.type, account.subject]
  if (account.verified === true) details.push('已认证')
  if (account.verified === false) details.push('未认证')
  return details.filter(Boolean).join(' · ') || '公众号资料待确认'
}
