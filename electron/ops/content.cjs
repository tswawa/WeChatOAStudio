// 抓取公开 RSS 和网页正文，保留来源元数据，并把 Markdown 排版为公众号内联样式 HTML。
const { isIP } = require('node:net')
const { createImageNetwork } = require('../images/network.cjs')
const { imageMarkup, htmlImagePlaceholders, restoreHtmlImages } = require('../images/article.cjs')
const { MAX_TEMPLATE_HTML, templateImageSource } = require('./template-images.cjs')
const { pageImages, pageResources, markdownImages, structuredImages, repositoryFileUrl } = require('../images/sources.cjs')

function publicUrl(value, base) {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('资讯来源必须是公开 HTTP 或 HTTPS 网页')
  }
  url.hash = ''
  return url.href
}

function privateAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19))
  }
  // 2001:2::/48 与 198.18.0.0/15 一样是保留的测试网段
  return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')
    || /^2001:0{0,3}2:(?::|0{1,4}:)/.test(ip)
    || /^fe[89ab]/.test(ip) || ip.startsWith('::ffff:')
}

function allowedAddresses(hostname, addresses) {
  if (!addresses.length) return false
  if (addresses.every((item) => !privateAddress(item.address))) return true
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|lan|internal|home|test)$/.test(host)) {
    return false
  }
  // 本机代理将公开域名同时映射到 198.18.0.0/15 和一个 IPv6 保留网段（fdfe:dcba:9876::/48 或 2001:2::/48），
  // 只有完整映射对才可例外。
  const fakeV4 = (address) => /^198\.(?:18|19)\.\d{1,3}\.\d{1,3}$/.test(address) && isIP(address) === 4
  const fakeV6 = (address) => /^(?:fdfe:dcba:9876|2001:2)::[0-9a-f]{1,4}$/i.test(address)
  return addresses.some((item) => fakeV4(item.address)) && addresses.some((item) => fakeV6(item.address))
    && addresses.every((item) => fakeV4(item.address) || fakeV6(item.address))
}

async function fetchText(address, signal, network = createImageNetwork()) {
  const fetched = await network.fetchBytes(publicUrl(address), { signal, timeout: 30000,
    accept: 'text/html,application/json,application/xml,text/plain,text/markdown', maxBytes: 3_000_000 })
  return { url: fetched.url || address, text: fetched.bytes.toString('utf8'), type: fetched.type || '' }
}

async function articleFromHtml(html, url) {
  const { Readability } = await import('@mozilla/readability')
  const { document, images, links, diagnostics, title } = pageResources(html, url)
  const base = document.createElement('base')
  base.setAttribute('href', url)
  document.head.prepend(base)
  for (const element of document.querySelectorAll('script,style,noscript')) element.remove()
  const parsed = new Readability(document, { charThreshold: 120 }).parse()
  if (!parsed?.textContent?.trim() && !images.length) throw new Error('本次响应没有可提取的正文或图片；可能是动态页面、验证页或非文章网址，尚不能判断原页面没有内容')
  return { title: parsed?.title?.trim() || title || new URL(url).hostname, content: parsed?.textContent?.trim() || '', images, links, diagnostics }
}

