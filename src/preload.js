'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig:      ()      => ipcRenderer.invoke('config:get'),
  saveConfig:     (cfg)   => ipcRenderer.invoke('config:save', cfg),
  pickFolder:     ()      => ipcRenderer.invoke('config:pick-folder'),
  getConfigPath:  ()      => ipcRenderer.invoke('config:get-path'),
  setConfigPath:  (p)     => ipcRenderer.invoke('config:set-path', p),
  pickConfigFile: ()      => ipcRenderer.invoke('config:pick-file'),

  // Actions
  checkNow:     ()      => ipcRenderer.invoke('check:now'),
  openPath:     (p)     => ipcRenderer.invoke('shell:open', p),

  // Window
  hideWindow:     ()    => ipcRenderer.send('window:hide'),
  minimizeWindow: ()    => ipcRenderer.send('window:minimize'),

  // Tray badge icon (renderer generates via canvas, main uses for tray)
  registerBadgeIcon: (url) => ipcRenderer.send('badge-icon:register', url),
  setTrayCount:      (n)   => ipcRenderer.send('tray:count', n),

  // Events from main
  onFileEvent:  (cb) => ipcRenderer.on('file-event',  (_, d) => cb(d)),
  onStatus:     (cb) => ipcRenderer.on('status',      (_, d) => cb(d)),
});
