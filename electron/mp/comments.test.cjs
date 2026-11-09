// 验证文章和留言分页都完整遍历，并保护 64 位原始标识与分页停滞错误。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchComments, readEmbeddedJson } = require('./comments.cjs');

test('fetches every article and additional comment pages, including non-expanded articles', async () => {
  const seen = [];
  const article = (id, count) => ({ item: { comment_id: id, title: id }, comment: { total_count: count, comment: [] } });
  const message = (n) => ({ id: String(n), content_id: `9007199254740993${String(n).padStart(3, '0')}`, content: 'text' });
  const transport = { request: async (_id, path) => {
    const url = new URL(path, 'https://mp.weixin.qq.com');
    const begin = Number(url.searchParams.get('begin'));
    const topic = url.searchParams.get('comment_id');
    seen.push({ begin, topic, maximum: url.searchParams.get('max_id') });
    if (!topic) {
      return { app_msg_list: JSON.stringify({ total_count: 2, app_msg: [article(begin ? 'second' : 'first', begin ? 1 : 21)] }) };
    }
    const items = topic === 'second' ? [message(22)] : begin ? [message(21)]
      : Array.from({ length: 20 }, (_, n) => message(20 - n));
    return { comment_list: JSON.stringify({ total_count: topic === 'second' ? 1 : 21, comment: items }) };
  } };
  const result = await fetchComments(transport, 'account');
  assert.equal(result.length, 22);
  assert.equal(result.filter((item) => item.articleId === 'second').length, 1);
  assert.equal(seen.find((item) => item.topic === 'first' && item.begin === 20).maximum, '20');
  assert.equal(result[0].id, '9007199254740993020');
});

test('embedded JSON retains unsafe integer IDs as exact decimal strings', () => {
  const value = readEmbeddedJson('{"content_id":9278449954429337897,"id":4}', 'test');
  assert.equal(value.content_id, '9278449954429337897');
  assert.equal(value.id, 4);
});

test('repeated pages fail clearly instead of claiming a complete list', async () => {
  const transport = { request: async () => ({ app_msg_list: JSON.stringify({
    total_count: 100, app_msg: [{ item: { comment_id: 'same' }, comment: { total_count: 0 } }],
  }) }) };
  await assert.rejects(fetchComments(transport, 'account'), /分页没有推进/);
});
