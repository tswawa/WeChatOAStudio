// 解析真实编辑器稿件和贴图图集，保存远端字段供修改时保留原有文章设置。
const { draft: parseDraft, json, https } = require('./parsers.cjs');

const EDITOR_DATA = `new Promise((resolve,reject)=>{
  const deadline=Date.now()+15000;
  function inspect(){
    const c=window.wx?.cgiData||{};
    if(c.appmsg_data||c.multi_appmsg_data){
      resolve({data:c.appmsg_data,multi:c.multi_appmsg_data,appId:c.app_id,
        dataSeq:c.data_seq,sharePageType:c.sharePageType,version:window.wx.version,lineInfo:c.line_info});
      return;
    }
    if(Date.now()>deadline)return reject(new Error('微信草稿内容未就绪，请重新读取'));
    setTimeout(inspect,150);
  }
  inspect();
})`;

function imageList(value) {
  const parsed = json(value, []);
  const items = Array.isArray(parsed) ? parsed : parsed.list || parsed.item || [];
  return items.map((item, index) => ({
    id: String(item.file_id || item.fileid || index),
    fileId: String(item.file_id || item.fileid || ''),
    url: https(item.cdn_url || item.url),
    width: Number(item.width || 0), height: Number(item.height || 0),
    raw: item,
  }));
}

function plainHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split(/\r?\n/).map((line) => `<p>${line || '<br>'}</p>`).join('');
}

function parseEditorDraft(raw, draftId) {
  const data = json(raw.data, {});
  const multi = json(raw.multi, {});
  const group = data.multi_item || multi.item || multi.multi_item || [];
  if (group.length > 1) throw new Error('这是一组多篇草稿，当前编辑页不能安全修改整组文章');
  const first = group[0] || data;
  if (!first || (first.content === undefined && first.guide_words === undefined && !first.share_imageinfo)) {
    throw new Error('微信未返回草稿内容，请重新读取');
  }
  const parsed = parseDraft({ ...first, appmsgid: draftId });
  parsed.itemShowType = Number(first.item_show_type ?? first.share_page_type ?? raw.sharePageType ?? 0);
  const images = imageList(first.share_imageinfo);
  return {
    ...parsed,
    html: parsed.itemShowType === 8 ? plainHtml(first.guide_words || first.content || '') : parsed.html,
    images,
    dataSeq: String(data.data_seq ?? multi.data_seq ?? raw.dataSeq ?? '0'),
    updatedAt: Number(data.update_time || first.update_time || first.create_time || 0) * 1000,
    sourceUrl: first.source_url || '',
    needOpenComment: Boolean(first.need_open_comment),
    onlyFansCanComment: Boolean(first.only_fans_can_comment),
    copyrightType: Number(first.copyright_type || 0),
    canReward: Boolean(first.can_reward),
    isPaySubscribe: Boolean(first.is_pay_subscribe),
    remote: { article: first, version: raw.version, lineInfo: raw.lineInfo, appId: String(raw.appId || draftId) },
  };
}

module.exports = { EDITOR_DATA, parseEditorDraft, imageList, plainHtml };
