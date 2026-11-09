// 读取微信真实互动页面，按页面自身接口保存文字回复、精选留言、自动回复和菜单。
const { text, parseMessages, parseKeywords, parseMenu } = require('./interaction-parsers.cjs');
const { createMessageService } = require('./messages.cjs');
const { readAccountProfile } = require('./account-profile.cjs');
const { fetchComments } = require('./comments.cjs');

const PATHS = {
  comments: '/misc/appmsgcomment?action=list_latest_comment&begin=0&count=50&sendtype=MASSSEND&scene=1',
  messages: '/cgi-bin/message?t=message/list&count=50&day=30',
  follow: '/advanced/autoreply?t=ivr/reply&action=beadded',
  fallback: '/advanced/autoreply?t=ivr/reply&action=autoreply',
  keywords: '/advanced/autoreply?action=smartreply&t=ivr/keywords',
  menu: '/advanced/selfmenu?action=index&t=advanced/menu-setting',
  users: '/cgi-bin/contactmanage?t=user/index&pageidx=0&type=0',
  account: '/cgi-bin/settingpage?t=setting/index&action=index',
  members: '/cgi-bin/safecenterstatus?action=admins&t=setting/safe-admins',
};

function cgiExpression(fields) {
  return `(() => { const c = window.wx?.cgiData || {}; return Object.fromEntries(
    ${JSON.stringify(fields)}.filter(key => key in c).map(key => [key, c[key]])); })()`;
}

const MENU_EXPRESSION = `new Promise((resolve, reject) => {
  const deadline = Date.now() + 12000;
  const inspect = () => {
    function find(v) {
      if (!v) return null;
      if (v.$store?.state?.cgiData?.menu) return v.$store.state.cgiData;
      for (const child of v.$children || []) { const found = find(child); if (found) return found; }
      return null;
    }
    const c = find(document.querySelector('#app')?.__vue__);
    if (c) return resolve({menu:c.menu, access:c.accessMenuData});
    if (Date.now() > deadline) return reject(new Error('微信菜单数据未就绪'));
    setTimeout(inspect, 250);
  };
  inspect();
})`;

// 公众平台菜单页 menusetting 脚本对发布结果的提示，未列出的代码按通用失败处理
const MENU_ERRORS = {
  20: '菜单名称字数超出限制', 21: '文本内容字数超出限制', 26: '子菜单名称长度超出限制', 27: '菜单名称为空',
  105: '发布失败：网页链接只能使用本公众号的内容（公众号文章或页面模板）。未认证账号不能添加外部网站链接',
  106: '发布失败：当前公众号无权限设置网页链接', 1013: '菜单名称或其他输入含有非法字符',
};

// 公众平台自动回复开关：/misc/skeyform?form=advancedswitchform 的 type
const REPLY_SWITCHES = { follow: { type: 9, field: 'isBeAddedOpen' }, fallback: { type: 11, field: 'isReplyOpen' },
  keyword: { type: 10, field: 'isKeywordOpen' } };

