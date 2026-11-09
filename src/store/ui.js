// 全局界面状态：轻提示、确认框、发表弹窗、手机预览弹窗
import { reactive } from 'vue'
import { isDesktop } from '../services/desktop.js'
import { invokeAction } from '../services/workspace.js'

export const ui = reactive({
  toast: null,
  confirm: null,
  publish: null,
  apiPublish: null,
  preview: null,
})

let toastTimer = null

// 成功提示短暂显示；错误需要读完，停留更久且可点击关闭
export function toast(text, type = 'success') {
  clearTimeout(toastTimer)
  ui.toast = { text, type }
  toastTimer = setTimeout(() => {
    ui.toast = null
  }, type === 'warn' ? 5000 : 1800)
}

export function closeToast() {
  clearTimeout(toastTimer)
  ui.toast = null
}

// 删除等不可撤销操作的统一确认，返回用户是否确认
export function confirmAction({ title, message = '', confirmText = '删除', danger = true }) {
  ui.confirm?.resolve(false)
  return new Promise((resolve) => {
    ui.confirm = { title, message, confirmText, danger, resolve }
  })
}

export function settleConfirm(value) {
  const pending = ui.confirm
  ui.confirm = null
  pending?.resolve(value)
}

// 桌面版打开独立发送确认；onDone 用于提交后跳转，网页原型沿用演示发表弹窗。
export function openPublish(draftId, onDone) {
  if (isDesktop) {
    ui.apiPublish = { draftId, onDone }
    return
  }
  ui.publish = { draftId, onDone }
}

export function closePublish() {
  ui.publish = null
}

export async function openPreview(draftId) {
  if (draftId && typeof draftId === 'object') {
    ui.preview = { draftId: draftId.id, draft: draftId }
    return
  }
  if (isDesktop) {
    try {
      const draft = await invokeAction('content.getDraft', { draftId })
      if (![0, 8].includes(Number(draft.itemShowType || 0))) {
        await invokeAction('content.openEditor', { draftId })
        return
      }
      const { ws } = await import('./workspace.js')
      const index = ws.value.drafts.findIndex((item) => item.id === draftId)
      if (index >= 0) ws.value.drafts[index] = draft
      else ws.value.drafts.push(draft)
    } catch (error) {
      toast(error.message, 'warn')
      console.error('读取预览失败：', error)
      return
    }
  }
  ui.preview = { draftId }
}

export function closePreview() {
  ui.preview = null
}
