// 将微信页面数据转换成工作台互动数据，并保留操作所需的字符串标识。
function text(value) {
  return String(value ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// 只有表情、图片或语音的留言没有文字，显示类型而不是空白
function commentText(item) {
  const value = text(item.content || item.rich_content?.rich_text).trim();
  if (value) return value;
  const media = item.multi_info || {};
  if (media.pictures?.length) return '[图片]';
  if (media.emojis?.length) return '[表情]';
  if (media.voices?.length) return '[语音]';
  return '[非文字留言，请在公众平台查看]';
}

function parseComments(data) {
  if (!Array.isArray(data.list)) throw new Error('微信留言数据结构已变化');
  return data.list.flatMap((article) => (article.comment?.comment || []).map((item) => ({
    id: String(item.content_id || item.id),
    userCommentId: String(item.id),
    articleId: String(item.comment_id || article.item?.comment_id),
    user: text(item.nick_name),
    article: text(article.item?.title),
    content: commentText(item),
    at: Number(item.post_time || item.create_time || 0) * 1000,
    featured: Number(item.is_elected) === 1,
    reply: text(item.reply?.content || (item.new_reply?.reply_list || []).find((entry) => entry.is_from === 0)?.content),
  })));
}

// 公众平台私信消息类型：1 文字 2 图片 3 语音 4/15/62 视频 10/9/77 图文
const MESSAGE_KINDS = {
  1: 'text', 2: 'image', 47: 'image', 3: 'voice', 4: 'video', 15: 'video', 62: 'video',
  10: 'appmsg', 9: 'appmsg', 77: 'appmsg', 10002: 'appmsg',
};
const MESSAGE_LABELS = { image: '[图片]', voice: '[语音]', video: '[视频]', appmsg: '[图文]', other: '[其他消息]' };

function avatar(value) {
  try {
    const url = new URL(String(value || '').replace(/^http:/, 'https:'));
    return url.protocol === 'https:' && /(^|.)(qpic|qlogo).cn$/.test(url.hostname) ? url.href : '';
  } catch (error) {
    if (error instanceof TypeError) return '';
    throw error;
  }
}

// 公众平台私信页每种消息可用的操作：1 可下载，2 可转存到素材库（与其消息菜单一致）
const MESSAGE_ACTIONS = { 1: 0, 2: 3, 47: 3, 3: 3, 4: 1, 15: 3, 62: 2, 42: 3, 10: 0 };
const MEDIA_EXPIRY = new Date('2022-03-02T23:59:59+08:00').getTime();

function secureUrl(value) {
  return /^https?:/.test(value || '') ? value.replace(/^http:/, 'https:') : '';
}

// 单条私信：用户与公众号双方的消息都在 msg_item 里，fakeid 不等于对方时为公众号发出
function parseMessageItem(message, userId) {
  const type = Number(message.video_url ? 15 : message.type);
  const kind = MESSAGE_KINDS[type] || 'other';
  const at = Number(message.date_time || message.create_time || 0) * 1000;
  const actions = MESSAGE_ACTIONS[type] ?? 0;
  const article = message.multi_item?.[0] || {};
  return {
    id: String(message.id_64bit || message.id || at),
    kind,
    content: kind === 'text' ? text(message.content) : MESSAGE_LABELS[kind],
    title: kind === 'appmsg' ? text(article.title || message.title || '') : '',
    url: kind === 'appmsg' ? secureUrl(article.content_url) : '',
    cover: kind === 'appmsg' ? secureUrl(article.cover) : '',
    fileId: String(message.fileid || message.file_id || ''),
    source: String(message.source || ''),
    duration: Number(message.play_length || message.length || 0),
    at,
    mine: Boolean(userId && String(message.fakeid || '') !== String(userId)),
    canDownload: (actions & 1) === 1,
    canSave: (actions & 2) === 2,
    // 2022 年 3 月前且超过 3 天的多媒体消息已过期，公众平台不再提供内容
    expired: ['image', 'voice', 'video'].includes(kind) && at < MEDIA_EXPIRY && Date.now() - at > 3 * 24 * 3600 * 1000,
  };
}

function messageEntries(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed?.msg_item) ? parsed.msg_item : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

// 公众平台私信列表：每项是一条消息，用户资料与正文放在 JSON 字符串 msg_items.msg_item 里；按用户合并成会话。
// 公众号自己发出的消息 fakeid 为公众号（myFakeId），对方是 to_uin，与公众平台私信页的分组方式一致
function parseMessages(data) {
  if (!Array.isArray(data.msgList)) throw new Error('微信私信数据结构已变化');
  const own = String(data.myFakeId || '');
  const conversations = new Map();
  for (const item of data.msgList) {
    let entries = messageEntries(item.msg_items);
    if (!entries.length && (item.fakeid || item.fakeId)) entries = [item];
    for (const message of entries) {
      const sender = String(message.fakeid || message.fakeId || '');
      const fromBiz = Boolean(own && sender === own);
      const id = fromBiz ? String(message.to_uin || '') : sender;
      if (!id) continue;
      const conversation = conversations.get(id) || {
        id, user: '', identityOpenId: String(message.identity_open_id || ''), avatar: '',
        canReply: Number(item.can_replay ?? 1) === 1, blacked: Number(item.is_blacked) === 1, unread: 0, items: [],
      };
      // 昵称和头像取对方发来的消息；fans_nick_name 始终是粉丝昵称
      conversation.user ||= text(item.fans_nick_name || (fromBiz ? '' : message.nick_name));
      if (!fromBiz && !conversation.avatar) conversation.avatar = avatar(message.small_headimg_url || message.wx_headimg_url);
      conversation.items.push(parseMessageItem(message, id));
      conversation.unread += Number(item.unread_cnt || 0);
      conversations.set(id, conversation);
    }
  }
  return [...conversations.values()].map((conversation) => {
    const items = conversation.items.sort((a, b) => a.at - b.at);
    const last = items.at(-1);
    return { ...conversation, items, last: last.content, at: last.at, unread: conversation.unread > 0 };
  }).sort((a, b) => b.at - a.at);
}

// 单个用户的完整对话（singlesendpage?action=index），含公众号发出的回复
function parseConversation(page) {
  const userId = String(page.tofakeid || '');
  return {
    id: userId, user: text(page.to_nick_name), avatar: avatar(page.to_head_img),
    canReply: Number(page.can_replay ?? 1) === 1, blacked: Number(page.is_blacked) === 1,
    identityOpenId: String(page.identity_open_id || ''),
    items: messageEntries(page.msg_items).map((message) => parseMessageItem(message, userId)).sort((a, b) => a.at - b.at),
  };
}

// 搜索结果（item[].msg）：每条带对方用户资料，按时间倒序；公众号发出的消息归到对方（to_uin）
function parseMessageResults(list, own = '') {
  // 每项为 { msg: { msg_items: JSON 字符串 } }，与私信列表相同，需展开 msg_item
  const entries = Array.isArray(list)
    ? list.flatMap((entry) => {
      const message = entry?.msg || entry;
      return message?.msg_items ? messageEntries(message.msg_items) : message ? [message] : [];
    })
    : messageEntries(list);
  return entries.map((message) => {
    const fromBiz = Boolean(own && String(message.fakeid || '') === String(own));
    const userId = String(fromBiz ? message.to_uin || '' : message.fakeid || '');
    return {
      ...parseMessageItem(message, userId),
      userId, user: fromBiz ? '' : text(message.nick_name),
      avatar: fromBiz ? '' : avatar(message.small_headimg_url || message.wx_headimg_url),
    };
  }).sort((a, b) => b.at - a.at);
}

// 公众平台“星标用户”标签里的用户（user_tag get_user_list）：收藏的人，openid 与私信会话的用户编号相同
function parseStarredUsers(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: String(item.user_openid || ''),
    user: text(item.user_name),
    avatar: avatar(item.user_head_img),
    identityOpenId: String(item.identity_open_id || ''),
  })).filter((item) => item.id);
}

