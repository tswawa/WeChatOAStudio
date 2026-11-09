// Search, review and store article images. WeChat writes require current author authorization.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { createImageNetwork } = require('./network.cjs')
const { normalizeRaster, reviewImage } = require('./review.cjs')
const { normalizeImages } = require('./config.cjs')
const { IMAGE_ID, imageId, previewUrl, references, documentFor } = require('./article.cjs')
const { createMemory } = require('../bot/memory.cjs')
const { createSearchRouter } = require('../ops/search.cjs')
const { requireImageInput } = require('../bot/capabilities.cjs')
const { sourceMetadata, normalizeImageMetadata } = require('./metadata.cjs')
const { migrateImageMetadata } = require('./migrations.cjs')
const { readImageSource } = require('./sources.cjs')

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, file) => { const value = path.relative(root, file); return value && !value.startsWith('..') && !path.isAbsolute(value) }

function createImageService({ store, settings, mp, defaultDirectory = '', getProxy,
  network = createImageNetwork({ getProxy }), searcher, reviewer = reviewImage, normalizer = normalizeRaster, readAttachment }) {
  migrateImageMetadata(store)
  const searchImages = searcher || createSearchRouter({ settings, network }).images
  const preparing = new Map()
  const saving = new Map()
  const memory = createMemory(store)
  let closed = false

  function directory() {
    const value = settings.private().images?.downloadDirectory || defaultDirectory
    const normalized = normalizeImages({ downloadDirectory: value }).downloadDirectory
    if (!normalized) throw new Error('请先在 Bot 设置中选择本地配图目录')
    return normalized
  }
  function requireAsset(accountId, id) {
    if (!IMAGE_ID.test(String(id || ''))) throw new Error('图片编号无效')
    const item = store.get('images', accountId, id)
    if (!item || item.state !== 'approved' || item.review?.approved !== true) throw new Error('这张图片未通过审核或不属于当前公众号')
    return item
  }
  function publicAsset(item) {
    return { id: item.id, title: item.title, previewUrl: previewUrl(item.id), sourcePage: item.sourcePage,
      author: item.author, ...sourceMetadata(item),
      width: item.width, height: item.height, bytes: item.bytes,
      review: { description: item.review.description, reason: item.review.reason, model: item.review.model,
        reviewedAt: item.review.reviewedAt } }
  }
  function resolve(accountId, reference, existing = new Set()) {
    const id = imageId(reference)
    if (id) return requireAsset(accountId, id)
    if (existing.has(reference)) return { existing: true, url: reference }
    throw new Error('正文新图片必须先从原始来源、图片直链或搜索结果读取并通过视觉审核，再使用返回的图片编号插入，不能编造图片网址')
  }
  function manifest(accountId, html, cover) {
    const ids = references(html)
    if (cover?.assetId && !ids.includes(cover.assetId)) ids.push(cover.assetId)
    return ids.map(id => publicAsset(requireAsset(accountId, id)))
  }

  async function search(accountId, input, context = {}) {
    const { signal } = context
    if (closed) throw new Error('应用正在关闭')
    const items = await searchImages(network, input.query, input.limit, signal, { ...context, accountId })
    signal?.throwIfAborted()
    return registerCandidates(accountId, items, input.query)
  }

  function registerCandidates(accountId, items, query = '') {
    return items.map(item => {
      const record = store.put('images', accountId, { ...normalizeImageMetadata(item), id: `img_${randomUUID()}`,
        state: 'candidate', query, createdAt: Date.now() })
      return { id: record.id, title: record.title, imageUrl: record.imageUrl, sourcePage: record.sourcePage, ...sourceMetadata(record),
        provider: record.provider, detailPage: record.detailPage || '', extraction: record.extraction || '',
        originalWidth: record.originalWidth, originalHeight: record.originalHeight,
        searchDiagnostics: record.searchDiagnostics, searchAssessment: record.searchAssessment,
        unavailableSources: record.unavailableSources || [],
        ...(record.fallbackReason ? { fallbackReason: record.fallbackReason, nativeSupportCheckedAt: record.nativeSupportCheckedAt } : {}),
        note: record.origin === 'source' || record.origin === 'direct'
          ? '已从指定来源取得真实图片地址，无需搜索引擎收录；尚未视觉审核或本地保存'
          : '这是搜索结果，尚未下载保存，也未完成视觉审核' }
    })
  }

  async function fromSources(accountId, input, { signal, progress } = {}) {
    if (closed) throw new Error('应用正在关闭')
    if (!Array.isArray(input.urls) || !input.urls.length) throw new Error('请提供实际的网页、README 或图片链接')
    const limit = input.limit ?? Infinity
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('候选数量必须是正整数')
    const found = [], failures = [], sources = []
    for (const url of input.urls) {
      signal?.throwIfAborted()
      progress?.('正在读取指定来源的原始配图')
      try {
        const page = await readImageSource(network, url, { signal, limit })
        signal?.throwIfAborted()
        const candidates = registerCandidates(accountId, page.images, url)
        found.push(...candidates)
        sources.push({ url, finalUrl: page.finalUrl, title: page.title, imageCount: candidates.length,
          links: page.links, diagnostics: page.diagnostics })
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        failures.push({ url, reason: error.message })
      }
    }
    if (!sources.length) throw new Error(`指定图片来源读取失败：${failures.map(item => item.reason).join('；')}`)
    return { images: found, sources, failures,
      note: found.length ? '可使用以上编号进行视觉审核；指定来源读取不是关键词搜索，不要求搜索引擎收录'
        : '本次响应没有提取到图片地址，不代表页面没有图片，也不能据此推断需要登录；可继续读取 sources 中实际发现的详情链接或公开接口。' }
  }

  async function fromAttachment(accountId, input, context = {}) {
    if (!readAttachment) throw new Error('当前环境未启用聊天图片')
    const value = await readAttachment(accountId, input.attachmentId)
    if (value.record.kind !== 'image') throw new Error('该附件不是图片')
    const [candidate] = registerCandidates(accountId, [{ attachmentId: input.attachmentId, title: value.name, sourcePage: '', origin: 'attachment', provider: '作者附件' }])
    return prepare(accountId, { id: candidate.id, topic: input.topic }, context)
  }

  function prepare(accountId, input, options = {}) {
    const config = (options.settings || settings).private()
    const key = hash(JSON.stringify([accountId,input.id,input.topic,options.text || '',config.model,config.bot]))
    if (!preparing.has(key)) {
      const pending = prepareImage(accountId, input, options).finally(() => preparing.delete(key))
      preparing.set(key, pending)
    }
    return preparing.get(key)
  }

  async function saveFile(filename, bytes, sha256, signal) {
    if (!saving.has(filename)) {
      const pending = (async () => {
        const existing = await fs.lstat(filename).catch(error => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (existing) {
          if (existing.isSymbolicLink() || existing.size !== bytes.length || hash(await fs.readFile(filename)) !== sha256) {
            throw new Error('本地同名图片的内容异常，已停止保存')
          }
          return
        }
        const temporary = path.join(path.dirname(filename), `.${sha256}.${randomUUID()}.tmp`)
        try {
          await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
          signal?.throwIfAborted()
          await fs.rename(temporary, filename)
        } finally { await fs.unlink(temporary).catch(() => {}) }
      })().finally(() => saving.delete(filename))
      saving.set(filename, pending)
    }
    await saving.get(filename)
    signal?.throwIfAborted()
  }

  async function prepareImage(accountId, input, { signal, settings: turnSettings = settings,
    beforeModelCall, progress, text = '' } = {}) {
    if (closed) throw new Error('应用正在关闭')
    if (!IMAGE_ID.test(String(input.id || ''))) throw new Error('请使用来源读取或搜图返回的真实图片编号')
    const item = store.get('images', accountId, input.id)
    if (!item) throw new Error('图片候选不存在或不属于当前公众号，请重新读取来源或搜图')
    if (typeof input.topic !== 'string' || !input.topic.trim()) throw new Error('请说明这张配图对应的文章主题和段落内容')
    const config = turnSettings.private()
    requireImageInput(config.model.name)
    const authorPreferences = { authorInstructions: config.bot?.instructions || '',
      authorMemories: config.bot?.memoryEnabled === false ? '' : memory.context(accountId, input.topic.trim(), 1800),
      authorRequest: String(text) }
    const policyHash = hash(JSON.stringify(authorPreferences))
    if (item.state === 'approved') {
      if (item.review.policyHash !== policyHash) throw new Error('作者规则或相关记忆已变化，请重新搜图并按当前偏好审核')
      if (item.topic !== input.topic.trim()) throw new Error('这张图片已按其他主题审核，请为新主题重新搜图审核')
      await file(accountId, item.id)
      return { ...publicAsset(item), markdown: `![${item.review.description.slice(0, 100).replace(/[\[\]\\\r\n]/g, ' ')}](oa-image:${item.id})` }
    }
    if (!['candidate','rejected'].includes(item.state)) throw new Error('这条图片候选状态无效，请重新读取来源')
    const root = directory()
    signal?.throwIfAborted()
    progress?.('正在安全读取候选图片')
    const downloaded = item.attachmentId ? await readAttachment(accountId, item.attachmentId) : await network.fetchBytes(item.imageUrl, { signal })
    signal?.throwIfAborted()
    const image = await normalizer(downloaded.bytes, downloaded.type || downloaded.mimeType)
    progress?.('正在使用当前模型进行视觉审核')
    let review
    try {
      review = await reviewer(turnSettings, image, input.topic.trim(), item, { signal, beforeModelCall, ...authorPreferences })
      review = { ...review, policyHash }
    } catch (error) {
      if (!signal?.aborted) store.put('images', accountId, { ...item, state: 'rejected', reviewedAt: Date.now(), failure: error.message })
      throw error
    }
    signal?.throwIfAborted()
    if (!review.approved) {
      store.put('images', accountId, { ...item, state: 'rejected', reviewedAt: Date.now(), review })
      throw new Error(`图片未通过视觉审核，未保存：${review.reason}`)
    }
    progress?.('审核通过，正在保存配图')
    const sha256 = hash(image.bytes)
    const accountDirectory = path.join(root, hash(accountId).slice(0, 20))
    await fs.mkdir(accountDirectory, { recursive: true, mode: 0o700 })
    const realRoot = await fs.realpath(root)
    const realDirectory = await fs.realpath(accountDirectory)
    if (/^[\\/]{2}/.test(realRoot) || !inside(realRoot, realDirectory)) throw new Error('图片目录不在指定的本地目录中')
    const filename = path.join(realDirectory, `${sha256}.png`)
    signal?.throwIfAborted()
    try {
      await saveFile(filename, image.bytes, sha256, signal)
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (/^[\u4e00-\u9fff]/.test(error.message)) throw error
      throw new Error('无法写入指定的图片目录，请检查磁盘空间与权限')
    }
    const saved = store.put('images', accountId, { ...item, state: 'approved', topic: input.topic.trim(),
      review, reviewedAt: review.reviewedAt, root: realRoot, filename, sha256, bytes: image.bytes.length,
      width: image.width, height: image.height, createdAt: item.createdAt, approvedAt: Date.now() })
    return { ...publicAsset(saved), markdown: `![${review.description.slice(0, 100).replace(/[\[\]\\\r\n]/g, ' ')}](oa-image:${saved.id})`,
      note: '已完成文件检查与当前模型的视觉审核，并保存至指定目录；尚未上传微信。' }
  }

  async function file(accountId, id) {
    const asset = requireAsset(accountId, id)
    const stat = await fs.lstat(asset.filename).catch(() => null)
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== asset.bytes || stat.size > 10 * 1024 * 1024) {
      throw new Error('本地配图已丢失或被修改，请重新搜图审核')
    }
    const real = await fs.realpath(asset.filename)
    if (!inside(asset.root, real)) throw new Error('配图不在已审核的保存目录内')
    const bytes = await fs.readFile(real)
    if (hash(bytes) !== asset.sha256) throw new Error('配图内容与审核时不一致，已停止使用')
    return { bytes, filename: real, mimeType: 'image/png', asset }
  }

  async function upload(accountId, id, verifiedFile) {
    const record = requireAsset(accountId, id)
    if (record.upload?.url) return record.upload
    const data = verifiedFile || await file(accountId, id)
    const uploaded = await mp.uploadMaterial(accountId, { bytes: [...data.bytes],
      name: path.basename(data.filename), mimeType: 'image/png' })
    const url = uploaded.url || uploaded.cover?.url
    let parsed
    try { parsed = new URL(url) } catch { throw new Error('微信未返回配图上传地址，请核对素材库后重试') }
    if (parsed.protocol !== 'https:' || !/(^|\.)(qpic|qlogo)\.cn$/.test(parsed.hostname)) {
      throw new Error('微信返回的配图地址异常，请核对素材库')
    }
    const value = { url, mediaId: String(uploaded.mediaId || ''), fileId: String(uploaded.fileId || uploaded.id || '') }
    store.put('images', accountId, { ...record, upload: value, uploadedAt: Date.now() })
    return value
  }

  async function forWeChat(accountId, html, cover) {
    const assets = manifest(accountId, html, cover)
    if (!assets.length) return { html, cover }
    const files = new Map()
    for (const asset of assets) files.set(asset.id, await file(accountId, asset.id))
    const uploaded = new Map()
    for (const asset of assets) uploaded.set(asset.id, await upload(accountId, asset.id, files.get(asset.id)))
    const document = documentFor(html)
    for (const image of document.querySelectorAll('img[data-oa-image-id]')) {
      const id = image.getAttribute('data-oa-image-id')
      if (!uploaded.has(id)) throw new Error('正文配图与审核记录不一致')
      image.setAttribute('src', uploaded.get(id).url)
      image.removeAttribute('data-oa-image-id')
    }
    for (const box of document.querySelectorAll('[data-oa-image-box]')) box.removeAttribute('data-oa-image-box')
    return { html: document.body.innerHTML, cover: cover?.assetId ? uploaded.get(cover.assetId) : cover }
  }

  return { search, fromSources, fromAttachment, registerCandidates, prepare, resolve, manifest, file, forWeChat, directory,
    list: accountId => store.list('images', accountId).filter(item => item.state === 'approved').map(publicAsset),
    cover: (accountId, id) => { requireAsset(accountId, id); return { assetId: id, url: previewUrl(id) } },
    async close() { closed = true; await Promise.allSettled([...preparing.values()]) },
  }
}

module.exports = { createImageService }
