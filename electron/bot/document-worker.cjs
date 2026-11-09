const { extractDocumentLocally } = require('./documents.cjs')
process.once('message', ({bytes,extension}) => {
  extractDocumentLocally(Buffer.from(bytes), extension).then(
    value => process.send({ value }),
    error => process.send({ error: /^(?:[\u4e00-\u9fff]|DOCX|PDF)/.test(error.message) ? error.message : '附件解析失败，请检查文件是否完整、受密码保护或格式不受支持' }),
  )
})
