'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('silentP', {
  isNative: true,

  listContainers: () => ipcRenderer.invoke('containers:list'),
  createContainer: (input) => ipcRenderer.invoke('containers:create', input),
  updateContainer: (containerId, changes) => ipcRenderer.invoke('containers:update', containerId, changes),
  removeContainer: (containerId) => ipcRenderer.invoke('containers:remove', containerId),
  routeUrl: (url) => ipcRenderer.invoke('containers:route-url', url),
  getActiveContainer: () => ipcRenderer.invoke('containers:get-active'),
  setContainerPermission: (containerId, permission, allowed) =>
    ipcRenderer.invoke('containers:set-permission', containerId, permission, allowed),
  applyContainerPreset: (containerId, preset) =>
    ipcRenderer.invoke('containers:apply-preset', containerId, preset),

  listTabs: () => ipcRenderer.invoke('tabs:list'),
  openTab: (profile) => ipcRenderer.invoke('tabs:open', profile),
  activateTab: (tabId) => ipcRenderer.invoke('tabs:activate', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('tabs:close', tabId),
  setKeepActive: (tabId, value) => ipcRenderer.invoke('tabs:keep-active', tabId, value),
  parkTab: (tabId) => ipcRenderer.invoke('tabs:park', tabId),
  releaseInactiveTabs: () => ipcRenderer.invoke('tabs:release-inactive'),
  setPrivacyPreset: (tabId, preset) => ipcRenderer.invoke('tabs:set-preset', tabId, preset),
  detachTab: (tabId) => ipcRenderer.invoke('tabs:detach', tabId),
  newWindow: () => ipcRenderer.invoke('window:new'),

  showDashboard: () => ipcRenderer.invoke('browser:dashboard'),
  navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  command: (command) => ipcRenderer.send('browser:command', command),
  toggleDesktop: () => ipcRenderer.invoke('browser:toggle-desktop'),

  quitAndRelease: () => ipcRenderer.invoke('app:quit-and-release'),
  getMetrics: () => ipcRenderer.invoke('app:metrics'),

  onTabsChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('tabs:state', handler);
    return () => ipcRenderer.removeListener('tabs:state', handler);
  },
  onBrowserNotice: (callback) => {
    const handler = (_event, notice) => callback(notice);
    ipcRenderer.on('browser:notice', handler);
    return () => ipcRenderer.removeListener('browser:notice', handler);
  },
  onDownloadsChanged: (callback) => {
    const handler = (_event, download) => callback(download);
    ipcRenderer.on('downloads:changed', handler);
    return () => ipcRenderer.removeListener('downloads:changed', handler);
  }
});
