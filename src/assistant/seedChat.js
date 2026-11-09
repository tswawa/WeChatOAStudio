// 运营助手的开场：问候、当前账号能力说明，以及待办（例如等待扫码的文章）
import { accounts } from '../store/session.js'
import { db, apiPublishOf } from '../store/workspace.js'
import { uid } from '../utils/time.js'

export function greeting(accountId) {
  const account = accounts.find((item) => item.id === accountId)
  const api = apiPublishOf(accountId)
  const ability = api.ready
    ? '这个号已接入开发接口，我可以在你设定的时间自动发表。'
    : '这个号是' + account.subject + '主体' + (account.verified ? '' : '、未认证') +
      '，我能写好并存进草稿箱，发表时需要管理员或运营者扫码。'
  const messages = [
    {
      id: uid('m'),
      role: 'bot',
      at: Date.now(),
      text: `你好，我是「${account.name}」的运营助手。告诉我要做什么，比如“${account.example}”。${ability}`,
    },
  ]
  const waiting = db.runs.find((run) => run.accountId === accountId && run.status === 'waiting_scan')
  if (waiting) {
    messages.push({
      id: uid('m'),
      role: 'card',
      at: Date.now(),
      card: { type: 'run', runId: waiting.id, state: 'open' },
    })
  }
  return messages
}
