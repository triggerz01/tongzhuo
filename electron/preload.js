'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tz', {
  /** 鼠标是否压在可交互区域上（控制窗口穿透） */
  setInteractive: (v) => ipcRenderer.send('pet:interactive', !!v),
  openPanel: () => ipcRenderer.send('panel:open'),
  closePanel: () => ipcRenderer.send('panel:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  /** 跨窗口消息总线 */
  post: (msg) => ipcRenderer.send('bus', msg),
  onBus: (cb) => ipcRenderer.on('bus', (_e, msg) => cb(msg)),
  listModels: () => ipcRenderer.invoke('models:list'),
  listScenes: () => ipcRenderer.invoke('scenes:list'),
  listAnims: () => ipcRenderer.invoke('anims:list')
});
