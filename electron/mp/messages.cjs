// 公众号私信：按公众平台私信页的接口读取会话、筛选、搜索、收藏、私信设置，并发送文字或素材消息。
const { randomUUID } = require('node:crypto');
const {
  text, parseMessages, parseConversation, parseMessageResults, parseStarredUsers,
} = require('./interaction-parsers.cjs');

const NUMERIC_ID = /^\d+$/;
// 公众平台系统标签“星标用户”；收藏一个人就是把他加入这个标签，与公众平台用户管理页一致
const STAR_GROUP = 2;
// 公众平台私信页筛选：私信状态（最近 30 天 / 今天 / 昨天 / 前天 / 3 天前）与排序
const TIME_RANGES = new Set([7, 0, 1, 2, 11]);
const SORTS = new Set([0, 1, 2, 3]);
const SCOPES = new Set([0, 1, 2, 3]);

// 公众平台私信页 singlesend 检查与发送的失败提示
const MESSAGE_ERRORS = {
  10700: '该用户已取消关注，无法再给他发送消息', 10701: '该用户已被加入黑名单，无法向其发送消息',
  10703: '对方关闭了接收消息', 10706: '已超过可回复时间或回复次数，需等用户再次发消息后才能回复',
  200008: '微信要求输入验证码，请在公众平台私信页回复', 220001: '素材库存储数量已达上限，请删除后再保存',
  220002: '图片库已达到存储上限，请清理后再保存',
};

