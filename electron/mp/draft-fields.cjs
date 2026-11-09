// 组装微信原生草稿保存字段，保留远端设置与贴图元数据，仅覆盖用户修改的内容。
const sanitizeHtml = require('sanitize-html');
const { imageExtras } = require('./image-fields.cjs');

const PRESERVE = [
  'writerid', 'auto_gen_digest', 'last_choose_cover_from', 'show_cover_pic', 'shortvideofileid',
  'need_open_comment', 'only_fans_can_comment', 'only_fans_days_can_comment', 'reply_flag',
  'not_pay_can_comment', 'auto_elect_comment', 'auto_elect_reply',
  'option_version', 'open_fansmsg', 'cdn_url', 'cdn_235_1_url', 'cdn_16_9_url', 'cdn_3_4_url', 'cdn_1_1_url',
  'cdn_finder_url', 'cdn_video_url', 'cdn_url_back', 'crop_list', 'app_cover_auto', 'copyright_type',
  'is_cartoon_copyright', 'copyright_img_list', 'releasefirst', 'platform', 'reprint_permit_type',
  'allow_fast_reprint', 'allow_reprint', 'allow_reprint_modify', 'original_article_type', 'ori_white_list',
  'video_ori_status', 'hit_nickname', 'free_content', 'fee', 'can_reward', 'reward_reply_id', 'pay_gifts_count',
  'is_share_copyright', 'share_copyright_url', 'source_article_type', 'share_page_type', 'dot', 'insert_ad_mode',
  'categories_list', 'sections', 'compose_info', 'is_pay_subscribe', 'pay_fee', 'pay_preview_percent', 'pay_desc',
  'pay_album_info', 'appmsg_album_info', 'can_insert_ad', 'open_keyword_ad', 'open_comment_ad', 'danmu_pub_type',
  'appmsg_danmu_pub_type', 'style_type', 'sticker_info', 'new_pic_process', 'disable_recommend', 'claim_source_type',
  'is_user_no_claim_source', 'msg_index_id', 'convert_to_image_share_page', 'convert_from_image_share_page',
  'incontent_ad_count', 'multi_picture_cover', 'title_gen_type', 'location_page_show', 'ad_id',
];
const PB_FIELDS = [
  'red_packet_cover_list', 'podcast_task_info', 'love_like_style_info', 'claim_source', 'line_info',
  'window_product', 'link_info', 'appmsg_link', 'weapp_link', 'topic_card', 'yqj_info', 'ai_pic_info',
  'single_video_snap_card', 'product_activity', 'footer_gift_activity', 'footer_common_shops',
  'footer_product_card', 'location',
];

function articleText(html) {
  return sanitizeHtml(String(html || '').replace(/<br\s*\/?>|<\/(?:p|div|section)>/gi, '\n'), {
    allowedTags: [], allowedAttributes: {},
  }).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}

