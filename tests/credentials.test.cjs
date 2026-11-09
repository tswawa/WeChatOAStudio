// Password retry limits survive app restarts; credentials never reach non-WeChat pages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createCredentialStore } = require('../electron/store/credentials.cjs');
const { fillPasswordLogin } = require('../electron/mp/password-login.cjs');

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(text).map(byte => byte ^ 123),
  decryptString: buffer => Buffer.from(buffer).map(byte => byte ^ 123).toString(),
};

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const directory = mkdtempSync(join(tmpdir(), 'oa-credentials-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); t.mock.timers.reset(); });
  const path = join(directory, 'logins.json');
  const store = createCredentialStore(path, encryption);
  store.save('a', { account: 'account@example.test', password: 'secret-password' });
  return { path, store };
}

test('automatic password attempts are at least thirty minutes apart across restarts', t => {
  const { path, store } = setup(t);
  assert.equal(store.claimAttempt('a'), true);
  assert.equal(store.claimAttempt('a'), false);
  const reopened = createCredentialStore(path, encryption);
  assert.equal(reopened.canAttempt('a'), false);
  t.mock.timers.setTime(Date.now() + 30 * 60 * 1000 - 1);
  assert.equal(reopened.claimAttempt('a'), false);
  t.mock.timers.setTime(Date.now() + 1);
  assert.equal(reopened.claimAttempt('a'), true);
  assert.equal(reopened.status('a').password, undefined);
  assert.equal(readFileSync(path, 'utf8').includes('secret-password'), false);
});

test('at most three automatic attempts are permitted per rolling day, including after changing a password', t => {
  const { path, store } = setup(t);
  const start = Date.now();
  assert.equal(store.claimAttempt('a'), true);
  t.mock.timers.setTime(start + 30 * 60 * 1000);
  assert.equal(store.claimAttempt('a'), true);
  t.mock.timers.setTime(start + 60 * 60 * 1000);
  assert.equal(store.claimAttempt('a'), true);
  const reopened = createCredentialStore(path, encryption);
  reopened.save('a', { account: 'account@example.test', password: 'updated-password' });
  t.mock.timers.setTime(start + 23 * 60 * 60 * 1000);
  assert.equal(reopened.claimAttempt('a'), false);
  t.mock.timers.setTime(start + 24 * 60 * 60 * 1000);
  assert.equal(reopened.claimAttempt('a'), true);
});

test('wrong passwords and provider rate limits pause automatic login until an explicit update', t => {
  const { path, store } = setup(t);
  store.markFailed('a', 'Password rejected');
  t.mock.timers.setTime(Date.now() + 48 * 60 * 60 * 1000);
  const reopened = createCredentialStore(path, encryption);
  assert.equal(reopened.claimAttempt('a'), false);
  reopened.save('a', { account: 'account@example.test', password: 'updated-password' });
  assert.equal(reopened.claimAttempt('a'), true);
  reopened.remove('a');
  assert.equal(reopened.claimAttempt('a'), false);
});

test('password autofill refuses insecure, foreign and destroyed pages without evaluating the password', async () => {
  let evaluations = 0;
  for (const url of ['http://mp.weixin.qq.com/', 'https://mp.weixin.qq.com.attacker.test/',
    'https://mp.weixin.qq.com@attacker.test/', 'data:text/html,login']) {
    const result = await fillPasswordLogin({ isDestroyed: () => false, getURL: () => url,
      executeJavaScript: async () => { evaluations += 1; } }, { account: 'account', password: 'secret' });
    assert.equal(result, 'blocked');
  }
  assert.equal(evaluations, 0);
});