function required(value, label, maximum = 600) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${label}不能为空且不能超过 ${maximum} 字`);
  }
  return value.trim();
}

function friendly(error) {
  const message = MESSAGE_ERRORS[Number(error.code)];
  return message ? new Error(message) : error;
}

// 私信设置：微信接口返回的 filter_* 字段为 1 表示关闭，界面按“开启”展示
function parseSettings(response) {
  return {
    hideKeywordMessages: Number(response.filter_ivr_msg_setting) !== 1,
    foldSpam: Number(response.fold_spam_msg_setting) !== 1,
    blockSpam: Number(response.filter_spam_msg_setting) !== 1,
    grayFoldSpam: Number(response.is_gray_fold_spam) === 1,
    oneMessageBeforeReply: Number(response.one_msg_before_reply) === 1,
    scope: Number(response.private_msg_scope || 0),
  };
}

function createMessageService({ transport, readList, ownId }) {
  // 私信对象先在近期私信里找；不在近期私信里的已收藏的人（如很久没发私信）从“星标用户”里找
  async function messageTarget(id, userId) {
    const target = (await readList(id)).find((item) => item.id === userId)
      || (await getStarredUsers(id)).find((item) => item.id === userId);
    if (!target) throw new Error('私信会话不存在，请刷新后重试');
    return target;
  }

  // 近期私信列表：与公众平台私信页一样按私信状态、未读、排序筛选，每个用户合并为一个会话
  // 加载更多：按时间排序时用最早会话的消息编号减一作为 frommsgid，其他排序用已加载数量作为 offset
  async function listMessages(id, payload = {}) {
    const day = TIME_RANGES.has(Number(payload.day)) ? Number(payload.day) : 7;
    const sort = SORTS.has(Number(payload.sort)) ? Number(payload.sort) : 0;
    const from = NUMERIC_ID.test(String(payload.before || '')) ? (BigInt(payload.before) - 1n).toString() : '';
    const offset = sort !== 0 && Number.isSafeInteger(payload.offset) && payload.offset > 0 ? payload.offset : '';
    const response = await transport.request(id, `/cgi-bin/message?${new URLSearchParams({
      frommsgid: from, count: 50, day, filtertype: sort, getunreadmsg: payload.unread ? 1 : 0, withbizmsg: 1,
      keyword: '', filterivrmsg: 0, filterspammsg: 0, foldSpamMsg: 0, count_per_user: 1,
      privateMsgScope: 0, oneMsgBeforeReply: 0, offset,
    })}`);
    const items = (response.item || []).map((entry) => entry.msg || entry);
    const myFakeId = await ownId(id);
    return { conversations: parseMessages({ msgList: items, myFakeId }), settings: parseSettings(response),
      latestId: String(response.latest_msg_id_64bit || ''), hasMore: Number(response.continue_flag) === 1 };
  }

  // 私信回复内容：文字或公众平台素材（图片/语音 fileid，图文/视频 appmsgid），与公众平台私信页的发送参数一致
  function messagePayload(payload) {
    const media = payload.media;
    if (!media) return { type: 1, content: required(payload.text, '回复内容') };
    const value = String(media.id || '');
    if (!NUMERIC_ID.test(value)) throw new Error('请选择要发送的素材');
    if (media.kind === 'image') return { type: 2, fileid: value };
    if (media.kind === 'voice') return { type: 3, fileid: value };
    if (media.kind === 'video') return { type: 15, appmsgid: value };
    if (media.kind === 'appmsg') return { type: 10, appmsgid: value };
    throw new Error('不支持这种消息类型');
  }

  async function send(id, payload) {
    const fields = messagePayload(payload);
    const target = await messageTarget(id, payload.id);
    try {
      await transport.request(id, `/cgi-bin/singlesend?action=check&tofakeid=${encodeURIComponent(target.id)}`);
      return await transport.request(id, '/cgi-bin/singlesend?t=ajax-response&f=json', { method: 'POST', fields: {
        tofakeid: target.id, imgcode: '', out_trade_no: randomUUID(), appmsg: '', quickreplyid: '', ...fields,
      } });
    } catch (error) {
      throw friendly(error);
    }
  }

  // 单个用户的完整对话，包括公众号已发出的回复
  // before 为已加载的最早一条消息编号时读取更早的记录（公众平台以 continue_flag 表示还有更早消息）
  async function getConversation(id, payload) {
    const target = await messageTarget(id, payload.id);
    const before = NUMERIC_ID.test(String(payload.before || '')) ? String(payload.before) : '';
    const response = await transport.request(id, `/cgi-bin/singlesendpage?${new URLSearchParams({
      action: 'index', tofakeid: target.id, lastmsgid: before, identity_open_id: target.identityOpenId,
    })}`);
    const page = response.page_info || {};
    const conversation = parseConversation({ ...page, tofakeid: page.tofakeid || target.id });
    // 30 天内没有私信的人（只在收藏里）公众平台不返回昵称和头像，沿用会话或收藏列表里的资料
    return { ...conversation, user: conversation.user || target.user || '',
      avatar: conversation.avatar || target.avatar || '', hasMore: Number(page.continue_flag) === 1 };
  }

  // 私信里的图片、语音、视频内容，与公众平台私信页播放/预览使用同一地址
  function mediaPath(payload) {
    const messageId = String(payload.messageId || '');
    if (!NUMERIC_ID.test(messageId)) throw new Error('私信消息编号无效');
    const fileId = String(payload.fileId || '');
    const source = String(payload.source || '');
    if (payload.kind === 'image') {
      const mode = payload.large ? 'large' : 'small';
      return `/cgi-bin/getimgdata?${new URLSearchParams({ msgid: messageId, mode, source, fileId })}`;
    }
    const query = new URLSearchParams({ msgid: messageId, fileid: fileId, source });
    if (payload.kind === 'voice') return `/cgi-bin/getvoicedata?${query}`;
    if (payload.kind === 'video') return `/cgi-bin/getvideodata?${query}`;
    throw new Error('这条消息没有可显示的文件');
  }

  async function messageFile(id, payload) {
    const file = await transport.fetchBinary(id, mediaPath(payload), { maxBytes: 30 * 1024 * 1024 });
    const type = file.type.split(';')[0] || 'application/octet-stream';
    return { url: `data:${type};base64,${file.bytes.toString('base64')}`, type };
  }

  // 下载私信文件，与公众平台私信页消息菜单“下载”相同（/cgi-bin/downloadfile）
  async function downloadMessageFile(id, payload) {
    const messageId = String(payload.messageId || '');
    if (!NUMERIC_ID.test(messageId)) throw new Error('私信消息编号无效');
    return transport.fetchBinary(id, `/cgi-bin/downloadfile?msgid=${messageId}`);
  }

  // 私信可发送的素材，与公众平台私信页素材选择框使用同一列表接口
  async function messageMedia(id, payload) {
    const https = (value) => String(value || '').replace(/^http:/, 'https:');
    if (payload.kind === 'image' || payload.kind === 'voice') {
      const type = payload.kind === 'image' ? 2 : 3;
      const response = await transport.request(id, `/cgi-bin/filepage?type=${type}&begin=0&count=40`);
      return (response.page_info?.file_item || []).map((item) => ({
        id: String(item.file_id), name: text(item.name), cover: https(item.cdn_url),
        detail: item.play_length ? `${Math.round(Number(item.play_length) / 1000)} 秒` : '',
      }));
    }
    if (payload.kind === 'video') {
      const response = await transport.request(id, '/cgi-bin/appmsg?begin=0&count=20&action=list_video&type=15');
      return (response.app_msg_info?.item || []).map((item) => ({
        id: String(item.app_id || item.appmsgid), name: text(item.title), cover: https(item.cover || item.img_url),
        detail: '',
      }));
    }
    if (payload.kind === 'appmsg') {
      const response = await transport.request(id, '/cgi-bin/appmsgpublish?sub=list&begin=0&count=20');
      const page = typeof response.publish_page === 'string'
        ? JSON.parse(response.publish_page) : response.publish_page || {};
      return (page.publish_list || []).flatMap((entry) => {
        const info = typeof entry.publish_info === 'string' ? JSON.parse(entry.publish_info) : entry.publish_info || {};
        return (info.appmsg_info || info.appmsgex || []).filter((item) => !item.is_deleted).slice(0, 1)
          .map((item) => ({ id: String(item.appmsgid), name: text(item.title), cover: https(item.cover), detail: '' }));
      });
    }
    throw new Error('不支持这种素材类型');
  }

  // 已收藏的人：“星标用户”标签里的用户，与公众平台用户管理页同一接口；每页 20 人，从上一页最后一人继续
  async function getStarredUsers(id) {
    const users = new Map();
    let last = null;
    for (let page = 0; page < 50; page += 1) {
      const response = await transport.request(id, `/cgi-bin/user_tag?${new URLSearchParams({
        action: 'get_user_list', groupid: STAR_GROUP, begin_openid: last?.user_openid ?? -1,
        begin_create_time: last?.user_create_time ?? -1, limit: 20, offset: 0, backfoward: 1,
      })}`);
      const list = response.user_list?.user_info_list || [];
      const before = users.size;
      for (const user of parseStarredUsers(list)) users.set(user.id, user);
      if (list.length < 20 || users.size === before) break;
      last = list.at(-1);
    }
    return [...users.values()];
  }

  async function searchMessages(id, payload) {
    const keyword = required(payload.keyword, '搜索内容', 60);
    const start = await transport.request(id, '/cgi-bin/message?action=get_frommsgid&day=30');
    const response = await transport.request(id, `/cgi-bin/message?${new URLSearchParams({
      action: 'search', count: 50, keyword, frommsgid: start.from_msg_id_64bit_str || start.from_msg_id_64bit || 0,
    })}`);
    return parseMessageResults(response.item || [], await ownId(id));
  }

  // 收藏/取消收藏一个人：把他加入或移出“星标用户”标签；私信会话的用户编号就是标签接口的 openid，
  // cexpandcol 与公众平台私信页加标签时相同
  async function starUser(id, payload) {
    const target = await messageTarget(id, String(payload.id || ''));
    if (payload.starred) {
      await transport.request(id, '/cgi-bin/user_tag?action=batch_set_tag', { method: 'POST',
        fields: { user_openid_list: target.id, groupid_list: STAR_GROUP, cexpandcol: 2 } });
    } else {
      await transport.request(id, '/cgi-bin/user_tag?action=del_tag', { method: 'POST',
        fields: { user_openid: target.id, groupid_list: STAR_GROUP } });
    }
    const user = { id: target.id, user: target.user, avatar: target.avatar, identityOpenId: target.identityOpenId };
    return { starred: Boolean(payload.starred), user };
  }

  // 把用户发来的图片或语音存入素材库，与公众平台私信页“保存为素材”相同
  async function saveMessageMedia(id, payload) {
    if (!NUMERIC_ID.test(String(payload.messageId || ''))) throw new Error('私信消息编号无效');
    const filename = String(payload.name || `私信素材${payload.messageId}`).slice(0, 64);
    const fields = payload.kind === 'voice'
      ? { msgid: payload.messageId, title: filename, filename, voice_cagtegory: 0 }
      : { msgid: payload.messageId, filename, digest: '', scene: 0 };
    try {
      await transport.request(id, '/cgi-bin/savemsgtofile?t=ajax-response&only_cdn=0', { method: 'POST', fields });
    } catch (error) {
      throw friendly(error);
    }
    return { saved: true };
  }

  async function blockMessageUser(id, payload) {
    const target = await messageTarget(id, payload.id);
    const action = payload.blocked ? 'set_black' : 'cancle_black';
    await transport.request(id, `/cgi-bin/user_tag?action=${action}&source=4`, {
      method: 'POST', fields: { user_openid_list: target.id, ...(payload.blocked ? { is_harassment: 0 } : {}) } });
    return { blocked: Boolean(payload.blocked) };
  }

  async function deleteConversation(id, payload) {
    const target = await messageTarget(id, payload.id);
    const latest = (target.items || []).filter((item) => !item.mine).at(-1);
    if (!latest) throw new Error('这个会话没有可删除的消息');
    await transport.request(id, '/cgi-bin/message?action=delete_msg', { method: 'POST',
      fields: { tofakeid: target.id, delete_msg_id: latest.id } });
    return { deleted: true };
  }

  // 私信设置：隐蔽关键词私信、折叠/屏蔽骚扰消息、回复前只接收一条消息、谁可以给我发私信
  async function saveMessageSettings(id, payload) {
    const current = (await listMessages(id)).settings;
    const next = { ...current };
    for (const key of ['hideKeywordMessages', 'foldSpam', 'blockSpam', 'oneMessageBeforeReply']) {
      if (payload[key] === undefined) continue;
      if (typeof payload[key] !== 'boolean') throw new Error('私信设置格式无效');
      next[key] = payload[key];
    }
    if (payload.scope !== undefined) {
      if (!SCOPES.has(Number(payload.scope))) throw new Error('私信范围无效');
      next.scope = Number(payload.scope);
    }
    await transport.request(id, '/cgi-bin/message?action=filter_msg_setting', { method: 'POST', fields: {
      filter_ivr_msg_setting: next.hideKeywordMessages ? 0 : 1, filter_spam_msg_setting: next.blockSpam ? 0 : 1,
      fold_spam_msg_setting: next.foldSpam ? 0 : 1, set_private_msg_scope: next.scope,
      set_one_msg_before_reply: next.oneMessageBeforeReply ? 1 : 0,
    } });
    return next;
  }

  return {
    listMessages, send, getConversation, messageMedia, getStarredUsers, searchMessages, starUser,
    messageFile, downloadMessageFile,
    saveMessageMedia, blockMessageUser, deleteConversation, saveMessageSettings,
  };
}

module.exports = { createMessageService };
