const ENGINES = require('./search-engines.json')
const SEARCH_DEFAULTS = { engines: ENGINES.map(item => item.id) }

function normalizeSearch(patch = {}, previous = SEARCH_DEFAULTS) {
  const value = patch.engines ?? previous.engines
  if (!Array.isArray(value) || !value.length || value.length > ENGINES.length
    || value.some(id => typeof id !== 'string' || !ENGINES.some(item => item.id === id))) {
    throw new Error('请至少选择一个受支持的搜索引擎')
  }
  return { engines: [...new Set(value)] }
}

function configuredEngines(settings) {
  const value = normalizeSearch(settings?.private().search || {})
  return value.engines.map(id => ENGINES.find(engine => engine.id === id))
}

module.exports = { ENGINES, SEARCH_DEFAULTS, normalizeSearch, configuredEngines }