async function collectSource(source, signal, options = {}) {
  const address = publicUrl(source.url)
  const fetched = await fetchText(new URL(address).hostname === 'github.com' ? repositoryFileUrl(address) : address, signal, options.network)
  const fetchedAt = Date.now()
  if (/(?:markdown|text\/plain)/i.test(fetched.type) || /\.(?:md|markdown)(?:[?#]|$)/i.test(fetched.url)) {
    const { default: MarkdownIt } = await import('markdown-it')
    const tokens = new MarkdownIt().parse(fetched.text, {})
    const heading = tokens.findIndex(token => token.type === 'heading_open')
    return [{ title: heading >= 0 ? tokens[heading + 1]?.content || 'README' : new URL(source.url).pathname.split('/').at(-1) || '来源文档',
      content: fetched.text.trim(), url: source.url, fetchedAt, sourceId: source.id,
      images: await markdownImages(fetched.text, source.url, undefined, fetched.url) }]
  }
  if (/xml|rss|atom|feed\+json/i.test(fetched.type) || /^\s*(<\?xml|<rss|<feed)/i.test(fetched.text)
    || (/json/i.test(fetched.type) && fetched.text.includes('jsonfeed.org/version'))) {
    const { extractFromXml, extractFromJson } = await import('@extractus/feed-extractor')
    const options = { descriptionMaxLen: 0, baseUrl: fetched.url }
    const feed = fetched.text.trim().startsWith('{')
      ? extractFromJson(fetched.text, options) : extractFromXml(fetched.text, options)
    const items = []
    for (const entry of (feed.entries || [])) {
      if (!entry.link || !entry.title) continue
      const url = publicUrl(entry.link, fetched.url)
      const { parseHTML } = await import('linkedom')
      const description = parseHTML(`<html><body>${entry.description || ''}</body></html>`).document.body.textContent
      let content = description?.trim() || ''
      let images = pageImages(entry.description || '', url)
      if (content.length < 300) {
        try {
          const page = await fetchText(url, signal, options.network)
          const parsed = await articleFromHtml(page.text, page.url)
          content = parsed.content
          if (parsed.images.length) images = parsed.images
        } catch (error) {
          if (signal?.aborted) throw signal.reason
          console.warn('资讯正文提取失败', source.id, error.name)
          if (content.length < 80) continue
        }
      }
      items.push({ title: entry.title, url, content, images, publishedAt: entry.published || '', fetchedAt, sourceId: source.id })
    }
    return items
  }
  if (/json/i.test(fetched.type)) {
    let value
    try { value = JSON.parse(fetched.text) } catch { throw new Error('来源返回了无法解析的 JSON') }
    const resources = structuredImages(value, fetched.url)
    return [{ title: value.title || value.parse?.title || new URL(fetched.url).hostname, content: JSON.stringify(value),
      ...resources, url: fetched.url, fetchedAt, sourceId: source.id }]
  }
  return [{ ...(await articleFromHtml(fetched.text, fetched.url)), url: fetched.url, fetchedAt, sourceId: source.id }]
}

async function collectSources(sources, signal, options = {}) {
  const items = []
  const failures = []
  for (const source of sources) {
    try {
      items.push(...await collectSource(source, signal, options))
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      console.warn('资讯来源采集失败', source.id, error.name)
      failures.push(`${source.name}：${error.message}`)
    }
  }
  if (!items.length) throw new Error(`没有采集到可用资讯。${failures.join('；')}`)
  return { items, failures }
}

// 公众号正文默认样式：Markdown 和 HTML 正文共用；有文章模板时再按模板范文的格式覆盖
const ARTICLE_CSS = [
  'section{font-size:16px;line-height:1.8;color:#333;word-break:break-word;}',
  'p{margin:0 0 16px;}h1,h2,h3{color:#17232b;margin:24px 0 14px;line-height:1.5;}',
  'h1{font-size:24px;}h2{font-size:21px;}h3{font-size:18px;}',
  'blockquote{margin:16px 0;padding:12px 16px;background:#f4f7f6;border-left:3px solid #07c160;}',
  'a{color:#576b95;text-decoration:none;}li{margin-bottom:8px;}hr{border:0;border-top:1px solid #eee;}',
  'code{font-size:14px;background:#f6f7f8;}pre{white-space:pre-wrap;padding:12px;background:#f6f7f8;}',
].join('\n')

async function renderArticle(markdown, _sources = [], { resolveImage } = {}) {
  const { default: MarkdownIt } = await import('markdown-it')
  const { default: juice } = await import('juice')
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
  if (!resolveImage) md.disable('image')
  else md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index]
    return imageMarkup(resolveImage(token.attrGet('src')), token.content)
  }
  return juice.inlineContent(`<section>${md.render(markdown)}</section>`, ARTICLE_CSS)
}

