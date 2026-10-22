'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const IN = new Set(['init', 'state', 'fx', 'sound', 'menu:open', 'menu:close', 'cursor', 'home:state', 'home:tab']);
const OUT = new Set(['ready', 'pointer', 'context', 'ui', 'hud', 'cmd']);

contextBridge.exposeInMainWorld('catAPI', {
  on(channel, fn) {
    if (IN.has(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
  send(channel, data) {
    if (OUT.has(channel)) ipcRenderer.send(channel, data);
  },
  invoke(channel, data) {
    if (channel === 'home:get') return ipcRenderer.invoke(channel, data);
    return Promise.reject(new Error('blocked'));
  },
});
