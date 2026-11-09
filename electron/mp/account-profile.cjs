// 从公众平台账号设置页读取白名单展示资料，不返回管理员身份和联系方式。
function readAccountProfile() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    function inspect() {
      const data = window.cgiData;
      if (!data?.original_username) {
        if (Date.now() > deadline) return reject(new Error('微信账号资料未就绪，请重新加载'));
        setTimeout(inspect, 250);
        return;
      }
      const rows = [...document.querySelectorAll('.weui-desktop-setting__item')];
      const read = (label) => {
        const row = rows.find((element) =>
          element.querySelector('.weui-desktop-setting__item__label')?.textContent.trim() === label);
        return row?.querySelector('.weui-desktop-setting__item__main')?.innerText.trim().split('\n')[0] || '';
      };
      const decode = (value) => {
        const element = document.createElement('textarea');
        element.innerHTML = String(value || '');
        return element.value;
      };
      const subjectText = read('主体信息');
      const subject = subjectText.match(/[（(](个人|企业|政府|媒体|其他组织|事业单位)[）)]/)?.[1] || '';
      const verification = read('认证情况');
      const verified = verification.includes('未认证') ? false
        : /已认证|认证成功/.test(verification) ? true : null;
      const name = decode(data.nickname);
      const originalId = String(data.original_username);
      const type = read('类型');
      if (!name || !originalId || !type) return reject(new Error('微信账号资料不完整，请到公众平台检查'));
      let avatar = '';
      try {
        const image = new URL(String(data.headimg || ''));
        if (image.protocol === 'https:' && /(^|\.)(qpic|qlogo)\.cn$/.test(image.hostname)) avatar = image.href;
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
      resolve({
        name,
        originalId,
        alias: String(data.alias || ''),
        type,
        subject,
        verified,
        intro: decode(data.intro),
        avatar,
        email: '',
      });
    }
    inspect();
  });
}

module.exports = { readAccountProfile };
