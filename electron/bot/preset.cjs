// Editable starter memories are initialized once; user edits and deletions are never reset.
const { createMemory } = require('./memory.cjs')

const FACTORY_MEMORIES = [
  { title: '运营协作方式', content: '围绕作者当前目标协助选题、资料核实、撰写、配图、排版和运营任务。先确认已有资料与实际结果，不替作者推断未设定的偏好。', pinned: true },
  { title: '文章模板约定', content: '作者点名时使用指定的文章模板；没有点名时使用当前默认模板；没有模板时再按作者明确的写作偏好组织内容。新文章不照抄范文的事实与句子。', pinned: true },
  { title: '配图与素材偏好', content: '配图张数、风格、水印、品牌标识和商业展示是否采用，由作者自行设定和修改；没有明确要求时不替作者添加禁令。', pinned: true },
]

function initializeBotPreset(store, accountId, { memoryEnabled = true } = {}) {
  store.transaction(() => {
    if (!store.claimMarker(accountId, 'bot-editorial-defaults-removed-v1')) return
    const current = FACTORY_MEMORIES.find(item => item.title === '配图与素材偏好')
    const legacy = `${current.content}保留真实来源，使用授权与视觉安全分别核实。`
    for (const item of store.list('bot_memories', accountId)) {
      if (item.source === 'preset' && item.title === current.title && item.content === legacy) {
        createMemory(store).save(accountId, { id: item.id, content: current.content })
      }
    }
  })
  if (!memoryEnabled) return false
  return store.transaction(() => {
    if (!store.claimMarker(accountId, 'bot-factory-memories-v1')) return false
    if (store.list('bot_memories', accountId).length) return false
    const memory = createMemory(store)
    for (const item of FACTORY_MEMORIES) memory.save(accountId, item, 'preset')
    return true
  })
}

module.exports = { FACTORY_MEMORIES, initializeBotPreset }
