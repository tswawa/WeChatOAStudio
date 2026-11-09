// Confirmed project model capabilities; unknown models are evaluated by their actual API behavior.
const IMAGE_INPUT = Object.freeze({ 'deepseek-v4.1-flash': true, 'deepseek-v4-pro': false })

function imageInputSupport(name) {
  const id = String(name || '').trim().toLowerCase().split(':').at(-1)
  return Object.hasOwn(IMAGE_INPUT, id) ? IMAGE_INPUT[id] : null
}

function requireImageInput(name, { attachment = false } = {}) {
  if (imageInputSupport(name) !== false) return
  const error = new Error(attachment
    ? `当前模型「${name}」不支持图像输入，本次消息未发送。请切换到支持图像输入的模型后重试`
    : `当前模型「${name}」不支持图像输入，未执行视觉审核，也不会保存配图。请由作者切换到支持图像输入的模型后重试`)
  error.code = 'MODEL_IMAGE_UNSUPPORTED'
  throw error
}

module.exports = { imageInputSupport, requireImageInput }
