// 登录会话：公众号账号资料、登录方式、当前账号与多账号切换
import { reactive, computed } from 'vue'
import { desktopAccounts, isDesktop, subscribeDesktop } from '../services/desktop.js'

const STORAGE_KEY = 'mp-ops-session-v2'

const demoAccounts = [
  {
    id: 'a1',
    name: 'AI 观察日报',
    initial: 'AI',
    color: '#07c160',
    type: '公众号',
    subject: '个人',
    verified: false,
    originalId: 'gh_3f2a9c1e7b20',
    email: 'aiobserver@example.com',
    example: '每天早上 8 点整理 AI 行业资讯，9 点发',
    intro: '每天 9 点，用 5 分钟看懂 AI 行业发生了什么。',
  },
  {
    id: 'a2',
    name: '示例科技',
    initial: '示',
    color: '#2b7de9',
    type: '服务号',
    subject: '企业',
    verified: true,
    originalId: 'gh_8d1c04a5e6f3',
    email: 'ops@example-tech.com',
    example: '每周二 9 点写一篇使用技巧文章，10 点自动发',
    intro: '示例科技官方服务号，发布产品动态与使用指南。',
  },
]

export const accounts = reactive(isDesktop ? [] : demoAccounts)

export const session = reactive({
  loggedIn: false,
  accountId: null,
  signedIds: [],
  loginMethods: {},
  initialized: false,
  loadError: '',
  notice: '',
  noticeKind: 'info',
  revision: 0,
})

export const currentAccount = computed(() => accounts.find((item) => item.id === session.accountId))

export const signedAccounts = computed(() => accounts.filter((item) => session.signedIds.includes(item.id)))

export function findAccountByEmail(email) {
  return accounts.find((item) => item.email === email.trim().toLowerCase())
}

// method: 'qr' 扫码登录 | 'password' 账号密码 + 微信确认
export function loginAs(accountId, method) {
  if (isDesktop) throw new Error('请在微信公众平台完成真实登录')
  if (!session.signedIds.includes(accountId)) session.signedIds.push(accountId)
  session.loginMethods[accountId] = method
  session.accountId = accountId
  session.loggedIn = true
  persist()
}

export async function switchAccount(accountId) {
  if (isDesktop) {
    applySnapshot(await desktopAccounts.switch(accountId))
    return
  }
  session.accountId = accountId
  persist()
}

export async function logoutCurrent() {
  if (isDesktop) {
    applySnapshot(await desktopAccounts.logout(session.accountId))
    return
  }
  session.signedIds = session.signedIds.filter((id) => id !== session.accountId)
  delete session.loginMethods[session.accountId]
  session.accountId = session.signedIds[0] || null
  session.loggedIn = Boolean(session.accountId)
  persist()
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.loggedIn) Object.assign(session, saved)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    console.warn('演示登录记录无法读取：', error.message)
  }
}

function applySnapshot(snapshot) {
  accounts.splice(0, accounts.length, ...snapshot.accounts)
  const active = accounts.find((account) => account.id === snapshot.activeAccountId)
  session.accountId = active?.id || accounts[0]?.id || null
  session.loggedIn = Boolean(session.accountId)
  session.signedIds = accounts.map((account) => account.id)
  session.loadError = ''
  session.revision += 1
}

export async function refreshAccount(accountId = session.accountId) {
  applySnapshot(await desktopAccounts.refresh(accountId))
}

export async function loadAccounts() {
  try {
    applySnapshot(await desktopAccounts.list())
  } catch (error) {
    session.loadError = error.message || '无法读取账号，请重试'
    console.error('读取桌面账号失败：', error)
  }
}

let stopDesktop = null

export async function initializeSession() {
  if (session.initialized) return
  if (isDesktop) {
    stopDesktop = subscribeDesktop(applySnapshot, ({ message, kind }) => {
      session.notice = message
      session.noticeKind = kind
    })
    await loadAccounts()
  }
  session.initialized = true
}

export function disposeSession() {
  stopDesktop?.()
  stopDesktop = null
}

if (!isDesktop) restore()
