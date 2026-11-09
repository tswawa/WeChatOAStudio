// 验证扫码发表只按微信已确认的源草稿编号匹配，并在重复刷新和重启后保持幂等。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createOpsStore } = require('./store.cjs')
const { reconcilePublished } = require('./published.cjs')

function run(id, draftId, status) {
  return { id, draftId, status, name: 'Shared title', steps: [{ key: 'publish', state: 'pending', note: '' }] }
}

test('only exact confirmed manual publications reconcile and repeated refresh cannot notify twice', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mp-published-'))
  const path = join(directory, 'ops.sqlite')
  let store = createOpsStore(path)
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  store.put('runs', 'a', run('r1', '101', 'waiting_scan'))
  store.put('runs', 'a', run('r2', '102', 'drafted'))
  store.put('runs', 'a', run('r3', '103', 'scheduled'))
  store.put('runs', 'a', run('r4', '104', 'waiting_scan'))
  store.put('runs', 'a', run('r5', '105', 'waiting_scan'))
  store.put('runs', 'b', run('r6', '101', 'waiting_scan'))
  const publications = [
    { id: 'p1', sourceDraftId: 101, publishConfirmed: true },
    { id: 'p2', sourceDraftId: '102', publishConfirmed: true },
    { id: 'p3', sourceDraftId: '103', publishConfirmed: true },
    { id: 'p4', sourceDraftId: '104', publishConfirmed: false },
    { id: 'p5', title: 'Shared title', publishConfirmed: true },
    { id: 'p6', sourceDraftId: '105', publishConfirmed: true, deleted: true },
  ]
  let notifications = 0
  const notify = () => { notifications += 1 }
  const result = reconcilePublished(store, 'a', publications, notify)
  assert.deepEqual(result.updated.map((item) => item.id), ['r1', 'r2'])
  assert.equal(store.get('runs', 'a', 'r1').publishedId, 'p1')
  assert.equal(store.get('runs', 'a', 'r1').steps[0].state, 'done')
  assert.equal(store.get('runs', 'a', 'r3').status, 'scheduled')
  assert.equal(store.get('runs', 'a', 'r4').status, 'waiting_scan')
  assert.equal(store.get('runs', 'a', 'r5').status, 'waiting_scan')
  assert.equal(store.get('runs', 'b', 'r6').status, 'waiting_scan')
  assert.equal(store.list('messages', 'a').length, 2)
  assert.equal(notifications, 1)
  store.close()
  store = createOpsStore(path)
  assert.deepEqual(reconcilePublished(store, 'a', publications, notify), { updated: [] })
  assert.equal(store.list('messages', 'a').length, 2)
  assert.equal(notifications, 1)
})
