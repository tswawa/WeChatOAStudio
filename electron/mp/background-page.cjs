// 后台微信读取页只有 WebContentsView，不创建、挂接或显示任何操作系统窗口。
const { WebContentsView } = require('electron');
const { getMpSession } = require('./windows.cjs');
const { MP_ORIGIN, isMpUrl } = require('./identity.cjs');

function createBackgroundPage({ partition }) {
  const mpSession = getMpSession(partition);
  const view = new WebContentsView({
    webPreferences: {
      session: mpSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  view.setBounds({ x: 0, y: 0, width: 1200, height: 850 });
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const restrict = (event, oldUrl) => {
    if (!isMpUrl(event.url || oldUrl)) event.preventDefault();
  };
  contents.on('will-navigate', restrict);
  contents.on('will-redirect', restrict);
  contents.on('will-prevent-unload', (event) => event.preventDefault());
  return {
    view,
    contents,
    session: mpSession,
    url: `${MP_ORIGIN}/`,
    isDestroyed: () => contents.isDestroyed(),
    close() {
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
    },
  };
}

module.exports = { createBackgroundPage };
