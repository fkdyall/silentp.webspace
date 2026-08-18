'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('silentP', {
  isNative: true,

  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (input) => ipcRenderer.invoke('profiles:create', input),
  updateProfile: (profileId, changes) => ipcRenderer.invoke('profiles:update', profileId, changes),
  removeProfile: (profileId) => ipcRenderer.invoke('profiles:remove', profileId),
  authorizeFamily: (profileId, providerId) => ipcRenderer.invoke('profiles:authorize-family', profileId, providerId),
  listCompartments: (profileId) => ipcRenderer.invoke('compartments:list', profileId),
  clearCompartment: (profileId, compartmentId) => ipcRenderer.invoke('compartments:clear', profileId, compartmentId),
  routeProfileUrl: (url) => ipcRenderer.invoke('profiles:route-url', url),
  getActivePrivacy: () => ipcRenderer.invoke('privacy:get-active'),
  setCompartmentPermission: (profileId, compartmentId, permission, allowed) =>
    ipcRenderer.invoke('compartments:set-permission', profileId, compartmentId, permission, allowed),
  setCompatibilityLevel: (profileId, compartmentId, level) =>
    ipcRenderer.invoke('compatibility:set-level', profileId, compartmentId, level),
  addCompatibilityAllowance: (input) => ipcRenderer.invoke('compatibility:add', input),
  pinCompatibilityAllowance: (profileId, compartmentId, allowanceId) =>
    ipcRenderer.invoke('compatibility:pin', profileId, compartmentId, allowanceId),
  removeCompatibilityAllowance: (profileId, compartmentId, allowanceId) =>
    ipcRenderer.invoke('compatibility:remove', profileId, compartmentId, allowanceId),

  listContainers: () => ipcRenderer.invoke('containers:list'),
  createContainer: (input) => ipcRenderer.invoke('containers:create', input),
  updateContainer: (containerId, changes) => ipcRenderer.invoke('containers:update', containerId, changes),
  removeContainer: (containerId) => ipcRenderer.invoke('containers:remove', containerId),
  clearContainer: (containerId) => ipcRenderer.invoke('containers:clear', containerId),
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
  setChromeHeight: (height) => ipcRenderer.invoke('browser:set-chrome-height', height),
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
