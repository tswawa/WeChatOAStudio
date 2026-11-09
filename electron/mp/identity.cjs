// 只读取公众平台已登录页面中的账号标识和展示资料，不读取密码或导出 Cookie。
const MP_ORIGIN = 'https://mp.weixin.qq.com';

function isMpUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === MP_ORIGIN && !url.username && !url.password;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function inspectPage() {
  if (location.origin !== 'https://mp.weixin.qq.com') return null;
  const token = new URL(location.href).searchParams.get('token');
  const visible = (element) => element && element.getClientRects().length > 0;
  const accountElement = [...document.querySelectorAll('.weui-desktop-account')].find(visible);
  const nickname = accountElement?.querySelector('.weui-desktop-account__nickname, .account_nickname');
  const data = window.wx?.data || {};
  const cgiData = window.wx?.cgiData || {};
  const field = (key) => {
    const direct = data[key] || cgiData[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const pattern = new RegExp('(?:["\']?' + key + '["\']?)\\s*[:=]\\s*["\']([^"\'<>\\r\\n]+)["\']');
    for (const script of document.scripts) {
      if (script.src) continue;
      const match = script.textContent.match(pattern);
      if (match) return match[1];
    }
    return '';
  };
  const originalId = field('user_name');
  const name = (nickname?.textContent || field('nick_name')).trim().split('\n')[0];
  const loginQr = [...document.querySelectorAll('img[src*="qrcode"]')].some(visible);
  if (!token || !/^\d+$/.test(token) || token === '0' || !originalId || !name) {
    return { authenticated: false, loginRequired: loginQr && !accountElement };
  }
  const avatarElement = accountElement?.querySelector(
    '.weui-desktop-account__thumb img, img.weui-desktop-account__thumb, .weui-desktop-account__avatar img',
  );
  return {
    authenticated: true,
    originalId,
    name,
    avatar: avatarElement?.src || '',
  };
}

function normalizeIdentity(value) {
  if (!value?.authenticated) return null;
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(value.originalId || '')) return null;
  const name = String(value.name || '').trim().slice(0, 100);
  if (!name) return null;
  let avatar = '';
  try {
    const url = new URL(value.avatar || '');
    if (url.protocol === 'https:' && !url.username && !url.password
      && /(^|\.)(qpic|qlogo)\.cn$/.test(url.hostname)) avatar = url.href;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return {
    id: value.originalId,
    originalId: value.originalId,
    name,
    initial: [...name].slice(0, 2).join(''),
    color: '#07c160',
    avatar,
    type: '',
    subject: '',
    verified: null,
  };
}

function publicationIdentity(value, expectedId) {
  const profile = normalizeIdentity(value);
  if (profile) return { state: profile.id === expectedId ? 'verified' : 'mismatch' };
  return { state: value?.loginRequired === true ? 'login_required' : 'unavailable' };
}

async function readIdentity(contents) {
  if (contents.isDestroyed() || !isMpUrl(contents.getURL())) return null;
  return contents.executeJavaScript(`(${inspectPage.toString()})()`, false);
}

module.exports = { MP_ORIGIN, isMpUrl, normalizeIdentity, publicationIdentity, readIdentity };
