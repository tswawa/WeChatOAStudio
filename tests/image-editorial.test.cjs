const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createOpsStore } = require('../electron/ops/store.cjs')
const { sourceMetadata, normalizeImageMetadata } = require('../electron/images/metadata.cjs')
const { removeGeneratedCaptions, migrateImageMetadata } = require('../electron/images/migrations.cjs')
const { documentFor, imageMarkup } = require('../electron/images/article.cjs')

function asset(patch = {}) {
  return { id: `img_${randomUUID()}`, title: 'A source picture', author: 'Photographer',
    sourcePage: 'https://example.com/photo', license: '来源未提供明确授权', licenseVerified: false, ...patch }
}
function legacyHtml(item) {
  const document = documentFor(imageMarkup(item))
  const caption = document.createElement('span')
  caption.appendChild(document.createTextNode(`图片：${item.author || '来源网站'} · `))
  const link = document.createElement('a')
  link.setAttribute('href', item.sourcePage)
  link.textContent = '原始来源'
  caption.appendChild(link)
  caption.appendChild(document.createTextNode(` · ${item.license || '授权待核实'}`))
  if (item.licenseUrl) {
    const license = document.createElement('a')
    license.setAttribute('href', item.licenseUrl)
    license.textContent = '许可'
    caption.appendChild(document.createTextNode(' · '))
    caption.appendChild(license)
  }
  document.querySelector('[data-oa-image-box]').appendChild(caption)
  return document.body.innerHTML
}

test('source metadata retains observed information but never invents a rights conclusion', () => {
  assert.deepEqual(sourceMetadata({}), {})
  for (const license of ['授权待核实', '来源未提供明确授权']) {
    assert.deepEqual(normalizeImageMetadata({ id: 'one', license, licenseVerified: false }), { id: 'one' })
  }
  const actual = { id: 'two', author: 'Author', license: 'custom', licenseUrl: 'https://example.com/license' }
  assert.deepEqual(normalizeImageMetadata({ ...actual, licenseVerified: true }), actual)
})

test('legacy cleanup removes only the matching generated caption and keeps authored copyright discussion and attribution', () => {
  const item = asset()
  const authored = '<p>正文讨论版权归属，并非系统授权提示。</p><p>作者自写署名：摄影师。</p><a href="https://example.com/photo">作者自选来源</a>'
  const html = legacyHtml(item) + authored
  const clean = removeGeneratedCaptions(html, id => id === item.id ? item : null)
  assert.doesNotMatch(clean, /来源未提供明确授权|原始来源/)
  assert.match(clean, /data-oa-image-id/)
  assert.match(clean, /正文讨论版权归属/)
  assert.match(clean, /作者自写署名/)
  assert.match(clean, /作者自选来源/)
  assert.equal(removeGeneratedCaptions(clean, () => item), clean)
})

test('legacy captions for actual supplied licenses are also optional, not forced into the body', () => {
  const item = asset({ license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', licenseVerified: true })
  const clean = removeGeneratedCaptions(legacyHtml(item), () => item)
  assert.doesNotMatch(clean, /CC BY|creativecommons|原始来源|Photographer/)
  assert.match(clean, /<img/)
})

test('caption cleanup leaves customized captions and unmatched or foreign image sources untouched', () => {
  const item = asset()
  const html = legacyHtml(item)
  const custom = html.replace('来源未提供明确授权', '作者自己要求的说明')
  assert.equal(removeGeneratedCaptions(custom, () => item), custom)
  assert.equal(removeGeneratedCaptions(html, () => null), html)
  assert.equal(removeGeneratedCaptions(html, () => ({ ...item, sourcePage: 'https://other.example.com/photo' })), html)
})

test('stored image cleanup is one-time, account-scoped and preserves message states, text, times and image review records', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-editorial-migration-'))
  const store = createOpsStore(path.join(directory, 'ops.sqlite'))
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  const item = asset({ review: { approved: true, model: 'current-model' }, state: 'approved', createdAt: 123 })
  store.put('images', 'a', item)
  const originalText = '历史回复：来源未提供明确授权。这是一条历史记录。'
  store.message('a', { role: 'bot', text: originalText })
  for (const state of ['open', 'cancelled', 'done', 'failed']) store.put('messages', 'a', {
    id: state, at: 456, role: 'card', text: 'Original message', card: { state, action: 'draft.create',
      payload: { title: 'Original title', html: legacyHtml(item), markdown: '作者正文及其版权讨论。',
        images: [item], imageRightsAcknowledged: false } },
  })
  const foreign = store.message('b', { role: 'card', card: { state: 'open', payload: { html: legacyHtml(item) } } })
  assert.deepEqual(migrateImageMetadata(store), { images: 1, cards: 4 })
  assert.equal(store.list('messages', 'a').length, 5)
  assert.equal(store.list('messages', 'a').find(message => message.role === 'bot').text, originalText)
  for (const state of ['open', 'cancelled', 'done', 'failed']) {
    const message = store.get('messages', 'a', state)
    assert.equal(message.at, 456)
    assert.equal(message.card.state, state)
    assert.equal(message.text, 'Original message')
    assert.equal(message.card.payload.markdown, '作者正文及其版权讨论。')
    assert.doesNotMatch(message.card.payload.html, /原始来源|来源未提供明确授权/)
    assert.equal(message.card.payload.images[0].licenseVerified, undefined)
    assert.equal(message.card.payload.imageRightsAcknowledged, undefined)
  }
  assert.equal(store.get('messages', 'b', foreign.id).card.payload.html, foreign.card.payload.html)
  const clean = store.get('images', 'a', item.id)
  assert.equal(clean.sourcePage, item.sourcePage)
  assert.equal(clean.createdAt, 123)
  assert.deepEqual(clean.review, item.review)
  assert.equal(clean.license, undefined)
  assert.deepEqual(migrateImageMetadata(store), { images: 0, cards: 0 })
})
