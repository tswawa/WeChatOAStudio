// 验证真实账号跨重启保存、身份隔离、退出范围和敏感字段不会进入账号数据库。
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { createAccountStore } = require('../electron/store/accounts.cjs')

function profile(number, extra = {}) {
  return {
    id: `gh_test_${number}`,
    originalId: `gh_test_${number}`,
    name: `Account ${number}`,
    partition: `persist:mp-00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    status: 'ready',
    verified: null,
    createdAt: number,
    ...extra,
  }
}

function openTemporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mp-accounts-'))
  const filename = join(directory, 'accounts.sqlite')
  let store = createAccountStore(filename)
  t.after(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    filename,
    get store() {
      return store
    },
    reopen() {
      store.close()
      store = createAccountStore(filename)
      return store
    },
  }
}

test('accounts and active selection survive closing and reopening the database', (t) => {
  const fixture = openTemporaryStore(t)
  fixture.store.save(profile(1))
  fixture.store.save(profile(2, { verified: true }))
  assert.equal(fixture.store.list().activeAccountId, 'gh_test_1')
  fixture.store.setActive('gh_test_2')
  fixture.store.setStatus('gh_test_1', 'expired', 1234)

  const restored = fixture.reopen()
  assert.equal(restored.list().activeAccountId, 'gh_test_2')
  assert.equal(restored.find('gh_test_2').verified, true)
  assert.equal(restored.find('gh_test_1').verified, null)
  assert.equal(restored.find('gh_test_1').status, 'expired')
  assert.equal(restored.find('gh_test_1').lastCheckedAt, 1234)
  assert.equal(restored.findByOriginalId('gh_test_1').partition, profile(1).partition)
})

test('a duplicate identity or partition cannot silently replace another account', (t) => {
  const { store } = openTemporaryStore(t)
  store.save(profile(1))
  assert.throws(() => store.save(profile(2, { originalId: 'gh_test_1' })), /已保存/)
  assert.throws(() => store.save(profile(2, { partition: profile(1).partition })), /其他账号/)
  assert.throws(() => store.save(profile(1, { partition: profile(2).partition })), /不能覆盖/)
  assert.throws(() => store.save(profile(1, { originalId: 'gh_changed' })), /不能覆盖/)
  assert.equal(store.list().accounts.length, 1)

  store.save({ id: 'gh_test_1', name: 'Renamed account', verified: false })
  assert.equal(store.find('gh_test_1').name, 'Renamed account')
  assert.equal(store.find('gh_test_1').verified, false)
  assert.equal(store.find('gh_test_1').partition, profile(1).partition)
})

test('removing one account preserves the others and deterministically selects a remaining account', (t) => {
  const { store } = openTemporaryStore(t)
  store.save(profile(1))
  store.save(profile(2))
  store.save(profile(3))
  store.setActive('gh_test_2')

  const afterInactiveRemoval = store.remove('gh_test_3')
  assert.equal(afterInactiveRemoval.activeAccountId, 'gh_test_2')
  const afterActiveRemoval = store.remove('gh_test_2')
  assert.equal(afterActiveRemoval.activeAccountId, 'gh_test_1')
  assert.deepEqual(afterActiveRemoval.accounts.map((account) => account.id), ['gh_test_1'])
  assert.throws(() => store.setActive('missing'), /不存在/)
  assert.throws(() => store.setStatus('missing', 'ready'), /不存在/)
  assert.throws(() => store.remove('missing'), /不存在/)
  assert.equal(store.list().activeAccountId, 'gh_test_1')
  assert.deepEqual(store.remove('gh_test_1'), { accounts: [], activeAccountId: null })
})

test('credentials supplied alongside a profile are discarded rather than persisted', (t) => {
  const fixture = openTemporaryStore(t)
  const sensitive = ['cookie-secret-marker', 'token-secret-marker', 'password-secret-marker']
  fixture.store.save(profile(1, {
    cookie: sensitive[0],
    token: sensitive[1],
    password: sensitive[2],
    arbitrary: 'unexpected-field',
  }))
  const restored = fixture.reopen().find('gh_test_1')
  for (const key of ['cookie', 'token', 'password', 'arbitrary']) assert.equal(key in restored, false)
  const contents = readFileSync(fixture.filename)
  for (const secret of sensitive) assert.equal(contents.includes(Buffer.from(secret)), false)
})

test('invalid account identity and malformed state fail without partial writes', (t) => {
  const { store } = openTemporaryStore(t)
  assert.throws(() => store.save(profile(1, { partition: '../another-account' })), /分区无效/)
  assert.throws(() => store.save(profile(1, { verified: 'false' })), /认证状态无效/)
  assert.throws(() => store.save(profile(1, { status: 'logged-in' })), /状态无效/)
  assert.deepEqual(store.list(), { accounts: [], activeAccountId: null })
})

test('an authenticated replacement changes only the target partition and rejects occupied partitions', (t) => {
  const fixture = openTemporaryStore(t)
  const { store } = fixture
  store.save(profile(1, { verified: true, name: 'Existing account' }))
  store.save(profile(2))
  store.setActive('gh_test_2')
  const accountBefore = store.find('gh_test_1')
  const otherBefore = store.find('gh_test_2')
  const replacement = profile(3).partition

  const snapshot = store.replacePartition('gh_test_1', replacement)
  assert.equal(snapshot.activeAccountId, 'gh_test_2')
  assert.deepEqual(store.find('gh_test_1'), { ...accountBefore, partition: replacement })
  assert.deepEqual(store.find('gh_test_2'), otherBefore)
  assert.throws(() => store.replacePartition('gh_test_1', otherBefore.partition), /其他账号/)
  assert.throws(() => store.replacePartition('gh_test_1', 'invalid'), /分区无效/)
  assert.throws(() => store.replacePartition('missing', replacement), /不存在/)
  assert.equal(store.find('gh_test_1').partition, replacement)

  const restored = fixture.reopen()
  assert.equal(restored.find('gh_test_1').partition, replacement)
  assert.equal(restored.list().activeAccountId, 'gh_test_2')
})
