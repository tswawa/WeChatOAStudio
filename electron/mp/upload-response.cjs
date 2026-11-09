// 兼容微信素材上传返回的数值 content、对象及 JSON 字符串，统一返回素材标识。
function parseUploadResponse(response, name) {
  let content = response.content;
  if (typeof content === 'string' && /^\s*\{/.test(content)) {
    try { content = JSON.parse(content); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('微信图片上传返回的素材数据格式无效');
    }
  }
  const nested = content && typeof content === 'object' ? content : {};
  const scalarId = typeof content === 'number' || /^\d+$/.test(String(content || '')) ? String(content) : '';
  const fileId = String(nested.file_id || nested.fileid || response.file_id || response.fileid || scalarId || '');
  const mediaId = nested.media_id || response.media_id || '';
  const url = String(nested.cdn_url || nested.url || response.cdn_url || response.url || '').replace(/^http:/, 'https:');
  if (!url || !(fileId || mediaId)) throw new Error('微信没有返回完整的图片地址和素材标识，请刷新素材库查看');
  return {
    id: fileId || mediaId, fileId, mediaId, name, url,
    width: Number(nested.width || response.width || 0),
    height: Number(nested.height || response.height || 0),
    cover: { url, fileId, mediaId },
  };
}

module.exports = { parseUploadResponse };