function parseKeywords(data) {
  if (!Array.isArray(data.list)) throw new Error('微信关键词规则数据结构已变化');
  return data.list.map((rule) => ({
    id: String(rule.rule_id),
    name: text(rule.rule_name),
    keyword: text(rule.keyword_list?.[0]?.content),
    match: Number(rule.keyword_list?.[0]?.match_mode) === 1 ? '全匹配' : '半匹配',
    reply: text(rule.reply_list?.[0]?.content),
    readonly: rule.keyword_list?.length !== 1 || rule.reply_list?.length !== 1
      || Number(rule.reply_list?.[0]?.reply_type) !== 1,
  }));
}

function parseMenu(items) {
  return items.map((item) => {
    const action = item.act_list?.[0] || {};
    const isView = Number(item.type) === 2;
    const content = action.value ?? action.data ?? '';
    return {
      name: text(item.name),
      type: isView ? 'view' : 'text',
      url: isView ? text(content) : '',
      content: isView ? '' : text(content),
      subs: parseMenu(item.sub_button_list || []),
      readonly: ![0, 1, 2].includes(Number(item.type))
        || (Number(item.type) === 1 && ![1, 'text'].includes(action.type)),
      raw: item,
    };
  });
}

module.exports = {
  text, parseComments, parseMessages, parseConversation, parseMessageResults, parseStarredUsers, parseKeywords, parseMenu,
};