// 模型把正文写成 HTML 时：只保留排版标签，再套用和 Markdown 正文相同的样式
async function styleArticleHtml(html, { resolveImage } = {}) {
  const sanitizeHtml = require('sanitize-html')
  const { default: juice } = await import('juice')
  const prepared = resolveImage ? htmlImagePlaceholders(html, resolveImage) : { html, replacements: new Map() }
  const clean = sanitizeHtml(prepared.html, {
    allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote',
      'ul', 'ol', 'li', 'a', 'hr', 'span', 'section'],
    allowedAttributes: { a: ['href'], span: ['data-oa-image-placeholder'] }, allowedSchemes: ['https', 'http'],
  })
  const result = prepared.replacements.size ? restoreHtmlImages(clean, prepared.replacements) : clean
  return juice.inlineContent(`<section>${result}</section>`, ARTICLE_CSS)
}

// 文章模板范文：保留排版标签和常见文字样式；样式值不允许带括号（url() 等），颜色的 rgb() 除外
const STYLE_VALUE = [/^[^()]*$/, /^rgba?\([\d\s.,%]+\)$/]
const TEMPLATE_STYLES = Object.fromEntries([
  'color', 'background-color', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-decoration',
  'text-decoration-line', 'text-align', 'text-indent', 'line-height', 'letter-spacing', 'margin', 'margin-top',
  'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left',
  'padding-right', 'border', 'border-left', 'border-top', 'border-bottom', 'border-radius',
  'width', 'max-width', 'height', 'max-height', 'display', 'object-fit',
].map((name) => [name, STYLE_VALUE]))

function cleanTemplateHtml(html) {
  if (String(html || '').length > MAX_TEMPLATE_HTML) throw new Error('模板内容过大，请压缩图片后重试')
  const sanitizeHtml = require('sanitize-html')
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'blockquote',
      'ul', 'ol', 'li', 'a', 'hr', 'section', 'div', 'img'],
    allowedAttributes: { '*': ['style'], a: ['href'], img: ['src', 'alt', 'width', 'height'] }, allowedSchemes: ['https', 'http'],
    allowedSchemesByTag: { img: ['https', 'http', 'data'] }, allowProtocolRelative: false,
    transformTags: { img: (_tag, attributes) => {
      try { return { tagName: 'img', attribs: { ...attributes, src: templateImageSource(attributes.src),
        alt: String(attributes.alt || '').slice(0, 200) } } }
      catch { return { tagName: 'span', attribs: {} } }
    } },
    allowedStyles: { '*': TEMPLATE_STYLES },
  })
}

// 范文的纯文字：给 Bot 模仿语气、篇幅和段落写法
function templateText(html) {
  const sanitizeHtml = require('sanitize-html')
  return sanitizeHtml(String(html || '').replace(/<br\s*\/?>|<\/(?:p|div|section|h[1-6]|li|blockquote)>/gi, '\n'), {
    allowedTags: [], allowedAttributes: {},
  }).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
}

async function parseFragment(html) {
  const { parseHTML } = await import('linkedom')
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document
}

// 元素自己的样式；整段文字包在一个 span 里时（字号、颜色），span 的样式也算这一段的
function ownStyle(element) {
  let style = element.getAttribute('style') || ''
  const only = element.children.length === 1 ? element.firstElementChild : null
  if (only?.tagName === 'SPAN' && only.textContent.trim() === element.textContent.trim()) {
    style = `${style};${only.getAttribute('style') || ''}`
  }
  return style.split(';').map((item) => item.trim()).filter(Boolean).join(';')
}

const HEADINGS = 'h1,h2,h3,h4'
const level = (element) => Number(element.tagName.slice(1))

// 正文段落的样式：段落自己的样式，加上段里文字最多的那个 span 的字号、颜色等（编辑器把字号写在 span 上）
function paragraphStyle(element) {
  const spans = [...element.children].filter((child) => child.tagName === 'SPAN' && child.getAttribute('style'))
  const main = spans.sort((a, b) => b.textContent.length - a.textContent.length)[0]
  const own = element.getAttribute('style') || ''
  if (!main || main.textContent.trim().length * 2 < element.textContent.trim().length) return ownStyle(element)
  return [own, main.getAttribute('style')].join(';').split(';').map((item) => item.trim()).filter(Boolean).join(';')
}

