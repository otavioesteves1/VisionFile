'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notif', {
  view:  () => ipcRenderer.send('notif:view'),
  close: () => ipcRenderer.send('notif:close'),
  // Query params passados via loadFile({ query }) ficam em location.search
  getParams: () => Object.fromEntries(new URLSearchParams(location.search)),
});
