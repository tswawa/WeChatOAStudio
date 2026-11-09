// 文章 HTML 清理：保留排版，去除可执行内容和可导航到桌面桥接的链接。
import DOMPurify from 'dompurify'

export function cleanArticleHtml(html = '') {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['iframe', 'form', 'input', 'button', 'object', 'embed', 'script', 'style'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
  })
  if (!clean.includes('data-oa-image-id')) return clean
  const fragment = document.createElement('template')
  fragment.innerHTML = clean
  for (const image of fragment.content.querySelectorAll('img[data-oa-image-id]')) {
    const id = image.getAttribute('data-oa-image-id')
    if (/^img_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      image.src = `mp-ops://app/images/${id}.png`
    }
  }
  return fragment.innerHTML
}
