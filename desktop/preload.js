const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('silentP', {
  isNative: true,
  openProfile: (profile) => ipcRenderer.invoke('browser:open', profile),
  closeProfile: () => ipcRenderer.invoke('browser:close'),
  releaseResources: () => ipcRenderer.invoke('browser:release'),
  quitForMaps: () => ipcRenderer.invoke('app:quit-for-maps'),
  resourceMetrics: () => ipcRenderer.invoke('app:metrics'),
  navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  command: (command) => ipcRenderer.send('browser:command', command),
  toggleDesktop: () => ipcRenderer.invoke('browser:toggle-desktop'),
  onBrowserState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', handler);
    return () => ipcRenderer.removeListener('browser:state', handler);
  }
});
