// 分页读取全部文章及每篇的完整留言，避免把文章概览中的局部留言当作完整列表。
const { parseComments } = require('./interaction-parsers.cjs');

function readEmbeddedJson(value, label) {
  if (typeof value !== 'string') {
    if (value && typeof value === 'object') return value;
    throw new Error(`${label}数据结构已变化`);
  }
  try {
    return JSON.parse(value, (_key, item, context) => {
      if (typeof item === 'number' && !Number.isSafeInteger(item) && Number.isInteger(item)) {
        if (!context?.source) throw new Error(`${label}包含无法精确读取的标识`);
        return context.source;
      }
      return item;
    });
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label}数据格式无效`);
    throw error;
  }
}

function queryPath(action, values) {
  const query = new URLSearchParams({ action, ...values });
  return `/misc/appmsgcomment?${query}`;
}

async function listArticles(transport, accountId) {
  const articles = new Map();
  let begin = 0;
  while (true) {
    const response = await transport.request(accountId, queryPath('list_latest_comment', {
      begin, count: 50, sendtype: 'MASSSEND', scene: 1, sort_type: 0,
    }));
    const page = readEmbeddedJson(response.app_msg_list, '微信文章留言');
    if (!Array.isArray(page.app_msg)) throw new Error('微信文章留言列表结构已变化');
    const previous = articles.size;
    for (const article of page.app_msg) {
      const id = String(article.item?.comment_id || '');
      if (!id) throw new Error('微信文章缺少留言标识');
      articles.set(id, article);
    }
    begin += page.app_msg.length;
    const total = Number(page.total_count);
    if (!page.app_msg.length || (Number.isFinite(total) && begin >= total)) break;
    if (articles.size === previous) throw new Error('微信文章分页没有推进，请稍后刷新');
    if (!Number.isFinite(total) && page.app_msg.length < 50) break;
  }
  return [...articles.values()];
}

async function listArticleComments(transport, accountId, article) {
  const topic = String(article.item.comment_id);
  if (article.comment?.total_count === 0) return [];
  const comments = new Map();
  let begin = 0;
  let maximumId = '0';
  while (true) {
    const response = await transport.request(accountId, queryPath('list_comment', {
      comment_id: topic, begin, count: 20, filtertype: 0, day: 0, type: 2, max_id: maximumId,
    }));
    const page = readEmbeddedJson(response.comment_list, '微信留言');
    if (!Array.isArray(page.comment)) throw new Error('微信留言列表结构已变化');
    const previous = comments.size;
    if (begin === 0 && page.comment.length) maximumId = String(page.comment[0].id || '0');
    for (const comment of page.comment) {
      const id = String(comment.content_id || comment.id || '');
      if (!id) throw new Error('微信留言缺少内容标识');
      comments.set(id, comment);
    }
    begin += page.comment.length;
    const total = Number(page.total_count ?? response.comment_list_count);
    if (!page.comment.length || (Number.isFinite(total) && begin >= total)) break;
    if (comments.size === previous) throw new Error('微信留言分页没有推进，请稍后刷新');
    if (!Number.isFinite(total) && page.comment.length < 20) break;
  }
  return [...comments.values()];
}

async function fetchComments(transport, accountId) {
  const articles = await listArticles(transport, accountId);
  const complete = [];
  for (const article of articles) {
    const comments = await listArticleComments(transport, accountId, article);
    complete.push({ ...article, comment: { ...article.comment, comment: comments } });
  }
  return parseComments({ list: complete });
}

module.exports = { fetchComments, readEmbeddedJson };
