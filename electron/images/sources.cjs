// Read inert HTML and structured source data without running page scripts.
const { parseHTML } = require('linkedom')
const parseSrcset = require('parse-srcset')
const { publicImageUrl } = require('./network.cjs')
const label = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240)

function repositoryFileUrl(value) {
  const url = publicImageUrl(value)
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'github.com' && parts.length >= 5 && ['blob', 'raw'].includes(parts[2])) {
    return new URL(`https://raw.githubusercontent.com/${[parts[0], parts[1], ...parts.slice(3)].join('/')}`).href
  }
  return url.href
}

function imageCandidate(value, base, title = '', sourcePage = base) {
  try {
    const imageUrl = publicImageUrl(value, base).href
    return { imageUrl: repositoryFileUrl(imageUrl), sourcePage: publicImageUrl(sourcePage).href,
      title: label(title) || '来源配图', provider: '原始来源', origin: 'source' }
  } catch { return null }
}

function sourceDocument(html) {
  let document = parseHTML(String(html)).document
  if (document.documentElement?.localName !== 'html') {
    document = parseHTML(`<html><head></head><body>${String(html)}</body></html>`).document
  }
  let templates = 0
  // Wiki skins keep complete article HTML in inert templates rather than the live body.
  for (let template; (template = document.querySelector('template'));) {
    template.replaceWith(template.content)
    templates += 1
  }
  return { document, templates }
}

function pageResources(html, sourcePage, limit = Infinity, resolveBase = sourcePage) {
  const { document, templates } = sourceDocument(html)
  let base = resolveBase
  try { if (document.querySelector('base[href]')) base = publicImageUrl(document.querySelector('base[href]').getAttribute('href'), resolveBase).href } catch {}
  const scope = document.querySelector('.fullImageLink') ? document : document.querySelector('.markdown-body,.mw-parser-output') || document.querySelector('article') || document.querySelector('main') || document
  const images = [], links = [], seen = new Set(), seenLinks = new Set()
  const add = (value, title, extra = {}) => {
    const item = imageCandidate(value, base, title, sourcePage)
    if (!item || seen.has(item.imageUrl) || images.length >= limit) return
    seen.add(item.imageUrl)
    images.push({ ...item, ...extra })
  }
  const addLink = (value, title, kind = 'page') => {
    try {
      const url = publicImageUrl(value, base).href
      if (seenLinks.has(url) || url === sourcePage) return
      seenLinks.add(url)
      links.push({ url, title: label(title), kind })
    } catch {}
  }
  for (const image of scope.querySelectorAll('img')) {
    const figure = image.closest('figure,.thumb,.gallerybox')
    const anchor = image.closest('a[href]')
    const title = image.getAttribute('alt') || image.getAttribute('title') || figure?.querySelector('figcaption,.thumbcaption,.gallerytext')?.textContent || ''
    const original = anchor?.getAttribute('href')
    const fileDescription = anchor?.classList.contains('mw-file-description')
      || anchor?.classList.contains('image') && /(?:File|Image)(?::|%3a)/i.test(original || '')
    const directOriginal = original && !fileDescription && /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(original)
    const srcsets = [image.getAttribute('data-srcset'), image.getAttribute('srcset'),
      ...[...(image.closest('picture')?.querySelectorAll('source[srcset],source[data-srcset]') || [])]
        .map(node => node.getAttribute('data-srcset') || node.getAttribute('srcset'))]
      .filter(Boolean).flatMap(value => parseSrcset(value)).sort((a, b) => (b.w || b.d || 1) - (a.w || a.d || 1))
    const values = [image.getAttribute('data-canonical-src'), image.getAttribute('data-original'), image.getAttribute('data-full-src'),
      directOriginal ? original : null, ...srcsets.map(item => item.url), image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), image.getAttribute('src')].filter(Boolean)
    const value = values.find(value => imageCandidate(value, base, title, sourcePage))
    if (value) {
      let detailPage = ''
      try { if (original && !directOriginal && !original.startsWith('#')) detailPage = publicImageUrl(original, base).href } catch {}
      add(value, title, { extraction: directOriginal && value === original ? 'linked_original' : srcsets.some(item => item.url === value) ? 'srcset' : 'body_image',
        ...(detailPage ? { detailPage } : {}),
        ...(image.getAttribute('data-file-width') ? { originalWidth: Number(image.getAttribute('data-file-width')), originalHeight: Number(image.getAttribute('data-file-height')) || null } : {}) })
      if (detailPage) addLink(detailPage, title, 'image_detail')
    }
  }
  for (const anchor of scope.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#')) continue
    addLink(href, anchor.getAttribute('title') || anchor.textContent)
  }
  for (const meta of document.querySelectorAll('meta[property="og:image"],meta[property="og:image:url"],meta[name="twitter:image"],link[rel="image_src"]')) {
    add(meta.getAttribute('content') || meta.getAttribute('href'), document.querySelector('title')?.textContent, { extraction: 'page_metadata' })
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const pending = [JSON.parse(script.textContent)]
      while (pending.length) {
        const item = pending.pop()
        if (!item || typeof item !== 'object') continue
        if (Array.isArray(item)) { for (const value of item) pending.push(value); continue }
        if (item['@type'] === 'ImageObject') add(item.contentUrl || item.url, item.name, { extraction: 'structured_data' })
        if (typeof item.image === 'string') add(item.image, item.headline || item.name, { extraction: 'structured_data' })
        else if (item.image) pending.push(item.image)
        if (item['@graph']) pending.push(item['@graph'])
        if (item.itemListElement) pending.push(item.itemListElement)
        if (item.item) pending.push(item.item)
      }
    } catch {}
  }
  for (const link of document.querySelectorAll('link[rel="EditURI"][href]')) addLink(link.getAttribute('href'), '页面公开接口', 'public_api')
  return { images, links, title: label(document.querySelector('title')?.textContent), document,
    diagnostics: { code: images.length ? 'images_extracted' : 'no_image_urls_in_response', templatesExpanded: templates,
      bodyImages: scope.querySelectorAll('img').length,
      note: images.length ? '从实际响应中提取；缩略图与详情页不等于已经取得原图，仍需查看像素。'
        : '本次响应未提取到图片地址，不代表页面没有图片；可继续读取返回的详情链接或公开接口，动态加载和访问验证需另行核实。' } }
}

