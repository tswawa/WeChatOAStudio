// 验证本机代理的成对 fake-IP 映射可采集，普通内网、单独 ULA 和直接 IP 仍拒绝。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { allowedAddresses } = require('./content.cjs')

const pair = [
  { address: '198.18.0.126', family: 4 },
  { address: 'fdfe:dcba:9876::7e', family: 6 },
]

test('verified proxy mapping pair is permitted only for public domain names', () => {
  assert.equal(allowedAddresses('www.electronjs.org', pair), true)
  assert.equal(allowedAddresses('example.com', [
    { address: '198.18.0.133', family: 4 }, { address: 'fdfe:dcba:9876::86', family: 6 },
  ]), true)
  for (const host of ['localhost', 'device.local', 'host.lan', 'router.internal', '198.18.0.126']) {
    assert.equal(allowedAddresses(host, pair), false, host)
  }
})

test('ordinary private DNS results and incomplete proxy mappings remain blocked', () => {
  for (const addresses of [
    [{ address: '127.0.0.1' }], [{ address: '::1' }], [{ address: '192.168.1.2' }],
    [{ address: '10.0.0.2' }], [{ address: 'fd00::1' }], [pair[0]], [pair[1]],
    [...pair, { address: '192.168.1.2' }],
    [pair[0], { address: 'fd00::1' }],
  ]) assert.equal(allowedAddresses('example.com', addresses), false)
  assert.equal(allowedAddresses('example.com', [{ address: '93.184.215.14' }]), true)
})
