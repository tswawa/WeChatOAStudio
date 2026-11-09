// Remove only identifiable application-generated captions and metadata, not author prose.
const { documentFor, IMAGE_ID } = require('./article.cjs')
const { normalizeImageMetadata } = require('./metadata.cjs')
const normalized = value => String(value).replace(/\s+/g, ' ').trim()

function removeGeneratedCaptions(html, resolveAsset) {
  if (typeof html !== 'string' || !html.includes('data-oa-image-box')) return html
  const document = documentFor(html)
  let changed = false
  for (const box of document.querySelectorAll('[data-oa-image-box]')) {
    const id = box.getAttribute('data-oa-image-box')
    if (!IMAGE_ID.test(id || '')) continue
    const asset = resolveAsset(id)
    if (!asset || box.firstElementChild?.getAttribute('data-oa-image-id') !== id) continue
    const expectedText = `图片：${asset.author || '来源网站'} · 原始来源 · ${asset.license || '授权待核实'}${asset.licenseUrl ? ' · 许可' : ''}`
    const expectedLinks = [asset.sourcePage, ...(asset.licenseUrl ? [asset.licenseUrl] : [])]
    for (const caption of [...box.children].filter(node => node.tagName === 'SPAN')) {
      const links = [...caption.children]
      if (normalized(caption.textContent) !== normalized(expectedText) || links.length !== expectedLinks.length
        || !links.every((link, index) => link.tagName === 'A' && link.getAttribute('href') === expectedLinks[index])) continue
      caption.remove()
      changed = true
    }
  }
  return changed ? document.body.innerHTML : html
}

function migrateImageMetadata(store) {
  const images = store.all('images')
  const messages = store.all('messages').filter(item => item.card?.payload)
  const accounts = new Set([...images, ...messages].map(item => item.accountId))
  const result = { images: 0, cards: 0 }
  for (const accountId of accounts) store.transaction(() => {
    if (!store.claimMarker(accountId, 'image-editorial-defaults-removed-v1')) return
    for (const message of messages.filter(item => item.accountId === accountId)) {
      const before = JSON.stringify(message.card.payload)
      const payload = message.card.payload
      for (const field of ['html', 'markdown']) {
        if (typeof payload[field] === 'string') payload[field] = removeGeneratedCaptions(payload[field],
          id => store.get('images', accountId, id))
      }
      if (Array.isArray(payload.images)) payload.images = payload.images.map(normalizeImageMetadata)
      delete payload.imageRightsAcknowledged
      if (JSON.stringify(payload) === before) continue
      store.put('messages', accountId, message)
      result.cards += 1
    }
    for (const image of images.filter(item => item.accountId === accountId)) {
      const clean = normalizeImageMetadata(image)
      if (JSON.stringify(clean) === JSON.stringify(image)) continue
      store.put('images', accountId, clean)
      result.images += 1
    }
  })
  return result
}

module.exports = { removeGeneratedCaptions, migrateImageMetadata }
