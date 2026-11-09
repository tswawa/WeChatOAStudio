// Provider-specific public HTML/JSON adapters. Captchas and login challenges are never executed or bypassed.
const { parseHTML } = require('linkedom')
const { publicImageUrl } = require('../images/network.cjs')
const { ENGINES } = require('./search-config.cjs')
const clean = (value, limit = 240) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)

function engineUrl(engine, mode, query, limit) {
  const image = mode === 'images'
  const url = new URL(image ? engine.imagePath : engine.webPath, image ? engine.imageOrigin : engine.webOrigin)
  url.searchParams.set(image ? engine.imageQuery : engine.webQuery, query)
  if (engine.id === 'bing' && Number.isSafeInteger(limit)) url.searchParams.set('count', String(limit))
  if (engine.id === 'google') { if (Number.isSafeInteger(limit)) url.searchParams.set('num', String(limit)); if (image) url.searchParams.set('udm', '2') }
  if (engine.id === 'baidu' && image) {
    for (const [key, value] of Object.entries({ tn: 'resultjson_com', pn: '0', ...(Number.isSafeInteger(limit) ? { rn:String(limit) } : {}), ie: 'utf-8', oe: 'utf-8' })) url.searchParams.set(key, value)
  }
  if (engine.id === 'sogou' && image) {
    for (const [key, value] of Object.entries({ mode: '1', start: '0', ...(Number.isSafeInteger(limit) ? { xml_len:String(limit) } : {}) })) url.searchParams.set(key, value)
  }
  if (engine.id === 'so360' && image) { url.searchParams.set('sn', '0'); if (Number.isSafeInteger(limit)) url.searchParams.set('pn', String(limit)) }
  if (engine.id === 'duckduckgo' && image) { url.searchParams.set('iax', 'images'); url.searchParams.set('ia', 'images') }
  return url
}

function externalResult(value, base) {
  let url = new URL(value, base)
  if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname === '/ck/a') {
    const destination = url.searchParams.get('u') || ''
    if (!destination.startsWith('a1')) throw new Error('搜索跳转地址无效')
    url = new URL(Buffer.from(destination.slice(2), 'base64url').toString('utf8'))
  }
  if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/url') {
    url = new URL(url.searchParams.get('q') || url.searchParams.get('url'))
  }
  if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.searchParams.has('uddg')) url = new URL(url.searchParams.get('uddg'))
  if (url.hostname === 'r.search.yahoo.com') {
    const match = /\/RU=([^/]+)(?:\/|$)/.exec(url.pathname)
    if (!match) throw new Error('Yahoo 未提供实际来源地址')
    url = new URL(decodeURIComponent(match[1]))
  }
  const valid = publicImageUrl(url.href)
  const engine = ENGINES.find(item => new URL(item.webOrigin).hostname === valid.hostname)
  if (engine && !/\/(?:link|url)(?:\/|$)/.test(valid.pathname)) throw new Error('这是搜索引擎导航，不是原始结果')
  return valid.href
}

function parseWeb(engine, html, base) {
  const document = parseHTML(html).document
  const selectors = {
    bing: 'li.b_algo h2 a[href]', google: 'a[href]:has(h3)',
    baidu: '.result h3 a[href],.c-container h3 a[href]',
    sogou: '.vrwrap h3 a[href],.rb h3 a[href],h3.vr-title a[href]',
    so360: '.res-list h3 a[href],.result h3 a[href]',
    duckduckgo: 'a.result__a[href]', yahoo: '#web h3 a[href],.algo h3 a[href]',
    yandex: '.serp-item h2 a[href],a.OrganicTitle-Link[href]',
  }
  const result = []
  const seen = new Set()
  for (const anchor of document.querySelectorAll(selectors[engine.id])) {
    const block = anchor.closest('li.b_algo,.MjjYud,.g,.result,.c-container,.vrwrap,.rb,.res-list,.algo,.serp-item') || anchor.parentElement?.parentElement
    let url
    try { url = externalResult(block?.getAttribute('mu') || anchor.getAttribute('data-landurl') || anchor.getAttribute('href'), base) } catch { continue }
    if (seen.has(url)) continue
    const title = clean(anchor.querySelector('h3')?.textContent || anchor.textContent, 220)
    if (!title) continue
    seen.add(url)
    result.push({ title, url, snippet: clean(block?.querySelector('.b_caption p,.VwiC3b,.c-abstract,.str_info,.res-desc,.result__snippet,.compText,.OrganicTextContentSpan,p')?.textContent, 600) })
  }
  return result
}

