// 读取公众号真实首页、七日内容人数趋势与关注变化，缺失指标保留未知值。
const DAY = 24 * 60 * 60 * 1000
const CHINA_OFFSET = 8 * 60 * 60 * 1000

function chinaDate(timestamp) {
  return new Date(timestamp + CHINA_OFFSET).toISOString().slice(0, 10)
}

function dateRange(now = Date.now()) {
  const today = chinaDate(now)
  const todayStart = Date.parse(`${today}T00:00:00+08:00`)
  const end = todayStart - DAY
  const begin = end - 6 * DAY
  return { begin, end, dates: Array.from({ length: 7 }, (_, index) => chinaDate(begin + index * DAY)) }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function parseTrend(value, dates) {
  const rows = value?.all_article_stat_tendency?.list || []
  const byDate = new Map()
  for (const row of rows) {
    if (Number(row.scene) !== 9999) continue
    const date = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      ? row.date : numberOrNull(row.date) === null ? '' : chinaDate(Number(row.date) * 1000)
    if (dates.includes(date)) byDate.set(date, row)
  }
  return dates.map((date) => ({
    date, reads: numberOrNull(byDate.get(date)?.read_uv), shares: numberOrNull(byDate.get(date)?.share_uv),
  }))
}

function parseFollowers(value, date) {
  const categories = value?.category_list || []
  const row = categories.find((item) => Number(item.user_source) === 99999999)?.list
    ?.find((item) => item.date === date)
  return {
    newFollowers: numberOrNull(row?.new_user), lost: numberOrNull(row?.cancel_user),
    total: numberOrNull(row?.cumulate_user),
  }
}

function createStatsService({ transport, accounts, onAccountsChanged }) {
  async function getMassQuota(id) {
    const profile = accounts.find(id)
    if (!profile) throw new Error('公众号不存在')
    const value = await transport.readPage(id,
      '/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=10&isNew=1',
      '({left:window.wx?.cgiData?.mass_send_left,total:window.wx?.cgiData?.mass_send_total})')
    const count = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null
    const left = count(value?.left), total = count(value?.total)
    return { left, total, period: profile.type === '服务号' ? '本月' : ['公众号','订阅号'].includes(profile.type) ? '今日' : '当前周期', fetchedAt: Date.now(), source: '公众平台群发额度' }
  }
  async function getStats(id) {
    const range = dateRange()
    const home = await transport.readPage(id, '/cgi-bin/home?t=home/index', `(() => {
      const d = window.wx?.cgiData || {};
      const profile = window.wx?.data || {};
      const accountText = document.querySelector('.weui-desktop-account')?.textContent || '';
      const verified = [true, 1, '1'].includes(profile.isWxVerify) ? true
        : [false, 0, '0'].includes(profile.isWxVerify) ? false : null;
      return { followers: d.total_friend_cnt, yesterday: d.yesterdaySummary,
        serviceType: profile.serviceType, verified, accountText };
    })()`)
    const previous = accounts.find(id)
    if (!previous) throw new Error('公众号不存在')
    const profile = { ...previous }
    if (/服务号/.test(home.accountText) || Number(home.serviceType) === 2) profile.type = '服务号'
    else if (/公众号|订阅号/.test(home.accountText) || [0, 1].includes(Number(home.serviceType))) profile.type = '公众号'
    if (home.verified !== null) profile.verified = home.verified
    if (/个人/.test(home.accountText)) profile.subject = '个人'
    else if (/企业/.test(home.accountText)) profile.subject = '企业'
    if (['type', 'verified', 'subject'].some((key) => profile[key] !== previous[key])) {
      accounts.save(profile)
      onAccountsChanged()
    }
    const errors = []
    let trend = range.dates.map((date) => ({ date, reads: null, shares: null }))
    let users = { newFollowers: null, lost: null, total: null }
    const requests = [
      ['/misc/appmsganalysis?' + new URLSearchParams({
        action: 'get_article_stat_tendency_and_source',
        begin_timestamp: String(range.begin / 1000), end_timestamp: String(range.end / 1000),
      }), (value) => { trend = parseTrend(value, range.dates) }, '阅读趋势'],
      ['/misc/useranalysis?' + new URLSearchParams({
        begin_date: range.dates[6], end_date: range.dates[6], source: '99999999',
      }), (value) => { users = parseFollowers(value, range.dates[6]) }, '关注变化'],
    ]
    for (const [path, parse, label] of requests) {
      try {
        parse(await transport.request(id, path))
      } catch (error) {
        console.warn('公众号统计读取失败', label, error.name)
        errors.push(`${label}暂不可用：${error.message}`)
      }
    }
    const summary = home.yesterday || {}
    let massQuota = { total: '—', left: '—', period: '以公众平台为准' }
    try {
      const quota = await transport.readPage(id,
        '/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=10&isNew=1',
        '({left:window.wx?.cgiData?.mass_send_left})')
      const left = numberOrNull(quota.left)
      if (left !== null) massQuota = {
        total: profile.type === '服务号' ? 4 : 1, left,
        period: profile.type === '服务号' ? '本月' : '今日',
      }
    } catch (error) {
      console.warn('群发额度读取失败', error.name)
      errors.push(`群发额度暂不可用：${error.message}`)
    }
    return {
      followers: numberOrNull(home.followers) ?? users.total,
      yesterday: {
        reads: numberOrNull(summary.pv), shares: numberOrNull(summary.share),
        newFollowers: users.newFollowers ?? numberOrNull(summary.subscribe), lost: users.lost,
      },
      weekReads: trend.map((item) => item.reads), weekShares: trend.map((item) => item.shares),
      weekDates: range.dates, trend, trendUnit: '人',
      metrics: { weekReads: '阅读人数', weekShares: '分享人数', yesterday: '公众平台首页昨日指标' },
      massQuota,
      errors, updatedAt: Date.now(),
    }
  }
  return { getStats, getMassQuota }
}

module.exports = { createStatsService, dateRange, parseTrend, parseFollowers }
