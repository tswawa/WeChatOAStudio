// 验证互动页面表达式、64 位留言标识与写操作目标绑定，测试不发送微信消息。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createInteractionService, PATHS } = require('./interaction.cjs');
const { parseComments } = require('./interaction-parsers.cjs');
const { readAccountProfile } = require('./account-profile.cjs');

function fixture() {
  const writes = [];
  const comments = { list: [{ item: { title: '文章', comment_id: '9007199254740993001' }, comment: {
    comment: [{ id: '9007199254740993002', content_id: '9007199254740993003', nick_name: '读者', content: '留言' }],
  } }] };
  const responses = {
    [PATHS.comments]: comments,
    [PATHS.messages]: { msgList: [{ fakeid: 'reader-1', nick_name: '读者', content: '你好', date_time: 10 }] },
    [PATHS.follow]: { replytype: 'beadded', rule_id: '1', data: { type: 1, content: '欢迎' } },
    [PATHS.fallback]: { replytype: 'autoreply' },
    [PATHS.keywords]: { list: [] },
    [PATHS.users]: { user_list: [], group_list: [], total_user_num: 0 },
    [PATHS.account]: { name: '公众号' },
    [PATHS.members]: [],
    [PATHS.menu]: { menu: { version: 1, name: '', button_list: [] } },
  };
  const transport = {
    readPage: async (_id, path, expression) => {
      new vm.Script(expression);
      return structuredClone(responses[path]);
    },
    request: async (_id, path, options) => {
      if (!options?.method || options.method === 'GET') {
        const url = new URL(path, 'https://mp.weixin.qq.com');
        if (url.searchParams.get('action') === 'list_latest_comment') {
          return { app_msg_list: JSON.stringify({ app_msg: comments.list, total_count: comments.list.length }) };
        }
        if (url.searchParams.get('action') === 'list_comment') {
          return { comment_list: JSON.stringify({ comment: comments.list[0].comment.comment, total_count: 1 }) };
        }
      }
      writes.push({ path, ...options });
      return { base_resp: { ret: 0 } };
    },
  };
  return { service: createInteractionService({ transport }), writes, responses, comments };
}

test('read expressions compile and an absent automatic reply is a valid empty rule', async () => {
  const { service } = fixture();
  const result = await service.get('account');
  assert.deepEqual(result.errors, {});
  assert.equal(result.autoReply.fallback, '');
  assert.equal(result.autoReply.fallbackId, '0');
});

test('account profile uses the settings global and excludes administrator personal data', async () => {
  const fields = { 类型: '公众号', 主体信息: '陈** (个人)\n详情 账号迁移', 认证情况: '未认证\n申请微信认证' };
  const context = vm.createContext({
    URL,
    TypeError,
    window: { cgiData: { nickname: '测试号', original_username: 'gh_account', alias: 'alias', intro: '介绍',
      operator_mobile: 'must-not-leak', principal_name: 'must-not-leak' } },
    document: {
      querySelectorAll: () => Object.entries(fields).map(([label, content]) => ({
        querySelector: (selector) => selector.endsWith('__label')
          ? { textContent: label } : { innerText: content },
      })),
      createElement: () => ({ set innerHTML(value) { this.value = value; } }),
    },
    setTimeout,
  });
  const profile = await vm.runInContext(`(${readAccountProfile.toString()})()`, context);
  assert.equal(profile.originalId, 'gh_account');
  assert.equal(profile.subject, '个人');
  assert.equal(profile.type, '公众号');
  assert.equal(profile.verified, false);
  assert.equal(profile.intro, '介绍');
  assert.equal(JSON.stringify(profile).includes('must-not-leak'), false);
});

test('comment IDs remain exact strings and replies bind to the refreshed article', async () => {
  const { service, writes, comments } = fixture();
  const comment = parseComments(comments)[0];
  assert.equal(comment.id, '9007199254740993003');
  await assert.rejects(service.reply('account', { kind: 'comment', id: comment.id, articleId: 'wrong', text: '回复' }));
  assert.equal(writes.length, 0);
  await service.reply('account', { kind: 'comment', id: comment.id, articleId: comment.articleId, text: '回复' });
  assert.equal(writes[0].fields.content_id, '9007199254740993003');
  await service.featureComment('account', { id: comment.id, articleId: comment.articleId, featured: false });
  assert.equal(writes[1].fields.action, 'remove_good_comment');
});

test('private read receipts only target an existing conversation', async () => {
  const { service, writes } = fixture();
  await assert.rejects(service.readMessage('account', { id: 'not-a-reader' }));
  assert.equal(writes.length, 0);
  await service.readMessage('account', { id: 'reader-1' });
  assert.deepEqual(JSON.parse(writes[0].fields.fakeid), { fakeid: ['reader-1'] });
});

test('complex rules and unsupported menu types are rejected before writes', async () => {
  const { service, writes, responses } = fixture();
  responses[PATHS.fallback].isAiOpen = true;
  await assert.rejects(service.saveAutoReply('account', { follow: '新欢迎', fallback: '替换' }));
  await assert.rejects(service.saveMenu('account', { menu: [{ name: '事件', type: 'click', key: 'KEY' }] }));
  assert.equal(writes.length, 0);
  await service.saveMenu('account', { menu: [{ name: '网址', type: 'view', url: 'https://example.com' }] });
  assert.match(writes[0].path, /checknew/);
  assert.match(writes[1].path, /update_sync/);
  assert.equal(JSON.parse(writes[1].fields.info).button_list[0].act_list[0].type, 6);
});
