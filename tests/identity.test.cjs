// 验证外部地址、无稳定账号身份和危险头像地址不能混入已登录账号资料。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMpUrl, normalizeIdentity } = require('../electron/mp/identity.cjs');

test('only official HTTPS origin is trusted', () => {
  assert.equal(isMpUrl('https://mp.weixin.qq.com/cgi-bin/home?token=123'), true);
  for (const url of ['http://mp.weixin.qq.com', 'https://mp.weixin.qq.com.attacker.test',
    'https://mp.weixin.qq.com@attacker.test', 'file:///tmp/account', 'javascript:alert(1)']) {
    assert.equal(isMpUrl(url), false);
  }
});

test('login requires an authenticated stable identity and name', () => {
  assert.equal(normalizeIdentity({ authenticated: false, originalId: 'gh_example', name: 'Example' }), null);
  assert.equal(normalizeIdentity({ authenticated: true, originalId: '', name: 'Example' }), null);
  assert.equal(normalizeIdentity({ authenticated: true, originalId: 'gh_example', name: '' }), null);
  const profile = normalizeIdentity({
    authenticated: true, originalId: 'gh_example', name: 'Example',
    avatar: 'javascript:alert(1)', token: 'must-not-leak', cookies: ['must-not-leak'],
  });
  assert.equal(profile.id, 'gh_example');
  assert.equal(profile.avatar, '');
  assert.equal(profile.verified, null);
  assert.equal('token' in profile, false);
  assert.equal('cookies' in profile, false);
});
