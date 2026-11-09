// 验证统计只取微信汇总场景、区分人数与缺失值，并按中国时区生成日期区间。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dateRange, parseTrend, parseFollowers } = require('./stats.cjs')

test('seven-day trend uses scene 9999 without adding duplicated channel users', () => {
  const dates = ['2026-10-27', '2026-10-28', '2026-10-29']
  const result = parseTrend({ all_article_stat_tendency: { list: [
    { date: 1793030400, scene: 9999, read_uv: 38, share_uv: 2 },
    { date: 1793030400, scene: 0, read_uv: 2, share_uv: 0 },
    { date: 1793030400, scene: 7, read_uv: 35, share_uv: 0 },
    { date: 1793116800, scene: 9999, read_uv: 152, share_uv: 7 },
  ] } }, dates)
  assert.deepEqual(result.map((row) => row.reads), [38, 152, null])
  assert.deepEqual(result.map((row) => row.shares), [2, 7, null])
})

test('explicit zero lost followers is preserved but an absent summary stays unknown', () => {
  const data = { category_list: [{ user_source: 99999999, list: [
    { date: '2026-11-01', new_user: 1, cancel_user: 0, cumulate_user: 6 },
  ] }] }
  assert.deepEqual(parseFollowers(data, '2026-11-01'), { newFollowers: 1, lost: 0, total: 6 })
  assert.deepEqual(parseFollowers(data, '2026-10-31'), { newFollowers: null, lost: null, total: null })
})

test('mass counts come from the editor quota, preserving unknown and zero without API-call substitution',async()=>{
  const {createStatsService}=require('./stats.cjs')
  for(const left of [0,1,null,undefined,'',' ',true,0.5,-1]){
    const service=createStatsService({accounts:{find:()=>({type:'公众号'})},transport:{readPage:async(_id,_url,expression)=>{assert.match(expression,/mass_send_left/);assert.doesNotMatch(expression,/daily_remaining/);return {left}}}})
    const quota=await service.getMassQuota('a');assert.equal(quota.left,left===0||left===1?left:null);assert.equal(quota.total,null);assert.equal(quota.period,'今日')
  }
})

test('range uses yesterday in China even when UTC date differs', () => {
  const range = dateRange(Date.parse('2026-11-01T16:10:00Z'))
  assert.equal(range.dates[0], '2026-10-26')
  assert.equal(range.dates[6], '2026-11-01')
  assert.equal(range.end, Date.parse('2026-11-01T00:00:00+08:00'))
})
