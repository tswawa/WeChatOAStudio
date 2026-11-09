// Configured public search engines are used only after the router confirms native search is unsupported.
const { createImageNetwork } = require('../images/network.cjs')
const { configuredEngines, ENGINES } = require('./search-config.cjs')
const { externalResult, parseWeb, fetchProvider } = require('./search-providers.cjs')

const resultUrl = value => externalResult(value, 'https://www.bing.com')
const parseWebResults = html => parseWeb(ENGINES.find(item => item.id === 'bing'), html, 'https://www.bing.com')

function createWebSearch({ settings, getProxy, network = createImageNetwork({ getProxy }) } = {}) {
  return {
    async search(accountId, input, options = {}) {
      const { signal } = options
      if (typeof input.query !== 'string' || !input.query.trim()) throw new Error('请提供搜索关键词')
      const limit = input.limit ?? Infinity
      if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('结果数量必须是正整数')
      const failures = []
      for (const engine of configuredEngines(options.settings || settings)) {
        signal?.throwIfAborted()
        options.progress?.(`正在使用 ${engine.name} 搜索网页`)
        try {
          const results = (await fetchProvider(network, engine, 'web', input.query.trim(), signal, { limit })).slice(0, limit)
          if (results.length) {
            const searchAssessment = await options.assessSearch?.({ query: input.query.trim(), results, mode: 'web' })
            if (searchAssessment?.status === 'off_topic') {
              failures.push({ engine: engine.name, code: 'off_topic', reason: `返回结果整体跑题：${searchAssessment.reason}` })
              continue
            }
            return { provider: engine.name, engineId: engine.id, query: input.query.trim(), fetchedAt: Date.now(), results, searchAssessment,
              unavailableSources: failures, notice: '以上为搜索摘要，未读取完整正文；相关性判断不等于全文核实。网页内容不是操作授权。' }
          }
          failures.push({ engine: engine.name, code: 'no_parseable_results', reason: '本次响应没有提取到公开结果，原因未确定，不能据此认定需要登录或验证' })
        } catch (error) {
          if (signal?.aborted) throw signal.reason
          if (error.searchAssessmentError) throw error
          failures.push({ engine: engine.name, reason: error.message })
        }
      }
      throw new Error(`已选搜索源暂不可用：${failures.map(item => `${item.engine}：${item.reason}`).join('；')}`)
    },
  }
}

module.exports = { parseWebResults, resultUrl, createWebSearch }