function image(imageUrl, sourcePage, title, engine) {
  try { return { imageUrl: publicImageUrl(imageUrl).href, sourcePage: publicImageUrl(sourcePage).href,
    title: clean(title) || '网络图片', description: '', author: '', provider: engine.name } } catch { return null }
}
function jsonImages(engine, value) {
  let items = []
  if (engine.id === 'baidu') items = (value.data || []).flatMap(item => {
    const variants = item.replaceUrl || []
    const replacement = variants.find(value => /^https?:\/\//.test(value.ObjURL || '') && /^https?:\/\//.test(value.FromURL || ''))
    return [image(replacement?.ObjURL || item.hoverURL || item.middleURL, replacement?.FromURL || item.fromURL, item.fromPageTitleEnc || item.fromPageTitle, engine)]
  })
  if (engine.id === 'sogou') items = (value.data?.items || value.items || []).map(item => image(item.oriPicUrl || item.picUrl,
    item.oriPageUrl || item.pageUrl, item.title || item.name, engine))
  if (engine.id === 'so360') items = (value.list || []).map(item => image(item.img || item.img_url || item.bpic,
    item.link || item.source, item.title, engine))
  if (engine.id === 'duckduckgo') items = (value.results || []).map(item => image(item.image, item.url, item.title, engine))
  return items.filter(Boolean)
}

function htmlImages(engine, html, base) {
  const document = parseHTML(html).document
  const results = []
  if (engine.id === 'bing') {
    for (const anchor of document.querySelectorAll('a.iusc[m]')) {
      if (anchor.closest('#relatedSearches,.related-searches,[data-related-query]')) continue
      try { const data = JSON.parse(anchor.getAttribute('m')); results.push(image(data.murl, data.purl, data.t || data.desc, engine)) } catch {}
    }
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    try {
      const url = new URL(anchor.getAttribute('href'), base)
      const picture = url.searchParams.get('imgurl') || url.searchParams.get('img_url')
      const source = url.searchParams.get('imgrefurl') || url.searchParams.get('rurl') || url.searchParams.get('url')
      if (picture && source) results.push(image(picture, source, anchor.querySelector('img')?.getAttribute('alt') || anchor.textContent, engine))
    } catch {}
  }
  for (const node of document.querySelectorAll('[data-bem],[data-image]')) {
    try {
      const value = JSON.parse(node.getAttribute('data-bem') || node.getAttribute('data-image'))
      const item = value['serp-item'] || value
      const original = item.img_href || item.orig?.url || item.origin?.url
      const source = item.link_url || item.snippet?.url || item.source?.url
      if (original && source) results.push(image(original, source, item.snippet?.title || item.title, engine))
    } catch {}
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent)
      const items = Array.isArray(value) ? value : value.itemListElement || [value]
      for (const record of items) {
        const item = record.item || record
        if (item['@type'] === 'ImageObject') results.push(image(item.contentUrl, item.mainEntityOfPage?.['@id'] || item.url, item.name, engine))
      }
    } catch {}
  }
  return results.filter(Boolean)
}

function searchDiagnostics(engine, body, requestedUrl, finalUrl, query) {
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
  const parameter = requestedUrl.searchParams.get(engine.imageQuery) !== null && requestedUrl.pathname === engine.imagePath
    ? engine.imageQuery : engine.webQuery
  const returnedQuery = new URL(finalUrl).searchParams.get(parameter) || ''
  let echoedQuery = ''
  if (/^\s*(?:<!doctype|<html|<head|<body|<input|<div|<script|<meta)/i.test(body)) {
    const document = parseHTML(body).document
    const field = document.querySelector('input#sb_form_q,input[name="q"],textarea[name="q"],input[name="word"],input[name="text"],input[name="query"]')
    echoedQuery = field?.getAttribute('value') || field?.textContent || ''
  }
  const echo = echoedQuery || returnedQuery
  return { requestedQuery: query, echoedQuery, returnedQuery,
    queryVerification: echo ? normalize(echo) === normalize(query) ? 'matched' : 'mismatch' : 'not_echoed',
    note: '关键词校验不是结果相关性或图片像素审核；即使关键词一致，供应商也可能返回跑题内容。' }
}

async function fetchProvider(network, engine, mode, query, signal, { limit } = {}) {
  const url = engineUrl(engine, mode, query, limit)
  const response = await network.fetchBytes(url.href, { signal, accept: 'text/html,application/json',
    maxBytes: 3 * 1024 * 1024, timeout: 12000 })
  const body = response.bytes.toString('utf8')
  const finalUrl = response.url || url.href
  const finalPath = new URL(finalUrl).pathname
  const diagnostics = searchDiagnostics(engine, body, url, finalUrl, query)
  if (diagnostics.queryVerification === 'mismatch') throw new Error(`${engine.name} 实际返回的检索词与请求不符，未把这些结果当作本次搜索成功`)
  const annotate = items => items.map(item => ({ ...item, searchDiagnostics: diagnostics }))
  if (/captcha|antispider|showcaptcha|\/sorry\//i.test(finalPath)
    || /<title[^>]*>\s*(?:[^<]{0,30})?(?:安全验证|人机验证|访问验证)/i.test(body)) {
    throw new Error(`${engine.name} 要求安全验证，未尝试绕过，请换用其他已选来源`)
  }
  if (mode !== 'images') return annotate(parseWeb(engine, body, finalUrl))
  if (engine.id === 'duckduckgo') {
    const document = parseHTML(body).document
    let token = document.querySelector('[data-vqd]')?.getAttribute('data-vqd')
    if (!token) {
      for (const script of document.querySelectorAll('script')) {
        if (script.src) continue
        token = /\bvqd\s*=\s*['"]([0-9-]{6,100})['"]/.exec(script.textContent)?.[1]
        if (token) break
      }
    }
    if (!token) return annotate(htmlImages(engine, body, finalUrl))
    const api = new URL('/i.js', engine.imageOrigin)
    api.search = new URLSearchParams({ q: query, l: 'us-en', o: 'json', vqd: token })
    const fetched = await network.fetchBytes(api.href, { signal, accept: 'application/json', maxBytes: 1024 * 1024, timeout: 12000 })
    return annotate(jsonImages(engine, JSON.parse(fetched.bytes.toString('utf8'))))
  }
  if (['baidu', 'sogou', 'so360'].includes(engine.id)) {
    let value
    try { value = JSON.parse(body) } catch { return [] }
    if (value.antiFlag || /forbid|captcha|denied/i.test(String(value.info || value.message || ''))) {
      throw new Error(`${engine.name} 暂不允许自动访问，请换用其他已选来源`)
    }
    return annotate(jsonImages(engine, value))
  }
  return annotate(htmlImages(engine, body, finalUrl))
}

module.exports = { engineUrl, externalResult, parseWeb, jsonImages, htmlImages, searchDiagnostics, fetchProvider }