function pageImages(html, sourcePage, limit = Infinity, resolveBase = sourcePage) {
  return pageResources(html, sourcePage, limit, resolveBase).images
}

async function markdownImages(markdown, sourcePage, limit = Infinity, resolveBase = sourcePage) {
  const { default: MarkdownIt } = await import('markdown-it')
  const tokens = new MarkdownIt({ html: true }).parse(String(markdown), {})
  const result = [], seen = new Set()
  const pending = [...tokens]
  const add = item => {
    if (!item || seen.has(item.imageUrl) || result.length >= limit) return
    seen.add(item.imageUrl)
    result.push(item)
  }
  while (pending.length) {
    const token = pending.shift()
    if (token.type === 'image') add(imageCandidate(token.attrGet('src'), resolveBase, token.content, sourcePage))
    if (['html_block', 'html_inline'].includes(token.type)) for (const item of pageImages(token.content, sourcePage, limit, resolveBase)) add(item)
    if (token.children) pending.unshift(...token.children)
  }
  return result
}

function structuredImages(value, sourcePage, limit = Infinity) {
  const images = [], links = [], seen = new Set(), pending = [value]
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object') continue
    if (Array.isArray(item)) { for (const value of item) pending.push(value); continue }
    const urls = [item.contentUrl, item.original?.url, item.imageUrl, item.image_url,
      item['@type'] === 'ImageObject' || item.descriptionurl || /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(item.url || '') ? item.url : null,
      typeof item.image === 'string' ? item.image : null]
    for (const url of urls.filter(Boolean)) {
      const image = imageCandidate(url, sourcePage, item.title || item.name || '', sourcePage)
      if (!image || seen.has(image.imageUrl) || images.length >= limit) continue
      seen.add(image.imageUrl)
      images.push({ ...image, extraction: 'structured_data' })
    }
    for (const [key, entry] of Object.entries(item)) {
      if (entry && typeof entry === 'object') pending.push(entry)
      else if (typeof entry === 'string' && ['html','text','content','body','*'].includes(key) && /<(?:img|article|main|template)\b/i.test(entry)) {
        const page = pageResources(entry, sourcePage, limit)
        for (const image of page.images) if (!seen.has(image.imageUrl) && images.length < limit) { seen.add(image.imageUrl); images.push(image) }
        links.push(...page.links)
      }
    }
  }
  return { images, links, diagnostics: { code: images.length ? 'images_extracted' : 'no_image_urls_in_response',
    note: images.length ? '图片地址来自实际结构化响应，仍需查看像素。' : '结构化响应中没有解析到实际图片地址；文件名称不是图片网址，不能据此猜测地址。' } }
}

async function readImageSource(network, value, { signal, limit = Infinity } = {}) {
  const sourcePage = publicImageUrl(value).href
  const fetched = await network.fetchBytes(repositoryFileUrl(sourcePage), { signal,
    accept: 'text/html,application/json,text/markdown,text/plain,image/png,image/jpeg,image/webp', maxBytes: 8 * 1024 * 1024 })
  signal?.throwIfAborted()
  const finalUrl = fetched.url || repositoryFileUrl(sourcePage)
  const declaredImage = /^image\//.test(fetched.type || '')
    || (!fetched.type || fetched.type === 'application/octet-stream') && /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(finalUrl)
  if (declaredImage || fetched.type === 'application/octet-stream') {
    try {
      require('./review.cjs').inspectRaster(fetched.bytes, fetched.type)
      return { images: [{ ...imageCandidate(finalUrl, finalUrl, new URL(sourcePage).pathname.split('/').at(-1), sourcePage), provider: '指定图片', origin: 'direct' }],
        links: [], finalUrl, diagnostics: { code: 'direct_image' } }
    } catch (error) { if (declaredImage) throw error }
  }
  if (fetched.bytes.length > 3 * 1024 * 1024) throw new Error('来源页面过大，请提供具体文章或图片链接')
  const content = fetched.bytes.toString('utf8')
  if (/json/i.test(fetched.type || '') || /^\s*[\[{]/.test(content)) {
    try { return { ...structuredImages(JSON.parse(content), finalUrl, limit), finalUrl } }
    catch (error) { if (/json/i.test(fetched.type || '')) throw new Error('来源返回了无法解析的 JSON，未推断图片地址') }
  }
  if (/(?:markdown|plain)/i.test(fetched.type || '') || /\.(?:md|markdown)(?:[?#]|$)/i.test(finalUrl)) {
    const images = await markdownImages(content, sourcePage, limit, finalUrl)
    return { images, links: [], finalUrl, diagnostics: { code: images.length ? 'images_extracted' : 'no_image_urls_in_response' } }
  }
  const { document, ...page } = pageResources(content, sourcePage, limit, finalUrl)
  return { ...page, finalUrl }
}

async function sourceImages(network, value, options) {
  return (await readImageSource(network, value, options)).images
}

module.exports = { repositoryFileUrl, imageCandidate, sourceDocument, pageResources, pageImages, markdownImages, structuredImages, readImageSource, sourceImages }
