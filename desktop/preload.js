/* 晨昏日程 · 预加载脚本
 * 只把同步需要的 5 个能力暴露给页面，不给 require / 文件系统 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('NativeBridge', {
  platform: 'windows',

  /* (method, url, body, headersJson, timeout) -> {status, body, error} */
  http: (method, url, body, headersJson, timeout) =>
    ipcRenderer.invoke('bridge:http', { method, url, body, headersJson, timeout }),

  startHost: (port) => ipcRenderer.invoke('bridge:start-host', port),
  stopHost: () => ipcRenderer.invoke('bridge:stop-host'),
  getIps: () => ipcRenderer.invoke('bridge:get-ips'),
  hostInfo: () => ipcRenderer.invoke('bridge:host-info'),
  setHostState: (json) => ipcRenderer.invoke('bridge:set-host-state', json),

  /* 对端写入时由主进程主动推送，避免页面定时器被后台节流 */
  onRemote: (cb) => {
    ipcRenderer.on('chx:remote', (_e, d) => {
      try { cb(d); } catch (err) { console.warn('[同步] onRemote 处理失败', err); }
    });
  }
});
