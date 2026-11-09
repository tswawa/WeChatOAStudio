// Read-only income summaries. Never return bank details, payout controls or individual payer records.
const SOURCES = require('./income-sources.json')
const { dateRange } = require('./stats.cjs')

function integerOrNull(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value.trim()))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}
const countOrNull = value => { const number = integerOrNull(value); return number !== null && number >= 0 ? number : null }
const metric = (id, label, value, unit = 'CNY', date = null) => ({ id, label, value: integerOrNull(value), unit, date })

function adsSummary(info, overview, asOf) {
  const status = countOrNull(info?.account_info?.acct_status)
  if (status === 0) return { status: 'not_open', note: '未开通流量主', metrics: [] }
  if (status !== 1) return { status: 'unavailable', note: status === null ? '未返回流量主账户状态' : '流量主账户状态待核实', metrics: [] }
  const metrics = [metric('yesterday', '昨日收入', overview?.yesterday_income, 'CNY', asOf),
    metric('week', '近 7 日收入', overview?.last_week_income), metric('total', '累计收入', overview?.total_income)]
  if (metrics.every(item => item.value === null)) throw new Error('微信未返回流量主收入汇总，请稍后重试')
  return { status: 'ready', note: '平台统计收入，非到账金额', metrics }
}

function paidSummary(value, asOf) {
  const enabled = value?.canUsePaySubscribe
  if ([0, '0', false].includes(enabled)) return { status: 'not_open', note: '未开通付费阅读', metrics: [] }
  const metrics = [metric('total', '累计人民币收款', value?.totalPayMoney),
    metric('yesterday', '昨日人民币收款', value?.totalYesterdayNewMoney, 'CNY', asOf)]
  const coins = countOrNull(value?.totalWeCoin), yesterdayCoins = countOrNull(value?.totalYesterdayWeCoin)
  if (coins !== null && (coins > 0 || metrics[0].value === null)) metrics.push(metric('coins', '累计微信豆', coins, 'WECOIN'))
  if (yesterdayCoins !== null && (yesterdayCoins > 0 || (metrics[1].value === null && coins !== null))) {
    metrics.push(metric('yesterday_coins', '昨日微信豆', yesterdayCoins, 'WECOIN', asOf))
  }
  if (metrics.every(item => item.value === null)) throw new Error('微信未返回付费阅读收入汇总，请稍后重试')
  return { status: 'ready', note: '人民币与微信豆分别统计', metrics }
}

function rewardSummary(value) {
  const articles = countOrNull(value?.articleCount)
  const authors = countOrNull(value?.totalInviteAuthorCnt)
  if (articles === null && authors === null) throw new Error('微信未返回赞赏概况，请稍后重试')
  // The page's money fields describe the selected article/author, not an account-wide income total.
  return { status: 'no_summary', note: '金额以赞赏账户为准', metrics: [metric('total', '账号金额汇总', null),
    ...(articles === null ? [] : [metric('articles', '赞赏文章', articles, 'ARTICLE')])], }
}

function readPaidOverview() {
  const data = window.wx?.cgiData || {}
  const keys = ['canUsePaySubscribe', 'totalPayMoney', 'totalYesterdayNewMoney', 'totalWeCoin', 'totalYesterdayWeCoin']
  return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
}

function readRewardOverview() {
  const data = window.wx?.cgiData || {}
  const keys = ['articleCount', 'totalInviteAuthorCnt']
  return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
}

function mergeIncome(previous, next) {
  return { ...next, channels: next.channels.map(channel => {
    const old = previous?.channels?.find(item => item.id === channel.id)
    if (channel.status !== 'error' || !old?.metrics?.some(item => item.value !== null)) return channel
    return { ...old, status: 'stale', error: channel.error, lastAttemptAt: channel.updatedAt }
  }) }
}

function createIncomeService({ transport, now = Date.now }) {
  async function getIncome(accountId) {
    const range = dateRange(now())
    const asOf = range.dates[6]
    const channels = await Promise.all(SOURCES.map(async source => {
      try {
        let summary
        if (source.id === 'ads') {
          const info = await transport.request(accountId, '/promotion/publisher/publisher_mgr?action=GetInfo')
          const overview = integerOrNull(info?.account_info?.acct_status) === 1
            ? await transport.request(accountId, '/promotion/publisher/publisher_stat?' + new URLSearchParams({
              action: 'overview', start_date: range.dates[0], end_date: asOf, result_type: '1',
            })) : null
          summary = adsSummary(info, overview, asOf)
        } else if (source.id === 'paid') {
          summary = paidSummary(await transport.readPage(accountId, source.path, `(${readPaidOverview.toString()})()`), asOf)
        } else summary = rewardSummary(await transport.readPage(accountId, source.path, `(${readRewardOverview.toString()})()`))
        return { id: source.id, ...summary, updatedAt: now() }
      } catch (error) {
        const denied = [48001, 48002].includes(Number(error.code))
        return { id: source.id, status: denied ? 'unavailable' : 'error', metrics: [],
          note: denied ? '当前账号没有该接口权限' : '暂时无法读取', error: denied ? '' : error.message, updatedAt: now() }
      }
    }))
    return { income: { channels, asOf, updatedAt: now() },
      errors: channels.filter(channel => channel.status === 'error').map(channel => `${SOURCES.find(item => item.id === channel.id).name}：${channel.error}`) }
  }
  function openIncome(accountId, sourceId) {
    const source = SOURCES.find(item => item.id === sourceId)
    if (!source) throw new Error('不支持的收入来源')
    return transport.open(accountId, source.path)
  }
  return { getIncome, openIncome }
}

module.exports = { createIncomeService, adsSummary, paidSummary, rewardSummary, integerOrNull, mergeIncome, readPaidOverview, readRewardOverview }
