// 业务桥接：传递当前公众号的业务请求，并将 Vue 响应式对象转换为可序列化参数。
import { session } from '../store/session.js'

export async function invokeAction(action, payload = {}, accountId = session.accountId) {
  if (!window.mpDesktop?.invoke) throw new Error('桌面业务服务尚未启动，请重启应用')
  const value = JSON.parse(JSON.stringify(payload))
  return window.mpDesktop.invoke(action, accountId, value)
}

export function subscribeWorkspace(callback) {
  return window.mpDesktop?.onWorkspaceChanged?.(callback) || (() => {})
}

export async function uploadImage(file, accountId = session.accountId) {
  if (!file) return null
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB')
  return invokeAction('content.uploadMaterial', {
    name: file.name,
    mimeType: file.type,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    kind: 'image',
  }, accountId)
}
