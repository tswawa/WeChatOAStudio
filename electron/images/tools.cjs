const IMAGE_TOOLS = [
  { type: 'function', function: { name: 'search_images',
    description: '联网搜索文章配图，返回真实候选编号和来源；需完成视觉审核后才能保存使用。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', description: '具体图片关键词；可按文章段落分开搜索' },
      limit: { type: 'integer', minimum: 1, description: '需要的候选数量；省略则保留本次来源实际返回的全部候选' },
    }, required: ['query'] } } },
  { type: 'function', function: { name: 'prepare_image',
    description: '安全读取一张来源配图、指定链接或搜索候选，用当前模型查看像素并审核，通过后才保存到指定目录。返回正文可引用的图片编号。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', description: '来源读取或搜图返回的真实候选编号' },
      topic: { type: 'string', description: '文章主题及该图片对应的段落内容，用于视觉相关性审核' },
    }, required: ['id', 'topic'] } } },
]

module.exports = { IMAGE_TOOLS }
