const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dockAPI', {
  getApps: () => ipcRenderer.invoke('get-apps'),
  getIcon: (p) => ipcRenderer.invoke('get-icon', p),
  getPinned: () => ipcRenderer.invoke('get-pinned'),
  getRunning: () => ipcRenderer.invoke('get-running'),
  launch: (p) => ipcRenderer.invoke('launch', p),
  focusWindow: (handle, pid) => ipcRenderer.invoke('focus-window', handle, pid),
  pin: (p) => ipcRenderer.invoke('pin', p),
  unpin: (p) => ipcRenderer.invoke('unpin', p),
  toggleLauncher: () => ipcRenderer.send('toggle-launcher'),
  hideLauncher: () => ipcRenderer.send('hide-launcher'),
  openDockMenu: () => ipcRenderer.send('dock-menu'),
  onPinnedChanged: (cb) => ipcRenderer.on('pinned-changed', (_e, pinned) => cb(pinned)),
  onAppsChanged: (cb) => ipcRenderer.on('apps-changed', (_e, apps) => cb(apps)),
  onRunningChanged: (cb) => ipcRenderer.on('running-changed', (_e, apps) => cb(apps)),
  onRequestExit: (cb) => ipcRenderer.on('request-exit', () => cb()),
});
