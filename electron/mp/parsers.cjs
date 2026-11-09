// 将公众平台响应转换为工作台使用的数据结构，保留稿件类型和远端标识。
function json(value, fallback = {}) {
  if (typeof value !== 'string') return value || fallback;
  try { return JSON.parse(value); } catch (error) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

function https(value = '') {
  return String(value).replace(/^http:/, 'https:').replace(/&amp;/g, '&');
}

function text(value = '') {
  return String(value).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function draft(item) {
  return {
    id: String(item.appmsgid || item.app_id || item.id || ''),
    title: text(item.title),
    author: item.author || '',
    digest: item.digest || '',
    html: item.content || '',
    cover: { url: https(item.cover || item.cdn_url), mediaId: item.thumb_media_id || '',
      fileId: String(item.file_id || item.fileid || '') },
    thumbMediaId: item.thumb_media_id || '',
    thumbFileId: String(item.file_id || item.fileid || ''),
    itemShowType: Number(item.item_show_type ?? item.share_page_type ?? 0),
    updatedAt: Number(item.update_time || item.create_time || 0) * 1000,
    origin: 'wechat',
    scheduledAt: null,
    massNotify: false,
  };
}

function published(value) {
  const page = json(value.publish_page || value);
  return (page.publish_list || []).flatMap((entry) => {
    const info = json(entry.publish_info, entry);
    const articles = info.appmsgex?.length ? info.appmsgex : info.appmsg_info || [];
    return articles.map((item, index) => ({
      id: `${info.msgid || item.appmsgid || item.aid || entry.msgid}_${index}`,
      title: text(item.title),
      appmsgId: String(item.appmsgid || ''),
      at: Number(info.sent_info?.time || item.create_time || info.publish_time || 0) * 1000,
      mass: info.sent_info?.is_send_all === undefined ? null : Boolean(info.sent_info.is_send_all),
      reads: item.read_num ?? null,
      likes: item.like_num ?? null,
      shares: item.share_num ?? null,
      comments: item.comment_num ?? null,
      cover: { url: https(item.cover) },
      // 公众平台发表列表的原文地址字段为 content_url，旧版本为 link
      url: item.is_deleted || /[?&](token|tempkey)=/.test(item.content_url || item.link || '')
        ? '' : https(item.content_url || item.link || ''),
      origin: 'wechat',
      sourceDraftId: String(info.copy_appmsg_id || entry.copy_appmsg_id || ''),
      publishConfirmed: Number(info.sent_result?.msg_status) === 2 && !item.is_deleted,
      deleted: Number(item.is_deleted) === 1,
    }));
  });
}

function material(item) {
  return {
    id: String(item.file_id),
    fileId: String(item.file_id),
    mediaId: item.media_id || '',
    name: item.name || `图片 ${item.file_id}`,
    size: item.size || '',
    groupId: item.group_id ?? 0,
    copyrightStatus: item.copyright_status ?? 0,
    url: https(item.cdn_url),
    cover: { url: https(item.cdn_url), fileId: String(item.file_id), mediaId: item.media_id || '' },
    updatedAt: Number(item.update_time || 0) * 1000,
  };
}

module.exports = { json, https, draft, published, material };
