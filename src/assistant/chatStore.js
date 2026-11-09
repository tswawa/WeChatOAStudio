// Project the active persistent Bot session into the desktop chat view.
import { reactive, computed } from 'vue'
import { session, accounts } from '../store/session.js'
import { uid } from '../utils/time.js'
import { greeting } from './seedChat.js'
import { ws, executeAction } from '../store/workspace.js'
import { isDesktop } from '../services/desktop.js'
import { toast } from '../store/ui.js'

const fresh = (accountId) => ({ messages: isDesktop ? [] : greeting(accountId), busy: false, focusDraftId: null })

const chats = reactive(Object.fromEntries(accounts.map((account) => [account.id, fresh(account.id)])))

export const chat = computed(() => {
  const id = session.accountId
  if (!chats[id]) chats[id] = fresh(id)
  if (isDesktop) chats[id].messages = ws.value.chatMessages || []
  return chats[id]
})

function push(accountId, item) {
  const list = chats[accountId].messages
  list.push({ id: uid('m'), at: Date.now(), ...item })
  return list[list.length - 1]
}

export const pushUser = (text) => push(session.accountId, { role: 'user', text })

export const pushBot = (text, accountId = session.accountId) => push(accountId, { role: 'bot', text })

// 卡片里的操作通过 updateCard 改写 state，聊天记录里保留处理结果
export const pushCard = (card, accountId = session.accountId) =>
  push(accountId, { role: 'card', card: { state: 'open', ...card } })

// 按消息 id 在所有会话里查找，切换公众号后仍能更新进行中的卡片
export function updateCard(messageId, patch) {
  const item = Object.values(chats)
    .flatMap((entry) => entry.messages)
    .find((entry) => entry.id === messageId)
  if (item) Object.assign(item.card, patch)
}

export function setFocusDraft(draftId) {
  chat.value.focusDraftId = draftId
}

export function clearChat() {
  if (isDesktop) {
    return executeAction('chat.session.new').then(() => {
      chat.value.focusDraftId = null
    }).catch((error) => {
      toast(error.message, 'warn')
      console.error('新建会话失败：', error)
    })
  }
  chats[session.accountId] = fresh(session.accountId)
}

export function setBusy(value) {
  chat.value.busy = value
}

export async function sendMessage(input) {
  const payload = typeof input === 'string' ? { text: input } : input
  const state = chat.value
  state.busy = true
  try {
    await executeAction('chat.send', { ...payload, focusDraftId: state.focusDraftId })
  } finally {
    state.busy = false
  }
}
