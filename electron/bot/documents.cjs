// Parse supported documents locally. Archive members are streamed and bounded before DOCX parsing.
async function inspectDocx(bytes) {
  const yauzl = require('yauzl')
  return new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error) return reject(new Error('DOCX 文件无法读取'))
    let total = 0, hasDocument = false, settled = false
    const fail = cause => { if (!settled) { settled = true; zip.close(); reject(cause) } }
    zip.on('error', () => fail(new Error('DOCX 压缩内容无效')))
    zip.on('entry', entry => {
      if (entry.uncompressedSize > 20 * 1024 * 1024 || /(^|\/)\.\.(\/|$)|^[\\/]|\0/.test(entry.fileName)) return fail(new Error('DOCX 文件内容超限或路径无效'))
      if (entry.fileName === 'word/document.xml') hasDocument = true
      if (/\/$/.test(entry.fileName)) return zip.readEntry()
      zip.openReadStream(entry, (cause, stream) => {
        if (cause) return fail(new Error('DOCX 内容无法解压'))
        stream.on('data', chunk => { total += chunk.length; if (total > 20 * 1024 * 1024) { stream.destroy(); fail(new Error('DOCX 解压后超过 20MB')) } })
        stream.on('error', () => fail(new Error('DOCX 内容不完整')))
        stream.on('end', () => { if (!settled) zip.readEntry() })
      })
    })
    zip.on('end', () => { if (!settled) { settled = true; hasDocument ? resolve() : reject(new Error('文件不是有效的 DOCX 文档')) } })
    zip.readEntry()
  }))
}

async function extractDocumentLocally(bytes, extension) {
  let text, pages = null, extractedPages = null
  if (extension === '.pdf') {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF')
    const { PDFParse } = require('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
    let timer
    try {
      const result = await Promise.race([(async () => {
        const info = await parser.getInfo()
        pages = info.total; extractedPages = pages
        return parser.getText({ pageJoiner: '\n\n' })
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 解析超时，请精简文档后重试')), 20000) })])
      text = result.text
    } finally { clearTimeout(timer); await parser.destroy() }
  } else if (extension === '.docx') {
    await inspectDocx(bytes)
    text = (await require('mammoth').extractRawText({ buffer: bytes }, { externalFileAccess: false })).value
  } else {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
    catch { try { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes) } catch { throw new Error('文本文件编码无法识别，请转换为 UTF-8') } }
    if (/\0/.test(text)) throw new Error('文件包含二进制内容，无法作为文本读取')
  }
  text = String(text || '').replace(/\u0000/g, '').trim()
  if (!text) throw new Error(extension === '.pdf' ? 'PDF 没有可提取文字；扫描件请改发图片' : '文件没有可读取的文字')
  return { text, characters: text.length, truncated: false, pages, extractedPages }
}
async function extractDocument(bytes, extension) {
  const { fork } = require('node:child_process')
  const worker = fork(require.resolve('./document-worker.cjs'), [], {
    execPath: process.execPath, execArgv: ['--max-old-space-size=128'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
    serialization: 'advanced', stdio: ['ignore','ignore','ignore','ipc'],
  })
  let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('附件解析超时，请精简文档后重试')), 30000)
      worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result.value))
      worker.on('error', () => reject(new Error('附件解析失败或内容超出资源限制')))
      worker.once('exit', () => reject(new Error('附件解析已停止，未保存不完整内容')))
      worker.send({ bytes, extension })
    })
  } finally { clearTimeout(timer); if (worker.connected) worker.disconnect(); worker.kill() }
}
module.exports = { extractDocument, extractDocumentLocally, inspectDocx }