// 范文给 Bot 看的文字版：保留结构（## 小标题、> 引用、**加粗**、- 列表），便于照着写
async function templateMarkdown(html) {
  const document = await parseFragment(cleanTemplateHtml(html))
  for (const element of document.querySelectorAll('strong, b')) element.textContent = `**${element.textContent}**`
  for (const [index, image] of [...document.querySelectorAll('img')].entries()) {
    const marker = document.createElement(image.closest('p,li,h1,h2,h3,h4') ? 'span' : 'p')
    marker.textContent = `【配图位置 ${index + 1}：${image.getAttribute('alt') || '与所在段落主题相关的图片'}】`
    image.replaceWith(marker)
  }
  const lines = []
  for (const element of document.querySelectorAll('h1, h2, h3, h4, p, li, hr')) {
    if (element.tagName !== 'P' && element.closest('li')) continue
    const text = element.textContent.replace(/\s+/g, ' ').trim()
    if (element.tagName === 'HR') { lines.push('---'); continue }
    if (!text) continue
    if (/^H[1-4]$/.test(element.tagName)) lines.push(`${'#'.repeat(Number(element.tagName[1]))} ${text}`)
    else if (element.tagName === 'LI') lines.push(`- ${text}`)
    else if (element.closest('blockquote')) lines.push(`> ${text}`)
    else lines.push(text)
  }
  return lines.join('\n\n')
}

// 从范文取出各类元素的样式：标题按层级先后，正文段落、引用、列表、加粗等各取第一个
async function templateStyles(html) {
  const document = await parseFragment(cleanTemplateHtml(html))
  const first = (selector, skip) => [...document.querySelectorAll(selector)].find((item) => !skip || !item.closest(skip))
  const styles = {}
  for (const tag of ['blockquote', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'a', 'hr']) {
    const element = first(tag)
    if (element) styles[tag] = ownStyle(element)
  }
  const paragraph = [...document.querySelectorAll('p')].find(item => item.textContent.trim() && !item.closest('blockquote, li'))
  if (paragraph) styles.p = paragraphStyle(paragraph)
  styles.images = [...document.querySelectorAll('img')].map(ownStyle)
  const quoted = first('blockquote p')
  if (quoted) styles.quoteP = ownStyle(quoted)
  const levels = [...new Set([...document.querySelectorAll(HEADINGS)].map(level))].sort()
  styles.headings = levels.map((value) => ownStyle(document.querySelector(`h${value}`)))
  return styles
}

// 把范文的格式套到 Bot 写好的正文上：模板样式写在默认样式之后，覆盖字号、颜色、行距、缩进等
async function applyTemplate(html, templateHtml) {
  if (!templateHtml) return html
  const styles = await templateStyles(templateHtml)
  const document = await parseFragment(html)
  const add = (element, style) => {
    if (!style) return
    const merged = [element.getAttribute('style'), style].join(';').split(';').map((item) => item.trim()).filter(Boolean)
    element.setAttribute('style', merged.join(';'))
  }
  // 正文的第 n 级标题用范文里第 n 级的标题样式；范文层级不够时用最后一级
  const levels = [...new Set([...document.querySelectorAll(HEADINGS)].map(level))].sort()
  for (const element of document.querySelectorAll(HEADINGS)) {
    const index = Math.min(levels.indexOf(level(element)), styles.headings.length - 1)
    if (index >= 0) add(element, styles.headings[index])
  }
  for (const element of document.querySelectorAll('p')) {
    if (!element.textContent.trim() && element.querySelector('img')) continue
    add(element, element.closest('blockquote') ? styles.quoteP : element.closest('li') ? '' : styles.p)
  }
  for (const [index, image] of [...document.querySelectorAll('img')].entries()) {
    add(image, styles.images[Math.min(index, styles.images.length - 1)])
    add(image, 'max-width:100%;height:auto')
  }
  for (const tag of ['blockquote', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'a', 'hr']) {
    for (const element of document.querySelectorAll(tag)) add(element, styles[tag] || (tag === 'b' ? styles.strong : ''))
  }
  return document.body.innerHTML
}

module.exports = { publicUrl, privateAddress, allowedAddresses, fetchText, articleFromHtml, collectSources, renderArticle,
  styleArticleHtml, cleanTemplateHtml, templateText, templateMarkdown, applyTemplate }
