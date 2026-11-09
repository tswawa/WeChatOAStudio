// 只向本地 Vue 界面暴露账号操作，不暴露任意 IPC、Cookie 或文件访问。
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('mpDesktop', {
  accounts: {
    list: () => call('accounts:list'),
    login: (id) => call('accounts:login', id),
    switch: (id) => call('accounts:switch', id),
    logout: (id) => call('accounts:logout', id),
    refresh: (id) => call('accounts:refresh', id),
    openPlatform: (id) => call('accounts:open-platform', id),
    saveLogin: (id, value) => call('accounts:save-login', id, value),
    forgetLogin: (id) => call('accounts:forget-login', id),
  },
  onAccountsChanged: (callback) => subscribe('accounts:changed', callback),
  onStatus: (callback) => subscribe('desktop:status', callback),
  invoke: (action, accountId, payload) => call('workspace:invoke', action, accountId, payload),
  onWorkspaceChanged: (callback) => subscribe('workspace:changed', callback),
  openExternal: (target) => call('app:open-external', target),
  openUrl: (url) => call('app:open-url', url),
});
