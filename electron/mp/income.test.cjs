const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { createIncomeService, adsSummary, paidSummary, rewardSummary, integerOrNull, mergeIncome, readPaidOverview, readRewardOverview } = require('./income.cjs')

const date = '2026-11-07'
const opened = { account_info: { acct_status: 1 }, publisher_info: { bank_account_no: 'SECRET_BANK_ACCOUNT' } }

test('income preserves explicit zero, missing fields and integer cents without silently coercing bad values', () => {
  for (const value of [undefined, null, '', false, true, 'not-a-number', '1,000', 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(integerOrNull(value), null)
  assert.equal(integerOrNull(0), 0)
  assert.equal(integerOrNull('12345'), 12345)
  assert.equal(integerOrNull('-120'), -120)
  const actual = adsSummary(opened, { yesterday_income: 0, total_income: 12345 }, date)
  assert.equal(actual.metrics[0].value, 0)
  assert.equal(actual.metrics[1].value, null)
  assert.equal(actual.metrics[2].value, 12345)
  assert.equal(actual.metrics[0].date, date)
  assert.equal(actual.metrics[0].unit, 'CNY')
  assert.doesNotMatch(JSON.stringify(actual), /SECRET_BANK_ACCOUNT/)
})

test('unopened or unrecognized ad accounts never turn an empty response into zero income', () => {
  assert.equal(adsSummary({ account_info: { acct_status: 0 } }, {}, date).status, 'not_open')
  assert.equal(adsSummary({}, {}, date).status, 'unavailable')
  assert.throws(() => adsSummary(opened, {}, date), /未返回/)
})

test('paid reading keeps yuan cents and WeChat coins separate', () => {
  const result = paidSummary({ canUsePaySubscribe: 1, totalPayMoney: '12345', totalYesterdayNewMoney: 0,
    totalWeCoin: 900, totalYesterdayWeCoin: 20, bankAccountNum: 'SECRET' }, date)
  assert.equal(result.metrics[0].value, 12345)
  assert.equal(result.metrics[0].unit, 'CNY')
  assert.equal(result.metrics.find(item => item.id === 'coins').value, 900)
  assert.equal(result.metrics.find(item => item.id === 'coins').unit, 'WECOIN')
  assert.equal(result.metrics.find(item => item.id === 'yesterday').value, 0)
  assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  assert.equal(paidSummary({ canUsePaySubscribe: 0, totalPayMoney: 0 }, date).status, 'not_open')
  assert.throws(() => paidSummary({ canUsePaySubscribe: 1 }, date), /未返回/)
})

test('reward summaries never treat the selected article or author earnings as account-wide income', () => {
  const value = rewardSummary({ articleCount: 4, totalInviteAuthorCnt: 2, totalRewardMoney: 100000, bizTotalRewardMoney: 200000 })
  assert.equal(value.status, 'no_summary')
  assert.equal(value.metrics[0].value, null)
  assert.equal(value.metrics.find(item => item.id === 'articles').value, 4)
  assert.doesNotMatch(JSON.stringify(value), /100000|200000/)
})

test('page readers return only whitelisted summary fields, not financial identity or payer data', () => {
  const data = { canUsePaySubscribe: 1, totalPayMoney: 12345, totalWeCoin: 20, articleCount: 4, totalInviteAuthorCnt: 2,
    bankAccountNum: 'SECRET_BANK', bankName: 'SECRET_BANK_NAME', personalBindPhone: 'SECRET_PHONE',
    payList: [{ nickname: 'SECRET_PAYER' }], rewardList: [{ author: 'SECRET_AUTHOR' }] }
  for (const reader of [readPaidOverview, readRewardOverview]) {
    const result = vm.runInNewContext(`(${reader.toString()})()`, { window: { wx: { cgiData: data } } })
    assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  }
})

test('the income service calls only verified read endpoints, skips unopened ads and isolates partial failures', async () => {
  const calls = []
  const service = createIncomeService({ transport: {
    request: async (id,path) => { calls.push([id,path]); return { account_info: { acct_status: 0 } } },
    readPage: async (id,path) => { calls.push([id,path]); if (path.includes('/reward')) throw new Error('Network unavailable');
      return { canUsePaySubscribe: 1, totalPayMoney: 0, totalYesterdayNewMoney: 0 } },
    open: async () => { throw new Error('Income reads must not open windows') },
  }, now: () => Date.parse('2026-11-08T02:00:00Z') })
  const result = await service.getIncome('account-a')
  assert.equal(calls.length, 3)
  assert.ok(calls.every(([id]) => id === 'account-a'))
  assert.equal(calls.some(([,path]) => path.includes('publisher_stat')), false)
  assert.equal(result.income.channels[0].status, 'not_open')
  assert.equal(result.income.channels[1].metrics[0].value, 0)
  assert.equal(result.income.channels[2].status, 'error')
  assert.equal(result.errors.length, 1)
  assert.equal(result.income.asOf, date)
})

test('opened ad accounts request the verified overview with an explicit China-time date range', async () => {
  const requests = []
  const service = createIncomeService({ transport: {
    request: async (_id,path) => { requests.push(path); return path.includes('publisher_mgr') ? opened
      : { total_income: 50000, yesterday_income: 1200, last_week_income: 7000 } },
    readPage: async (_id,path) => path.includes('/reward') ? { articleCount: 0, totalInviteAuthorCnt: 0 }
      : { canUsePaySubscribe: 0 },
  }, now: () => Date.parse('2026-11-07T18:00:00Z') })
  const value = await service.getIncome('account-b')
  const url = new URL(requests[1], 'https://mp.weixin.qq.com')
  assert.equal(url.searchParams.get('start_date'), '2026-11-01')
  assert.equal(url.searchParams.get('end_date'), date)
  assert.equal(url.searchParams.get('action'), 'overview')
  assert.equal(value.income.channels[0].metrics[0].value, 1200)
  assert.equal(value.errors.length, 0)
})

test('an income refresh failure preserves last successful values with their old date and timestamp', () => {
  const previous = { channels: [{ id: 'ads', status: 'ready', metrics: [{ id: 'yesterday', value: 1234, date }], updatedAt: 100 }] }
  const next = { channels: [{ id: 'ads', status: 'error', metrics: [], error: 'Timeout', updatedAt: 200 }] }
  const result = mergeIncome(previous, next)
  assert.equal(result.channels[0].status, 'stale')
  assert.equal(result.channels[0].metrics[0].value, 1234)
  assert.equal(result.channels[0].metrics[0].date, date)
  assert.equal(result.channels[0].updatedAt, 100)
  assert.equal(result.channels[0].lastAttemptAt, 200)
  assert.equal(mergeIncome(previous, { channels: [{ id: 'ads', status: 'not_open', metrics: [] }] }).channels[0].metrics.length, 0)
})

test('income detail links are whitelisted and never expose a caller-supplied financial action', async () => {
  const calls = []
  const service = createIncomeService({ transport: { open: async (id,path) => { calls.push([id,path]); return { opened: true } } } })
  await service.openIncome('a','paid')
  assert.deepEqual(calls, [['a','/merchant/mppaysubscribe?action=getlatestpay']])
  assert.throws(() => service.openIncome('a','withdraw'), /不支持/)
  assert.throws(() => service.openIncome('a','https://example.com'), /不支持/)
})
