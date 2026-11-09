// 按微信原生编辑器提交格式保留图集的 AI、链接、商品和位置标记，排除服务端渲染字段。
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined)
  .map((key) => [key, value[key]]));
const first = (value) => Array.isArray(value) ? value[0] : value;

function imageExtras(raw) {
  const value = pick(raw, ['pic_type', 'pic_text', 'pic_cfg']);
  const aiId = raw.aiImageId || raw.ai_pic_id;
  if (aiId) {
    value.ai_pic_id = aiId;
    value.ai_pic_source = raw.subSourceMark === 'suggestion' ? 3 : 1;
  }
  const associated = raw.client_info?.associated_info;
  const poster = raw._posterContext || (Number(raw.ai_pic_source) === 2 && associated?.type === 1 ? {
    picId: aiId, prompt: associated.text_poster_prompt, templateId: associated.text_poster_template_id,
    style: associated.text_poster_style,
  } : null);
  if (poster && (raw._isTextPoster || Number(raw.ai_pic_source) === 2)) {
    if (poster.picId) value.ai_pic_id = poster.picId;
    value.ai_pic_source = 2;
    value.client_info = { associated_info: {
      type: 1, text_poster_prompt: poster.prompt || '', text_poster_template_id: poster.templateId || '',
      text_poster_style: poster.style || '',
    } };
  }
  const wxa = first(raw.wxa_info);
  if (wxa?.appid) value.wxa_info = [{ ...pick(wxa, ['appid', 'path', 'content', 'nickname']),
    servicetype: String(wxa.servicetype || wxa.service_type || '') }];
  const poi = first(raw.poi_info);
  if (poi?.name) value.poi_info = [Object.fromEntries(
    ['name', 'poiid', 'districtid', 'address', 'longitude', 'latitude', 'content']
      .map((key) => [key, poi[key] || '']),
  )];
  const bind = first(raw.bind_ad_info);
  if (bind?.bind) value.bind_ad_info = [{ bind: bind.bind }];
  if (raw.spot_product_info?.length) value.spot_product_info = raw.spot_product_info.map((item) =>
    pick(item, ['pid', 'traceid', 'extinfo', 'data_buffer', 'templateid', 'content', 'coordinate', 'product_id',
      'product_type', 'title', 'short_title', 'data_type', 'product_encrypt_key']));
  if (raw.pic_window_product?.product_id) value.pic_window_product = pick(raw.pic_window_product,
    ['product_id', 'product_encrypt_key', 'product_type', 'title', 'data_type']);
  return value;
}

module.exports = { imageExtras };
