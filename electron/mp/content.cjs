// 真实草稿、素材与发表记录：调用微信网页接口，扫码发表交由官方编辑器完成。
const { draft: parseDraft, published: parsePublished, material: parseMaterial } = require('./parsers.cjs');
const { parseUploadResponse } = require('./upload-response.cjs');
const { EDITOR_DATA, parseEditorDraft } = require('./draft-data.cjs');
const { buildDraftFields } = require('./draft-fields.cjs');

const EDITOR = '/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=10';
const numericId = (value) => {
  if (!/^\d+$/.test(String(value || ''))) throw new Error('稿件或素材标识无效');
  return String(value);
};

function createContentService({ transport }) {
  async function listDrafts(id) {
    const result = [];
    for (let begin = 0; begin < 1000; begin += 50) {
      const response = await transport.request(id,
        `/cgi-bin/appmsg?action=list_ex&begin=${begin}&count=50&type=77&query=`);
      const items = response.app_msg_list || [];
      result.push(...items.map(parseDraft));
      if (items.length < 50) break;
    }
    return result;
  }

  async function getDraft(id, draftId) {
    const raw = await transport.readPage(id, `${EDITOR}&appmsgid=${numericId(draftId)}`, EDITOR_DATA);
    return parseEditorDraft(raw, String(draftId));
  }

  async function listMaterials(id) {
    const items = [];
    const seen = new Set();
    const first = await transport.request(id, '/cgi-bin/filepage?type=2&begin=0&count=50');
    const groups = first.page_info?.file_group_list?.file_group || [{ id: 0 }];
    for (const group of groups) {
      for (let begin = 0; begin < 1000; begin += 50) {
        const response = await transport.request(id,
          `/cgi-bin/filepage?type=2&begin=${begin}&count=50&group_id=${group.id}`);
        const list = response.page_info?.file_item || [];
        for (const item of list) {
          if (!seen.has(String(item.file_id))) items.push(parseMaterial(item));
          seen.add(String(item.file_id));
        }
        if (list.length < 50) break;
      }
    }
    return items;
  }

  async function listPublished(id) {
    const items = [];
    for (let begin = 0; begin < 1000; begin += 20) {
      const raw = await transport.readPage(id, `/cgi-bin/appmsgpublish?sub=list&begin=${begin}&count=20`,
        '({publish_list:wx.cgiData.publish_list,total_count:wx.cgiData.total_count})');
      items.push(...parsePublished(raw));
      if ((raw.publish_list || []).length < 20 || begin + 20 >= raw.total_count) break;
    }
    return items;
  }

  async function uploadMaterial(id, payload) {
    const bytes = Buffer.from(payload.bytes || []);
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('图片必须在 10MB 以内');
    if (!/^image\/(jpeg|png|gif|webp)$/.test(payload.mimeType || '')) throw new Error('请选择 JPG、PNG、GIF 或 WebP 图片');
    const context = await transport.readPage(id, `${EDITOR}&isNew=1`,
      '({ticket:wx.data.ticket,user:wx.data.user_name})');
    if (!context.ticket || !context.user) throw new Error('无法取得微信上传凭据，请重新登录');
    const params = new URLSearchParams({ action: 'upload_material', scene: '8', writetype: 'doublewrite',
      groupid: '1', ticket_id: context.user, ticket: context.ticket, svr_time: String(Date.now()) });
    const response = await transport.request(id, `/cgi-bin/filetransfer?${params}`, {
      method: 'POST', file: { bytes, name: String(payload.name || 'image.png'), mimeType: payload.mimeType },
    });
    const material = parseUploadResponse(response, payload.name);
    if (!material.width || !material.height) {
      const { nativeImage } = require('electron');
      const image = nativeImage.createFromBuffer(bytes);
      if (!image.isEmpty()) Object.assign(material, image.getSize());
    }
    return material;
  }

  async function saveDraft(id, input) {
    const existing = /^\d+$/.test(String(input.id || ''));
    let current = null;
    if (existing) {
      current = await getDraft(id, input.id);
      if (current.itemShowType === 0 && (current.copyrightType || current.canReward || current.isPaySubscribe)) {
        throw new Error('这篇文章含原创、赞赏或付费设置，请在公众平台编辑器修改以保留设置');
      }
      if ((input.updatedAt && current.updatedAt > input.updatedAt)
        || (input.dataSeq && current.dataSeq !== input.dataSeq)) {
        throw new Error('这篇草稿已在其他窗口修改，请刷新后再保存');
      }
    }
    const fields = buildDraftFields(input, current);
    const response = await transport.request(id,
      `/cgi-bin/operate_appmsg?t=ajax-response&sub=${existing ? 'update' : 'create'}&type=10`,
      { method: 'POST', fields });
    const draftId = response.appMsgId || response.appmsgid || response.app_id || (existing && input.id);
    if (!draftId) throw new Error('微信未返回保存后的草稿 ID，请刷新草稿箱检查');
    const verified = await getDraft(id, String(draftId));
    return { ...verified, origin: input.origin || 'manual', taskId: input.taskId };
  }

  async function deleteDraft(id, draftId) {
    await transport.request(id, '/cgi-bin/operate_appmsg?sub=del&t=ajax-response', {
      method: 'POST', fields: { AppMsgId: numericId(draftId) },
    });
    return { deleted: true };
  }

  function openEditor(id, draftId) {
    return transport.open(id, draftId ? `${EDITOR}&appmsgid=${numericId(draftId)}` : `${EDITOR}&isNew=1`);
  }

  async function deleteMaterial(id, materialId) {
    const value = numericId(materialId);
    const item = (await listMaterials(id)).find((entry) => entry.id === value);
    if (!item) throw new Error('素材不存在，请刷新素材库');
    const result = await transport.request(id, '/cgi-bin/modifyfile?t=ajax-response', {
      method: 'POST', fields: { oper: 'del', fileid: value,
        copyright_status: String(item.copyrightStatus), group_id: String(item.groupId) },
    });
    if (Number(result.using_img_cnt) > 0) throw new Error('这张图片正在被文章使用，微信没有删除它');
    return { deleted: true };
  }

  return { listDrafts, getDraft, listMaterials, listPublished, uploadMaterial, saveDraft, deleteDraft,
    deleteMaterial, openEditor, openPublish: openEditor };
}

module.exports = { createContentService };