function buildDraftFields(input, current) {
  const remote = current?.remote?.article || {};
  const type = Number(current?.itemShowType ?? input.itemShowType ?? 0);
  if (![0, 8].includes(type)) throw new Error('当前编辑器暂不支持此稿件类型');
  const title = String(input.title || '').trim();
  if (!title || [...title].length > 64) throw new Error('标题需要 1 至 64 个字');
  const html = sanitizeHtml(String(input.html || ''), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'section', 'span']),
    allowedAttributes: { '*': ['style'], img: ['src', 'alt', 'width', 'height', 'data-imgfileid'], a: ['href'] },
    allowedSchemes: ['https', 'http'],
  });
  if (type === 0 && !html.trim()) throw new Error('请先填写正文');
  const fields = {
    AppMsgId: current?.id || '', count: '1', data_seq: current?.dataSeq || '0',
    operate_from: 'Chrome', isnew: '0', articlenum: '1', ajax: '1', isneedsave: '0',
    title0: title, author0: String(input.author || ''), digest0: String(input.digest || '').slice(0, 120),
    content0: html, sourceurl0: input.sourceUrl ?? current?.sourceUrl ?? '',
    share_page_type0: String(type), show_cover_pic0: '0', shortvideofileid0: '', copyright_type0: '0', can_reward0: '0',
    need_open_comment0: (input.needOpenComment ?? current?.needOpenComment ?? true) ? '1' : '0',
    only_fans_can_comment0: (input.onlyFansCanComment ?? current?.onlyFansCanComment) ? '1' : '0',
  };
  for (const key of PRESERVE) {
    if (remote[key] === undefined || remote[key] === null) continue;
    if (Array.isArray(remote[key]) && !remote[key].length) continue;
    fields[`${key}0`] = typeof remote[key] === 'object' ? JSON.stringify(remote[key])
      : typeof remote[key] === 'boolean' ? String(Number(remote[key])) : String(remote[key]);
  }
  const cover = input.cover || current?.cover || {};
  if (type === 0 && !cover.url) throw new Error('请上传或选择一张封面');
  fields.fileid0 = String(input.thumbFileId || cover.fileId || remote.file_id || '');
  if (cover.url && cover.url !== current?.cover?.url) {
    for (const key of ['cdn_url', 'cdn_url_back', 'cdn_235_1_url', 'cdn_1_1_url', 'cdn_16_9_url', 'cdn_3_4_url']) {
      fields[`${key}0`] = cover.url;
    }
    fields.crop_list0 = '';
  }
  if (type === 8) {
    if (!Array.isArray(input.images) || !input.images.length) throw new Error('贴图至少保留一张图片');
    const existingImages = current?.images || [];
    const images = input.images.map((image) => {
      if (!/^https?:\/\//.test(image.url || '')) throw new Error('贴图图片地址无效');
      const saved = existingImages.find((item) => item.url === image.url && item.fileId === String(image.fileId));
      const raw = saved?.raw || image.raw || {};
      const fileId = String(image.fileId || raw.file_id || '');
      if (!/^\d+$/.test(fileId)) throw new Error('贴图缺少微信素材标识，请重新上传这张图片');
      const color = raw.theme_color;
      const metadata = {
        theme_color: typeof color === 'string' ? color
          : color ? `rgb(${color.r || 0},${color.g || 0},${color.b || 0})` : '',
        disable_theme: raw.disable_theme ? 1 : 0,
        disable_live: raw.disable_live ? 1 : 0,
      };
      if (raw.ori_picture) {
        metadata.ori_picture = {
          file_id: Number(raw.ori_picture.file_id || 0), cdn_url: raw.ori_picture.cdn_url || '',
          crop_ratio: raw.ori_picture.crop_ratio || '', crop_list: JSON.stringify(raw.ori_picture.crop_list),
        };
      }
      return { ...metadata, ...imageExtras(raw), file_id: Number(fileId), cdn_url: image.url, url: image.url,
        width: Number(image.width || raw.width || 0), height: Number(image.height || raw.height || 0) };
    });
    const content = articleText(html);
    fields.content0 = content;
    fields.guide_words0 = content;
    fields.share_page_type0 = '8';
    fields.share_imageinfo0 = JSON.stringify({ list: images });
    fields.fileid0 = '';
    if (images[0].cdn_url !== existingImages[0]?.url) {
      for (const key of ['cdn_url', 'cdn_url_back', 'cdn_235_1_url', 'cdn_1_1_url', 'cdn_16_9_url', 'cdn_3_4_url']) {
        fields[`${key}0`] = images[0].cdn_url;
      }
      fields.crop_list0 = '';
    }
  }
  const articleInfo = { save_old: 0, cps_info: remote.cps_info || { cps_import: 0 } };
  for (const key of PB_FIELDS) {
    if (remote[key] === undefined) continue;
    articleInfo[key] = key === 'red_packet_cover_list' && Array.isArray(remote[key])
      ? { list: remote[key] } : remote[key];
  }
  if (type === 8) articleInfo.line_info = { ...articleInfo.line_info, scene: 2 };
  if (type === 8 && articleInfo.ai_pic_info) {
    articleInfo.ai_pic_info = { ...articleInfo.ai_pic_info,
      ai_pic_id: JSON.parse(fields.share_imageinfo0).list.map((image) => image.ai_pic_id).filter(Boolean) };
  }
  if (articleInfo.link_info?.link_type === 1 && !articleInfo.link_info.link) {
    articleInfo.link_info = { link_type: 1 };
  }
  fields.req = JSON.stringify({ idx_infos: [articleInfo], appmsg_id: Number(current?.id || 0),
    is_use_flag: current?.remote?.lineInfo?.is_use_flag || 0, template_version: current?.remote?.version || '' });
  return fields;
}

module.exports = { buildDraftFields, articleText };