function required(value, label, maximum = 600) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${label}不能为空且不能超过 ${maximum} 字`);
  }
  return value.trim();
}

function createInteractionService({ transport }) {
  async function getComments(id) {
    return fetchComments(transport, id);
  }

  // 公众号自己的 fakeid 用于区分双方消息，按账号记住，供私信 JSON 接口分组使用
  const ownIds = new Map();
  async function getMessages(id) {
    const page = await transport.readPage(id, PATHS.messages, cgiExpression(['msgList', 'myFakeId']));
    if (page.myFakeId) ownIds.set(id, String(page.myFakeId));
    return parseMessages(page);
  }
  async function ownId(id) {
    if (!ownIds.has(id)) await getMessages(id);
    return ownIds.get(id) || '';
  }
  const messages = createMessageService({ transport, readList: getMessages, ownId });

  async function getAutoReply(id) {
    const read = (part) => transport.readPage(id, PATHS[part], cgiExpression([
      'rule_id', 'replytype', 'data', 'isBeAddedOpen', 'isReplyOpen', 'isKeywordOpen', 'isAiOpen', 'list',
    ]));
    const follow = await read('follow');
    const fallback = await read('fallback');
    const keywords = await read('keywords');
    if (follow.replytype !== 'beadded' || fallback.replytype !== 'autoreply') {
      throw new Error('微信自动回复数据未就绪');
    }
    return {
      follow: text(follow.data?.content), fallback: text(fallback.data?.content),
      followOpen: Boolean(follow.isBeAddedOpen), fallbackOpen: Boolean(fallback.isReplyOpen),
      keywordOpen: Boolean(keywords.isKeywordOpen), aiOpen: Boolean(fallback.isAiOpen),
      followId: String(follow.rule_id || '0'), fallbackId: String(fallback.rule_id || '0'),
      followReadonly: Boolean(follow.data && Number(follow.data.type) !== 1),
      // 开启微信 AI 回复时固定回复文字由 AI 设置接管，与公众平台一致不可直接改写；开启固定回复开关后恢复可编辑
      fallbackReadonly: Boolean(fallback.isAiOpen || (fallback.data && Number(fallback.data.type) !== 1)),
      keywords: parseKeywords(keywords),
    };
  }

  async function getUsers(id) {
    const raw = await transport.readPage(id, PATHS.users, cgiExpression(['group_list', 'user_list', 'total_user_num']));
    if (!Array.isArray(raw.user_list) || !Array.isArray(raw.group_list)) throw new Error('微信用户数据结构已变化');
    return {
      tags: raw.group_list.map((item) => ({ id: String(item.id), name: text(item.name), count: Number(item.cnt) })),
      users: raw.user_list.map((item) => ({
        id: String(item.id), name: text(item.nick_name), remark: text(item.remark_name),
        avatar: item.user_head_img || '', at: Number(item.create_time) * 1000, groupId: String(item.group_id),
      })),
      followers: Number(raw.total_user_num),
    };
  }

  async function getMembers(id) {
    return transport.readPage(id, PATHS.members, `(() => {
      const c=window.wx?.cgiData||{}; const info=c.info||{};
      if (!('info' in c)) throw new Error('微信人员数据未就绪');
      const strategy=info.strategy_resp?.strategy_status||{};
      const list=[...(info.seconde_amin||[]),...(info.item_list?.item_list||[])];
      const members=[{name:c.operator_name||'',role:'管理员',wechat:strategy.wx_alias||'',term:''}];
      for(const item of list) members.push({name:item.nickname||item.nick_name||item.name||'',
        role:'运营者',wechat:item.wx_alias||item.alias||item.username||'',
        term:Number(item.expire_time)>0?new Date(Number(item.expire_time)*1000).toLocaleDateString('zh-CN'):'长期'});
      return members.filter(item=>item.name||item.wechat);
    })()`);
  }

  async function getAccount(id) {
    return transport.readPage(id, PATHS.account, `(${readAccountProfile.toString()})()`);
  }

  async function getMenu(id) {
    const raw = await transport.readPage(id, PATHS.menu, MENU_EXPRESSION);
    if (!Array.isArray(raw.menu?.button_list)) throw new Error('微信菜单数据结构已变化');
    return { menu: parseMenu(raw.menu.button_list), menuVersion: raw.menu.version, menuName: raw.menu.name || '' };
  }

  async function get(id) {
    const value = { comments: [], messages: [], autoReply: { follow: '', fallback: '', keywords: [] },
      menu: [], members: [], tags: [], users: [], account: {}, errors: {} };
    const loaders = {
      comments: () => getComments(id),
      messages: () => getMessages(id),
      autoReply: () => getAutoReply(id), users: () => getUsers(id), account: () => getAccount(id),
      members: () => getMembers(id), menu: () => getMenu(id),
    };
    for (const [key, loader] of Object.entries(loaders)) {
      try {
        const result = await loader();
        if (key === 'users' || key === 'menu') Object.assign(value, result);
        else value[key] = result;
      } catch (error) {
        console.warn('微信页面读取失败', key, error.name);
        value.errors[key] = error.message;
      }
    }
    return value;
  }

  async function reply(id, payload) {
    if (payload.kind === 'comment') {
      const content = required(payload.text, '回复内容');
      const comments = await getComments(id);
      const item = comments.find((entry) => entry.id === payload.id && entry.articleId === payload.articleId);
      if (!item) throw new Error('留言不存在或已变化，请刷新后重试');
      return transport.request(id, '/misc/appmsgcomment?action=reply_comment', { method: 'POST', fields: {
        comment_id: item.articleId, content_id: item.id, content, need_elect: 0, fileids: '',
      } });
    }
    if (payload.kind !== 'message') throw new Error('回复类型无效');
    return messages.send(id, payload);
  }

  async function featureComment(id, payload) {
    const comments = await getComments(id);
    const item = comments.find((entry) => entry.id === payload.id && entry.articleId === payload.articleId);
    if (!item) throw new Error('留言不存在或已变化，请刷新后重试');
    return transport.request(id, '/misc/appmsgcomment', { method: 'POST', fields: {
      comment_id: item.articleId, user_comment_id: item.userCommentId,
      action: payload.featured ? 'set_good_comment' : 'remove_good_comment',
    } });
  }

  async function readMessage(id, payload) {
    const target = (await getMessages(id)).find((item) => item.id === payload.id);
    if (!target) throw new Error('私信会话不存在，请刷新后重试');
    await transport.request(id, '/cgi-bin/message?action=mark_read', { method: 'POST', fields: {
      fakeid: JSON.stringify({ fakeid: [target.id] }),
    } });
    return { read: true, id: target.id };
  }

  async function saveAutoReply(id, payload) {
    const before = await getAutoReply(id);
    for (const key of ['follow', 'fallback']) {
      if (payload[key] === undefined || payload[key] === before[key]) continue;
      if (typeof payload[key] !== 'string' || payload[key].length > 600) throw new Error('自动回复最多 600 字');
      if (before[`${key}Readonly`]) throw new Error('已有自动回复包含非文字素材或由微信 AI 回复接管，请先开启收到消息回复');
    }
    if (payload.keywords !== undefined) {
      if (!Array.isArray(payload.keywords)) throw new Error('关键词规则格式无效');
      for (const rule of payload.keywords) {
        const old = before.keywords.find((item) => item.id === rule.id);
        if (old && old.keyword === rule.keyword && old.reply === rule.reply && old.match === rule.match) continue;
        if (old?.readonly) throw new Error('复杂关键词规则请在公众平台编辑');
        required(rule.keyword, '关键词', 30);
        required(rule.reply, '关键词回复');
      }
    }
    for (const [key, { type }] of Object.entries(REPLY_SWITCHES)) {
      const value = payload[`${key}Open`];
      if (value === undefined || value === before[`${key}Open`]) continue;
      if (typeof value !== 'boolean') throw new Error('自动回复开关格式无效');
    }
    const saveUrl = '/advanced/setreplyrule?cgi=setreplyrule&fun=save&t=ajax-response';
    const deleteUrl = '/advanced/setreplyrule?cgi=setreplyrule&fun=del&t=ajax-response';
    for (const key of ['follow', 'fallback']) {
      if (payload[key] === undefined || payload[key] === before[key]) continue;
      if (before[`${key}Readonly`]) throw new Error('已有自动回复包含非文字素材，请到公众平台编辑');
      const content = String(payload[key]);
      if (content.length > 600) throw new Error('自动回复最多 600 字');
      const fields = { replytype: key === 'follow' ? 'beadded' : 'autoreply', ruleid: before[`${key}Id`] };
      if (content.trim()) Object.assign(fields, { type: 1, content });
      await transport.request(id, content.trim() ? saveUrl : deleteUrl, { method: 'POST', fields });
    }
    if (payload.keywords) {
      if (!Array.isArray(payload.keywords)) throw new Error('关键词规则格式无效');
      for (const rule of payload.keywords) {
        const old = before.keywords.find((item) => item.id === rule.id);
        if (old && old.keyword === rule.keyword && old.reply === rule.reply && old.match === rule.match) continue;
        if (old?.readonly) throw new Error('复杂关键词规则请在公众平台编辑');
        await transport.request(id, saveUrl, { method: 'POST', fields: {
          replytype: 'smartreply', ruleid: old?.id || 0, rulename: rule.name || rule.keyword,
          allreply: 0, replycnt: 1, keywordcnt: 1, keyword0: required(rule.keyword, '关键词', 30),
          matchmode0: rule.match === '全匹配' ? 1 : 0, type0: 1, content0: required(rule.reply, '关键词回复'),
        } });
      }
      for (const old of before.keywords) {
        if (!payload.keywords.some((rule) => rule.id === old.id)) {
          await transport.request(id, deleteUrl, { method: 'POST', fields: { ruleid: old.id, replytype: 'smartreply' } });
        }
      }
    }
    // 开关在内容保存之后再改，先开启空回复会被微信判为无效
    for (const [key, { type }] of Object.entries(REPLY_SWITCHES)) {
      const value = payload[`${key}Open`];
      if (value === undefined || value === before[`${key}Open`]) continue;
      await transport.request(id, '/misc/skeyform?form=advancedswitchform', { method: 'POST',
        fields: { flag: value ? 1 : 0, type } });
    }
    return { saved: true };
  }

  async function saveMenu(id, payload) {
    if (!Array.isArray(payload.menu) || payload.menu.length > 3) throw new Error('最多 3 个一级菜单');
    const before = await getMenu(id);
    // 删除全部菜单：发布接口不接受空列表（返回 8），改用公众平台的删除菜单接口；214001 表示删除成功
    if (!payload.menu.length) {
      try {
        return await transport.request(id, '/advanced/operselfmenu?op=delete', { method: 'POST',
          fields: { Version: before.menuVersion } });
      } catch (error) {
        if (Number(error.code) === 214001) return { deleted: true };
        throw error;
      }
    }
    function convert(item, sub = false) {
      const name = required(item.name, '菜单名', sub ? 16 : 8);
      if (item.readonly) throw new Error('已有复杂菜单请在公众平台编辑，避免丢失设置');
      const subs = item.subs || [];
      if (subs.length > 5 || (sub && subs.length)) throw new Error('菜单最多两级，每个一级菜单最多 5 个子菜单');
      if (subs.length) return { name, type: 0, sub_button_list: subs.map((entry) => convert(entry, true)) };
      if (item.type === 'view') {
        let url;
        try { url = new URL(required(item.url, '菜单链接', 2048)); } catch (error) {
          if (error instanceof TypeError) throw new Error('菜单链接无效');
          throw error;
        }
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('菜单链接必须是 HTTP 或 HTTPS');
        return { name, type: 2, sub_button_list: [], act_list: [{ type: 6, value: url.href }] };
      }
      if (item.type !== 'text') throw new Error('此菜单类型请在公众平台编辑');
      return { name, type: 1, sub_button_list: [], act_list: [{ type: 1, value: required(item.content, '菜单回复') }] };
    }
    const info = JSON.stringify({ version: before.menuVersion, name: before.menuName,
      button_list: payload.menu.map((item) => convert(item)) });
    const fields = { info, Version: before.menuVersion };
    try {
      await transport.request(id, '/advanced/operselfmenu?op=checknew', { method: 'POST', fields });
      return await transport.request(id, '/advanced/operselfmenu?op=update_sync', { method: 'POST', fields });
    } catch (error) {
      const code = Number(error.code);
      if (MENU_ERRORS[code]) throw new Error(MENU_ERRORS[code]);
      throw error;
    }
  }

  return { get, getComments, getMessages, getUsers, getMembers, getAccount, getAutoReply, getMenu,
    reply, readMessage, featureComment, saveAutoReply, saveMenu, ...messages };
}

module.exports = { createInteractionService, PATHS };
