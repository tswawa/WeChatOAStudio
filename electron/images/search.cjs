// Parse search-provider data without running provider scripts or treating search captions as instructions.
const { parseHTML } = require('linkedom')
const { publicImageUrl } = require('./network.cjs')
const { configuredEngines } = require('../ops/search-config.cjs')
const { fetchProvider } = require('../ops/search-providers.cjs')
const { normalizeImageMetadata } = require('./metadata.cjs')

const text = value => String(value || '').replace(/[\u0000-\u001f\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240)
function candidate(item) {
  try {
    const imageUrl = publicImageUrl(item.imageUrl).href
    const sourcePage = publicImageUrl(item.sourcePage).href
    let licenseUrl = ''
    try { if (item.licenseUrl) licenseUrl = publicImageUrl(item.licenseUrl).href } catch {}
    return normalizeImageMetadata({ ...item, imageUrl, sourcePage, title: text(item.title) || '网络图片', author: text(item.author),
      description: text(item.description), license: text(item.license), licenseUrl })
  } catch { return null }
}

function parseBing(html) {
  const document = parseHTML(html).document
  const result = []
  for (const anchor of document.querySelectorAll('a.iusc[m]')) {
    let item
    try { item = JSON.parse(anchor.getAttribute('m')) } catch { continue }
    const found = candidate({ imageUrl: item.murl, sourcePage: item.purl, title: item.t || item.desc,
      description: item.desc, author: '', provider: 'Bing' })
    if (found) result.push(found)
  }
  return result
}

function parseOpenverse(value) {
  return (Array.isArray(value.results) ? value.results : []).map(item => candidate({
    imageUrl: item.url, sourcePage: item.foreign_landing_url, title: item.title,
    author: item.creator, license: item.license, licenseUrl: item.license_url, provider: 'Openverse',
  })).filter(Boolean)
}

function diverseCandidates(items, limit) {
  const seenUrls = new Set()
  const unique = items.filter(item => {
    if (seenUrls.has(item.imageUrl)) return false
    seenUrls.add(item.imageUrl)
    return true
  })
  const selected = []
  const domains = new Set()
  for (const item of unique) {
    const domain = new URL(item.sourcePage).hostname
    if (domains.has(domain)) continue
    domains.add(domain)
    selected.push(item)
    if (selected.length === limit) return selected
  }
  for (const item of unique) {
    if (!selected.includes(item)) selected.push(item)
    if (selected.length === limit) break
  }
  return selected
}

async function searchImages(network, query, limit = Infinity, signal, context = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('请提供具体搜图关键词')
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('候选数量必须是正整数')
  const failures = []
  for (const engine of configuredEngines(context.settings)) {
    signal?.throwIfAborted()
    context.progress?.(`正在使用 ${engine.name} 搜索图片`)
    try {
      const items = (await fetchProvider(network, engine, 'images', query.trim(), signal, { limit })).map(candidate).filter(Boolean)
      const selected = diverseCandidates(items, limit)
      if (selected.length) {
        const searchAssessment = await context.assessSearch?.({ query: query.trim(), results: selected, mode: 'images' })
        if (searchAssessment?.status === 'off_topic') {
          failures.push({ engine: engine.name, code: 'off_topic', reason: `返回结果整体跑题：${searchAssessment.reason}` })
          continue
        }
        return selected.map(item => ({ ...item, unavailableSources: failures, searchAssessment }))
      }
      failures.push({ engine: engine.name, code: 'no_parseable_results', reason: '本次响应没有提取到公开图片结果，原因未确定；不能据此认定需要登录或验证' })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (error.searchAssessmentError) throw error
      failures.push({ engine: engine.name, reason: error.message })
    }
  }
  throw new Error(`已选图片搜索源暂不可用：${failures.map(item => `${item.engine}：${item.reason}`).join('；')}`)
}

module.exports = { parseBing, parseOpenverse, searchImages, diverseCandidates }
