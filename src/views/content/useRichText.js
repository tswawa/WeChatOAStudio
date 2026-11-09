// 正文排版：像 Word 一样设置段落样式、字号、颜色、对齐、列表、行距、段距、首行缩进、格式刷等。
// 格式全部写成行内样式，公众平台保存和读者手机上显示的都是同一套格式。
import { onBeforeUnmount, onMounted, reactive } from 'vue'

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,section,div,pre'
const INLINE_COPY = ['fontWeight', 'fontStyle', 'textDecorationLine', 'color', 'backgroundColor', 'fontSize']

export function useRichText(bodyRef, onChange) {
  let saved = null
  // 工具栏显示当前光标处的格式；painter 为格式刷复制到的样式
  const state = reactive({ marks: {}, block: 'p', fontSize: '', painter: null })

  const inEditor = (node) => Boolean(bodyRef.value && node && bodyRef.value.contains(node))

  function refresh() {
    const marks = {}
    for (const name of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList',
      'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull']) {
      marks[name] = document.queryCommandState(name)
    }
    state.marks = marks
    state.block = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase()
    const node = saved?.startContainer
    const element = node?.nodeType === 1 ? node : node?.parentElement
    state.fontSize = element ? String(Math.round(parseFloat(getComputedStyle(element).fontSize))) : ''
  }

  // 记住编辑区里的选区；点工具栏的下拉框、颜色或输入框时选区会丢，执行前再恢复
  function remember() {
    const selection = document.getSelection()
    if (!selection?.rangeCount || !inEditor(selection.anchorNode)) return
    saved = selection.getRangeAt(0).cloneRange()
    refresh()
  }

  function restore() {
    bodyRef.value?.focus()
    if (!saved || !inEditor(saved.startContainer) || !inEditor(saved.endContainer)) { saved = null; return }
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(saved)
  }

  function done() {
    remember()
    onChange()
  }

  function exec(command, value = null) {
    restore()
    document.execCommand('styleWithCSS', false, true)
    document.execCommand('defaultParagraphSeparator', false, 'p')
    document.execCommand(command, false, value)
    done()
  }

  // 选区覆盖到的最内层段落；正文还没有段落时先包成段落
  function selectedBlocks(wrap = true) {
    restore()
    const range = saved
    if (!range) return []
    const blocks = [...bodyRef.value.querySelectorAll(BLOCKS)]
      .filter((element) => range.intersectsNode(element) && !element.querySelector(BLOCKS))
    if (blocks.length || !wrap) return blocks
    document.execCommand('formatBlock', false, 'p')
    remember()
    return selectedBlocks(false)
  }

  function setBlock(tag) {
    exec('formatBlock', tag)
    if (tag !== 'blockquote') return
    for (const quote of bodyRef.value.querySelectorAll('blockquote:not([style])')) {
      quote.style.cssText = 'margin:0 0 16px;padding:4px 0 4px 12px;border-left:3px solid #dbdbdb;color:#888'
    }
    onChange()
  }

  function setBlockStyle(property, value) {
    for (const block of selectedBlocks()) block.style[property] = value
    done()
  }

  // 首行缩进 2 字：已缩进的段落再点一次取消
  function toggleIndent() {
    const blocks = selectedBlocks()
    const off = blocks.length && blocks.every((block) => block.style.textIndent === '2em')
    for (const block of blocks) block.style.textIndent = off ? '' : '2em'
    done()
  }

  // execCommand 的字号只有 1~7 档；先用最大档标记，再换成具体像素
  function setFontSize(px) {
    exec('fontSize', '7')
    for (const element of bodyRef.value.querySelectorAll('font[size="7"], span[style*="xxx-large"]')) {
      if (element.tagName === 'FONT') {
        const span = document.createElement('span')
        span.append(...element.childNodes)
        element.replaceWith(span)
        span.style.fontSize = `${px}px`
      } else {
        element.style.fontSize = `${px}px`
      }
    }
    done()
  }

  // 分割线插在光标所在段落之后（不嵌进标题或引用里），再在下面开一个空段落继续写
  function insertDivider() {
    restore()
    const body = bodyRef.value
    let block = saved?.startContainer || null
    while (block && block.parentNode !== body) block = block.parentNode
    if (!block) {
      exec('insertHTML', '<hr style="margin:20px 0;border:0;border-top:1px solid #e5e5e5"><p><br></p>')
      return
    }
    const line = document.createElement('hr')
    line.style.cssText = 'margin:20px 0;border:0;border-top:1px solid #e5e5e5'
    const next = document.createElement('p')
    next.append(document.createElement('br'))
    block.after(line, next)
    const range = document.createRange()
    range.setStart(next, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    done()
  }

  function insertImage({ src, alt = '' }) {
    restore()
    const body = bodyRef.value
    if (!body) return null
    const selection = document.getSelection()
    const range = selection?.rangeCount && inEditor(selection.anchorNode) ? selection.getRangeAt(0) : document.createRange()
    if (!inEditor(range.startContainer)) { range.selectNodeContents(body); range.collapse(false) }
    const image = document.createElement('img')
    image.src = src
    image.alt = alt
    image.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;margin:16px auto;'
    range.deleteContents()
    range.insertNode(image)
    range.setStartAfter(image)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    done()
    return image
  }

  function insertLink(url) {
    exec('createLink', url)
  }

  // 清除格式：去掉文字样式，并把选中段落的样式恢复成普通正文
  function clearFormat() {
    exec('removeFormat')
    for (const block of selectedBlocks(false)) block.removeAttribute('style')
    document.execCommand('formatBlock', false, 'p')
    done()
  }

  // 格式刷：先在有格式的文字上点一下复制，再选中要刷的文字
  function copyFormat() {
    if (state.painter) {
      state.painter = null
      return
    }
    const node = saved?.startContainer
    const element = node?.nodeType === 1 ? node : node?.parentElement
    if (!inEditor(element)) return
    const computed = getComputedStyle(element)
    const styles = Object.fromEntries(INLINE_COPY.map((key) => [key, computed[key]]))
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(styles.backgroundColor)) delete styles.backgroundColor
    state.painter = styles
  }

  function paint() {
    const range = saved
    const styles = state.painter
    if (!range || range.collapsed || !styles) return
    for (const block of selectedBlocks(false)) {
      const part = document.createRange()
      part.selectNodeContents(block)
      if (block.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset)
      if (block.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset)
      if (part.collapsed) continue
      const span = document.createElement('span')
      Object.assign(span.style, styles)
      span.append(part.extractContents())
      for (const inner of span.querySelectorAll('[style]')) {
        for (const key of Object.keys(styles)) inner.style[key] = ''
      }
      part.insertNode(span)
    }
    state.painter = null
    onChange()
  }

  function onSelectionChange() {
    remember()
  }

  function onMouseUp() {
    remember()
    if (state.painter) paint()
  }

  onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
  onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))

  return { state, exec, setBlock, setBlockStyle, toggleIndent, setFontSize, insertDivider, insertLink, clearFormat,
    copyFormat, onMouseUp, remember, insertImage }
}
