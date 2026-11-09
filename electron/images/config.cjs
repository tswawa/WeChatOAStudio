// Download settings are user-controlled; models may only reference stored image IDs.
const path = require('node:path')

const IMAGE_DEFAULTS = { downloadDirectory: '' }

function normalizeImages(patch = {}, previous = IMAGE_DEFAULTS) {
  const result = { downloadDirectory: previous.downloadDirectory || '' }
  if (patch.downloadDirectory !== undefined) {
    if (typeof patch.downloadDirectory !== 'string') throw new Error('请选择本地图片目录')
    const value = patch.downloadDirectory.trim()
    if (value && (!path.isAbsolute(value) || /^[\\/]{2}/.test(value) || /[\0\r\n]/.test(value))) {
      throw new Error('图片目录必须是本机的绝对路径，不支持网络共享或设备路径')
    }
    result.downloadDirectory = value ? path.normalize(value) : ''
  }
  return result
}

module.exports = { IMAGE_DEFAULTS, normalizeImages }
