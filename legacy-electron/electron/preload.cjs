const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wf', {
  get: (service, path, language) => ipcRenderer.invoke('api:get', service, path, language),
  syncGame: () => ipcRenderer.invoke('game:sync'),
  importInventory: () => ipcRenderer.invoke('game:import'),
  lastInventory: () => ipcRenderer.invoke('game:last'),
  statsHistory: () => ipcRenderer.invoke('stats:history'),
  // Automatischer Sync im Main-Prozess: { state: 'start' | 'done' | 'error', inventory?, message? }
  onAutoSync: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('game:auto-sync', handler);
    return () => ipcRenderer.removeListener('game:auto-sync', handler);
  },
  rewardLog: () => ipcRenderer.invoke('rewardLog:list'),
  rewardLogChoose: (id, chosen) => ipcRenderer.invoke('rewardLog:choose', id, chosen),
  rewardLogRemove: (id) => ipcRenderer.invoke('rewardLog:remove', id),
  onRewardLog: (cb) => {
    const handler = (_e, entry) => cb(entry);
    ipcRenderer.on('rewardLog:changed', handler);
    return () => ipcRenderer.removeListener('rewardLog:changed', handler);
  },
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.send('app:open-data'),
  openLog: () => ipcRenderer.send('app:open-log'),
  masteryDb: (force) => ipcRenderer.invoke('mastery:db', force),
  relicDb: (force) => ipcRenderer.invoke('relics:db', force),
  worldState: () => ipcRenderer.invoke('world:state'),
  scanNow: () => ipcRenderer.invoke('scan:now'),
  scanFile: () => ipcRenderer.invoke('scan:file'),
  lastScan: () => ipcRenderer.invoke('scan:last'),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  // Wo das Overlay gerade etwas zeigt (Bildschirm-Pixel) – wird vor der Texterkennung geschwärzt
  reportOverlayRects: (rects) => ipcRenderer.send('overlay:rects', rects),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  onScan: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('scan:result', handler);
    return () => ipcRenderer.removeListener('scan:result', handler);
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettings: (cb) => {
    const handler = (_e, values) => cb(values);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  // Selbst-Update (electron/updater.cjs)
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },
  window: (action) => ipcRenderer.send('window', action),
});
