// 验证上传响应、图文正文和贴图保存字段，确保原类型、顺序和远端设置不丢失。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseUploadResponse } = require('./upload-response.cjs');
const { parseEditorDraft } = require('./draft-data.cjs');
const { buildDraftFields } = require('./draft-fields.cjs');
const { imageExtras } = require('./image-fields.cjs');

test('native upload scalar content is the file ID, not an object', () => {
  const result = parseUploadResponse({ base_resp: { ret: 0 }, content: '100000017',
    cdn_url: 'http://mmbiz.qpic.cn/test/0' }, 'check.png');
  assert.equal(result.fileId, '100000017');
  assert.equal(result.url, 'https://mmbiz.qpic.cn/test/0');
  assert.equal(parseUploadResponse({ content: '{"file_id":"12","cdn_url":"https://example.com/a.png"}' }).fileId, '12');
});

test('editor draft extracts image galleries without losing raw per-image metadata', () => {
  const result = parseEditorDraft({ data: { data_seq: 7, multi_item: [{ title: '贴图', share_page_type: 8,
    guide_words: '第一行\n第二行', share_imageinfo: { list: [{ file_id: 12, cdn_url: 'https://example.com/a.png',
      width: 800, height: 600, disable_theme: 1 }] } }] } }, '100');
  assert.equal(result.itemShowType, 8);
  assert.equal(result.dataSeq, '7');
  assert.equal(result.images[0].raw.disable_theme, 1);
  assert.match(result.html, /<p>第一行<\/p><p>第二行<\/p>/);
});

test('image post save keeps type and metadata while reflecting explicit order and text edits', () => {
  const current = parseEditorDraft({ data: { data_seq: 7, multi_item: [{ title: '贴图', share_page_type: 8,
    guide_words: '旧文', option_version: 2, auto_elect_reply: 1, msg_index_id: 'index-1',
    only_fans_can_comment: false, not_pay_can_comment: true, red_packet_cover_list: [],
    share_imageinfo: { list: [
      { file_id: 12, cdn_url: 'https://example.com/a.png', width: 800, height: 600, disable_theme: 1,
        watermark_info: { server_only: true }, theme_color: { r: 244, g: 249, b: 255 },
        ori_picture: { file_id: 0, width: 0, height: 0, crop_list: '{}' } },
      { file_id: 13, cdn_url: 'https://example.com/b.png', width: 800, height: 600, disable_live: 1 },
    ] } }] } }, '100');
  const fields = buildDraftFields({ ...current, title: '修改标题', html: '<p>新文</p>',
    images: [...current.images].reverse() }, current);
  assert.equal(fields.share_page_type0, '8');
  assert.equal(fields.guide_words0, '新文');
  assert.equal(fields.msg_index_id0, 'index-1');
  assert.equal(fields.auto_elect_reply0, '1');
  assert.equal(fields.only_fans_can_comment0, '0');
  assert.equal(fields.not_pay_can_comment0, '1');
  assert.deepEqual(JSON.parse(fields.req).idx_infos[0].red_packet_cover_list, { list: [] });
  const images = JSON.parse(fields.share_imageinfo0).list;
  assert.deepEqual(images.map((item) => item.file_id), [13, 12]);
  assert.equal(images[0].disable_live, 1);
  assert.equal(images[1].disable_theme, 1);
  assert.equal('watermark_info' in images[1], false);
  assert.equal(images[1].theme_color, 'rgb(244,249,255)');
  assert.deepEqual(images[1].ori_picture, { file_id: 0, cdn_url: '', crop_ratio: '', crop_list: '"{}"' });
  assert.throws(() => buildDraftFields({ ...current, images: [] }, current), /至少保留一张/);
});

test('ordinary article saves preserve current metadata and reject executable HTML', () => {
  const fields = buildDraftFields({ title: '图文', html: '<p>正文</p><script>bad()</script>',
    cover: { url: 'https://example.com/c.png', fileId: '10' } }, null);
  assert.equal(fields.share_page_type0, '0');
  assert.equal(fields.content0, '<p>正文</p>');
  assert.equal(fields.fileid0, '10');
  assert.equal(fields.isnew, '0');
});

test('existing AI poster metadata survives without resubmitting server rendering fields', () => {
  const result = imageExtras({ ai_pic_id: 'poster-id', ai_pic_source: 2, _isTextPoster: true,
    _posterContext: { picId: 'poster-id', prompt: '海报', templateId: 'quote', style: 'style3' },
    client_info: { associated_info: { text_poster_data_buf: 'server-rendering-buffer' } } });
  assert.equal(result.ai_pic_id, 'poster-id');
  assert.equal(result.ai_pic_source, 2);
  assert.deepEqual(result.client_info.associated_info, {
    type: 1, text_poster_prompt: '海报', text_poster_template_id: 'quote', text_poster_style: 'style3',
  });
  assert.equal(JSON.stringify(result).includes('server-rendering-buffer'), false);
});
