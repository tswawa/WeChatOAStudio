// Only approved, account-scoped image references may enter Bot-generated article HTML.
const { parseHTML } = require('linkedom')
const { randomUUID } = require('node:crypto')

const ID = /^img_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const previewUrl = id => `mp-ops://app/images/${id}.png`
function imageId(value) {
  const text = String(value || '')
  if (text.startsWith('oa-image:') && ID.test(text.slice(9))) return text.slice(9)
  const match = /^mp-ops:\/\/app\/images\/(img_[0-9a-f-]+)\.png$/i.exec(text)
  return match && ID.test(match[1]) ? match[1] : null
}
function documentFor(html = '') {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document
}

function imageMarkup(asset, alt = '') {
  const document = documentFor()
  const image = document.createElement('img')
  image.setAttribute('src', asset.existing ? asset.url : previewUrl(asset.id))
  image.setAttribute('alt', String(alt || asset.review?.description || asset.title || '').slice(0, 200))
  image.setAttribute('style', 'display:block;max-width:100%;height:auto;margin:0 auto;')
  if (asset.existing) return image.outerHTML
  image.setAttribute('data-oa-image-id', asset.id)
  const wrapper = document.createElement('span')
  wrapper.setAttribute('data-oa-image-box', asset.id)
  wrapper.setAttribute('style', 'display:block;margin:18px 0;')
  wrapper.appendChild(image)
  return wrapper.outerHTML
}

function htmlImagePlaceholders(html, resolveImage) {
  const document = documentFor(html)
  const replacements = new Map()
  const replace = (element, source, alt) => {
    const asset = resolveImage(source)
    const key = randomUUID()
    replacements.set(key, imageMarkup(asset, alt))
    const placeholder = document.createElement('span')
    placeholder.setAttribute('data-oa-image-placeholder', key)
    element.replaceWith(placeholder)
  }
  for (const box of document.querySelectorAll('[data-oa-image-box]')) {
    const image = box.querySelector('img')
    if (image && ID.test(box.getAttribute('data-oa-image-box') || '')) {
      replace(image, `oa-image:${box.getAttribute('data-oa-image-box')}`, image.getAttribute('alt'))
      box.removeAttribute('data-oa-image-box')
    }
  }
  for (const image of document.querySelectorAll('img')) {
    const id = image.getAttribute('data-oa-image-id')
    replace(image, id && ID.test(id) ? `oa-image:${id}` : image.getAttribute('src'), image.getAttribute('alt'))
  }
  return { html: document.body.innerHTML, replacements }
}

function restoreHtmlImages(html, replacements) {
  const document = documentFor(html)
  for (const element of document.querySelectorAll('[data-oa-image-placeholder]')) {
    const markup = replacements.get(element.getAttribute('data-oa-image-placeholder'))
    if (!markup) { element.remove(); continue }
    const fragment = document.createElement('template')
    fragment.innerHTML = markup
    element.replaceWith(fragment.content)
  }
  return document.body.innerHTML
}

function references(html) {
  return [...new Set([...documentFor(html).querySelectorAll('img[data-oa-image-id]')]
    .map(image => image.getAttribute('data-oa-image-id')))]
}

function removeImage(html, id) {
  const document = documentFor(html)
  for (const image of document.querySelectorAll('img[data-oa-image-id]')) {
    if (image.getAttribute('data-oa-image-id') !== id) continue
    const box = image.closest('[data-oa-image-box]')
    if (box?.getAttribute('data-oa-image-box') === id) box.remove()
    else image.remove()
  }
  return document.body.innerHTML
}

function existingImages(html) {
  return new Set([...documentFor(html).querySelectorAll('img[src]')].map(image => image.getAttribute('src')).filter(src => {
    try {
      const url = new URL(src)
      return url.protocol === 'https:' && !url.username && !url.password
        && /(^|\.)(qpic|qlogo)\.cn$/.test(url.hostname)
    } catch { return false }
  }))
}

module.exports = { IMAGE_ID: ID, imageId, previewUrl, imageMarkup, documentFor, htmlImagePlaceholders,
  restoreHtmlImages, references, removeImage, existingImages }
