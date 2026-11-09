// Template examples are stored locally, never uploaded to WeChat while authoring a template.
const { inspectRaster, normalizeRaster } = require('../images/review.cjs')
const { publicImageUrl } = require('../images/network.cjs')
const MAX_TEMPLATE_HTML = 16 * 1024 * 1024

function templateImageSource(value) {
  const source = String(value || '').trim()
  if (source.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
    if (!match || match[2].length > 12 * 1024 * 1024) throw new Error('模板图片必须是有效的 JPG、PNG 或 WebP')
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.toString('base64') !== match[2]) throw new Error('模板图片编码无效')
    inspectRaster(bytes, match[1])
    return source
  }
  return publicImageUrl(source).href
}

async function prepareTemplateImage(input, normalizer = normalizeRaster) {
  if (!Array.isArray(input.bytes) || !input.bytes.length || input.bytes.length > 8 * 1024 * 1024
    || input.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('模板图片大小必须在 8MB 以内')
  const image = await normalizer(Buffer.from(input.bytes), String(input.mimeType || '').toLowerCase())
  if (image.bytes.length > 8 * 1024 * 1024) throw new Error('模板图片过大，请缩小后重试')
  return { src: `data:image/png;base64,${image.bytes.toString('base64')}`, width: image.width, height: image.height,
    alt: String(input.name || '范文配图').replace(/\.[a-z0-9]+$/i, '').slice(0, 200) }
}

module.exports = { MAX_TEMPLATE_HTML, templateImageSource, prepareTemplateImage }
