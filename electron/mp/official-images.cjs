// Reuse the public-network protections for existing WeChat media; API uploads have a 2MB limit.
const { imageSize } = require('image-size')
const { createImageNetwork } = require('../images/network.cjs')
const { normalizeRaster } = require('../images/review.cjs')
function createOfficialImageReader({ network = createImageNetwork() } = {}) {
  return async function readImage(_accountId, image) {
    let url
    try { url = new URL(image?.url || '') } catch { throw new Error('图片须先上传到公众号素材库') }
    if (!['qpic.cn','qlogo.cn','mmbizurl.cn','mp.weixin.qq.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host))) throw new Error('图片须先上传到公众号素材库')
    const value = await network.fetchBytes(url.href, { maxBytes: 8*1024*1024 })
    let type
    try { type = imageSize(value.bytes).type } catch { throw new Error('公众号图片素材无法识别') }
    if (!['png','jpg','gif','webp'].includes(type)) throw new Error('公众号图片素材格式不受支持')
    let bytes = value.bytes
    if (type === 'webp' || bytes.length > 2*1024*1024) {
      const normalized = await normalizeRaster(bytes)
      bytes = normalized.bytes; type = 'png'
      if (bytes.length > 2*1024*1024) {
        const sharp = require('sharp'), stats = await sharp(bytes).stats()
        const opaque = stats.isOpaque
        bytes = await (opaque ? sharp(bytes).resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).removeAlpha().jpeg({quality:85})
          : sharp(bytes).resize({width:700,height:700,fit:'inside',withoutEnlargement:true}).png()).toBuffer()
        type = opaque ? 'jpg' : 'png'
      }
    }
    if (!bytes.length || bytes.length > 2*1024*1024) throw new Error('公众号接口图片限制为 2MB，请缩小原图后重试')
    return { buffer:bytes,mimeType:`image/${type==='jpg'?'jpeg':type}`,filename:`image.${type}` }
  }
}
module.exports = {createOfficialImageReader}
