'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  shell
} = require('electron');
const { stripTracking, shouldBlock } = require('./security');

const APP_ID = 'com.fypm.silentpwebspace';
const VERSION = '0.3';
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 SilentP/${VERSION}`;
const DESKTOP_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 SilentP/${VERSION}`;
const TAB_STRIP_HEIGHT = 44;
const BROWSER_BAR_HEIGHT = 64;

const windows = new Map();
const configuredPartitions = new Set();
const partitionTabIds = new Map();
let shuttingDown = false;
let saveTimer = null;

app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('enable-features', 'GlobalPrivacyControl');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

function uiPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web', 'index.html')
    : path.join(__dirname, '..', 'web', 'index.html');
}

function statePath() {
  return path.join(app.getPath('userData'), 'desktop-session.json');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
}

function validatedWebUrl(input) {
  try {
    const value = new URL(input);
    return ['http:', 'https:'].includes(value.protocol) ? value.href : null;
  } catch {
    return null;
  }
}

function partitionFor(tab) {
  const key = safeId(tab.id);
  return tab.temporary ? `silentp-temp-${key}` : `persist:silentp-tab-${key}`;
}

function findWindowByWebContents(webContents) {
  const browserWindow = BrowserWindow.fromWebContents(webContents);
  if (!browserWindow) return null;
  for (const state of windows.values()) {
    if (state.browserWindow === browserWindow) return state;
  }
  return null;
}

function tabForPartition(partition) {
  const tabId = partitionTabIds.get(partition);
  if (!tabId) return null;
  for (const state of windows.values()) {
    if (state.tabs.has(tabId)) return state.tabs.get(tabId);
  }
  return null;
}

function normalizePrivacy(profile) {
  profile.privacy ||= {};
  profile.permissions ||= {};
  profile.privacyPreset ||= 'hardened';
  return profile;
}

function applyPreset(profile, preset) {
  normalizePrivacy(profile);
  profile.privacyPreset = preset;
  if (preset === 'hardened') {
    Object.assign(profile.privacy, {
      clearUrls: true,
      blocking: true,
      gpc: true,
      webrtc: true,
      thirdPartyCookies: false
    });
    Object.assign(profile.permissions, {
      popups: false,
      notifications: false,
      camera: false,
      microphone: false,
      location: false,
      clipboard: false
    });
  } else if (preset === 'balanced') {
    Object.assign(profile.privacy, {
      clearUrls: true,
      blocking: true,
      gpc: true,
      webrtc: true,
      thirdPartyCookies: false
    });
    profile.permissions.popups = true;
  } else if (preset === 'compatibility') {
    Object.assign(profile.privacy, {
      clearUrls: true,
      blocking: false,
      gpc: true,
      webrtc: false,
      thirdPartyCookies: true
    });
    profile.permissions.popups = true;
  }
  return profile;
}

function permissionAllowed(tab, permission, details = {}) {
  const permissions = tab?.profile?.permissions || {};
  if (permission === 'media') {
    const requested = details.mediaTypes || [];
    if (!requested.length) return Boolean(permissions.camera || permissions.microphone);
    return requested.every((type) => {
      if (type === 'video') return Boolean(permissions.camera);
      if (type === 'audio') return Boolean(permissions.microphone);
      return false;
    });
  }

  const map = {
    geolocation: permissions.location,
    notifications: permissions.notifications,
    clipboardRead: permissions.clipboard,
    clipboardSanitizedWrite: permissions.clipboard,
    fullscreen: true,
    pointerLock: false,
    openExternal: false
  };
  return Boolean(map[permission]);
}

function configureSession(profileSession, partition) {
  if (configuredPartitions.has(partition)) return;
  configuredPartitions.add(partition);

  profileSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permissionAllowed(tabForPartition(partition), permission, details));
  });

  profileSession.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    return permissionAllowed(tabForPartition(partition), permission, details);
  });

  profileSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const tab = tabForPartition(partition);
      if (!tab) return callback({});
      if (tab.profile.privacy?.blocking && shouldBlock(details.url)) {
        return callback({ cancel: true });
      }
      const cleaned = tab.profile.privacy?.clearUrls && details.resourceType === 'mainFrame'
        ? stripTracking(details.url)
        : details.url;
      callback(cleaned !== details.url ? { redirectURL: cleaned } : {});
    }
  );

  profileSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const tab = tabForPartition(partition);
      const requestHeaders = { ...details.requestHeaders };
      if (tab?.profile?.privacy?.gpc) {
        requestHeaders['Sec-GPC'] = '1';
        requestHeaders.DNT = '1';
      }
      const language = tab?.profile?.language || 'en-US';
      requestHeaders['Accept-Language'] = `${language},en;q=0.8`;
      callback({ requestHeaders });
    }
  );

  profileSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function serializedTab(tab) {
  return {
    id: tab.id,
    profile: clone(tab.profile),
    title: tab.title,
    url: tab.url,
    keepActive: Boolean(tab.keepActive),
    parked: Boolean(tab.parked),
    temporary: Boolean(tab.temporary),
    createdAt: tab.createdAt
  };
}

function publicTab(tab) {
  return {
    id: tab.id,
    title: tab.title || tab.profile.name || tab.profile.domain || 'New tab',
    url: tab.url,
    color: tab.profile.color || '#68e1c5',
    keepActive: Boolean(tab.keepActive),
    parked: Boolean(tab.parked || !tab.view),
    privacyPreset: tab.profile.privacyPreset || 'hardened',
    temporary: Boolean(tab.temporary)
  };
}

function saveDesktopStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDesktopState, 150);
}

function saveDesktopState() {
  if (shuttingDown || windows.size === 0) return;
  const payload = {
    version: 1,
    windows: [...windows.values()].map((state) => ({
      id: state.id,
      bounds: state.browserWindow && !state.browserWindow.isDestroyed()
        ? state.browserWindow.getBounds()
        : state.bounds,
      activeTabId: state.activeTabId,
      tabs: [...state.tabs.values()]
        .filter((tab) => !tab.temporary)
        .map(serializedTab)
    }))
  };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Unable to save desktop session:', error);
  }
}

function loadDesktopState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return Array.isArray(parsed.windows) ? parsed.windows : [];
  } catch {
    return [];
  }
}

function createBrowserWindow(restored = null) {
  const windowId = restored?.id || id('win');
  const bounds = restored?.bounds || { width: 1420, height: 920 };
  const browserWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#080b10',
    title: 'Silent P. PWSA',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true
    }
  });

  const state = {
    id: windowId,
    browserWindow,
    tabs: new Map(),
    activeTabId: null,
    bounds
  };
  windows.set(windowId, state);

  for (const saved of restored?.tabs || []) {
    const profile = normalizePrivacy(clone(saved.profile || {}));
    state.tabs.set(saved.id, {
      id: saved.id,
      windowId,
      profile,
      title: saved.title || profile.name || 'Restored tab',
      url: saved.url || profile.url,
      keepActive: Boolean(saved.keepActive),
      parked: true,
      temporary: false,
      createdAt: saved.createdAt || Date.now(),
      view: null
    });
  }

  browserWindow.loadFile(uiPath());
  browserWindow.webContents.setBackgroundThrottling(true);
  browserWindow.once('ready-to-show', async () => {
    browserWindow.show();
    const requested = restored?.activeTabId;
    const fallback = state.tabs.keys().next().value || null;
    const active = state.tabs.has(requested) ? requested : fallback;
    if (active) await activateTab(state, active);
    else sendTabState(state);
  });
  browserWindow.on('resize', () => layoutActiveView(state));
  browserWindow.on('move', saveDesktopStateSoon);
  browserWindow.on('close', saveDesktopState);
  browserWindow.on('closed', () => {
    for (const tab of state.tabs.values()) destroyTabView(tab);
    windows.delete(windowId);
    if (!shuttingDown) saveDesktopStateSoon();
  });

  return state;
}

function sendToWindow(state, channel, payload) {
  if (!state?.browserWindow || state.browserWindow.isDestroyed()) return;
  state.browserWindow.webContents.send(channel, payload);
}

function sendTabState(state, extra = {}) {
  sendToWindow(state, 'tabs:state', {
    windowId: state.id,
    activeTabId: state.activeTabId,
    tabs: [...state.tabs.values()].map(publicTab),
    ...extra
  });
}

function updateTabFromContents(state, tab, changes) {
  Object.assign(tab, changes);
  sendTabState(state);
  saveDesktopStateSoon();
}

function popupAllowed(tab) {
  return Boolean(
    tab.profile.permissions?.popups ||
    tab.profile.privacyPreset === 'balanced' ||
    tab.profile.privacyPreset === 'compatibility'
  );
}

function createTabView(state, tab) {
  if (tab.view && !tab.view.webContents.isDestroyed()) return tab.view;

  const partition = partitionFor(tab);
  partitionTabIds.set(partition, tab.id);
  const profileSession = session.fromPartition(partition, { cache: !tab.temporary });
  configureSession(profileSession, partition);

  const view = new WebContentsView({
    webPreferences: {
      session: profileSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      javascript: true,
      backgroundThrottling: !tab.keepActive
    }
  });
  tab.view = view;
  tab.parked = false;

  const contents = view.webContents;
  const desktop = tab.profile.renderMode === 'desktop' || tab.profile.uaPreset === 'desktop';
  contents.setUserAgent(desktop ? DESKTOP_UA : MOBILE_UA);
  contents.setBackgroundThrottling(!tab.keepActive);

  contents.setWindowOpenHandler((details) => {
    const target = validatedWebUrl(details.url);
    if (!target) {
      shell.openExternal(details.url).catch(() => {});
      return { action: 'deny' };
    }

    if (tab.profile.externalLinkBehavior === 'external') {
      shell.openExternal(target).catch(() => {});
      return { action: 'deny' };
    }

    if (!popupAllowed(tab)) {
      sendToWindow(state, 'browser:notice', {
        tabId: tab.id,
        type: 'popup-blocked',
        message: 'Popup blocked for this tab. Use Balanced or Compatibility mode to allow sign-in windows.'
      });
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: state.browserWindow,
        autoHideMenuBar: true,
        backgroundColor: '#080b10',
        webPreferences: {
          session: profileSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false
        }
      }
    };
  });

  contents.on('did-create-window', (childWindow) => {
    childWindow.setParentWindow(state.browserWindow);
  });

  contents.on('will-navigate', (event, target) => {
    if (!validatedWebUrl(target)) {
      event.preventDefault();
      shell.openExternal(target).catch(() => {});
    }
  });

  contents.on('did-navigate', (_event, target) => {
    updateTabFromContents(state, tab, { url: target });
  });
  contents.on('did-navigate-in-page', (_event, target) => {
    updateTabFromContents(state, tab, { url: target });
  });
  contents.on('page-title-updated', (_event, title) => {
    updateTabFromContents(state, tab, { title });
  });
  contents.on('did-fail-load', (_event, code, description, target, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      sendToWindow(state, 'browser:notice', {
        tabId: tab.id,
        type: 'load-error',
        message: description,
        url: target,
        code
      });
    }
  });
  contents.on('render-process-gone', (_event, details) => {
    tab.view = null;
    tab.parked = true;
    sendTabState(state, {
      notice: {
        type: 'renderer-exited',
        tabId: tab.id,
        message: `Tab renderer exited: ${details.reason}`
      }
    });
  });

  return view;
}

async function loadTab(tab) {
  const target = validatedWebUrl(tab.url || tab.profile.url);
  if (!target) throw new Error('Only HTTP and HTTPS website addresses are supported.');
  const view = tab.view;
  if (!view || view.webContents.isDestroyed()) throw new Error('Tab renderer is unavailable.');
  const cleaned = tab.profile.privacy?.clearUrls ? stripTracking(target) : target;
  await view.webContents.loadURL(cleaned);
}

function destroyTabView(tab) {
  if (!tab?.view) return false;
  const contents = tab.view.webContents;
  if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
  tab.view = null;
  tab.parked = true;
  return true;
}

function detachViewFromWindow(state, tab) {
  if (!tab?.view || !state?.browserWindow || state.browserWindow.isDestroyed()) return;
  try {
    state.browserWindow.contentView.removeChildView(tab.view);
  } catch {}
}

function layoutActiveView(state) {
  const tab = state.tabs.get(state.activeTabId);
  if (!tab?.view || state.browserWindow.isDestroyed()) return;
  const [width, height] = state.browserWindow.getContentSize();
  const top = TAB_STRIP_HEIGHT + BROWSER_BAR_HEIGHT;
  tab.view.setBounds({ x: 0, y: top, width, height: Math.max(100, height - top) });
}

async function activateTab(state, tabId) {
  const next = state.tabs.get(tabId);
  if (!next) return false;

  const current = state.tabs.get(state.activeTabId);
  if (current && current.id !== next.id) {
    detachViewFromWindow(state, current);
    if (current.profile.parkWhenInactive && !current.keepActive) {
      destroyTabView(current);
    } else if (current.view && !current.view.webContents.isDestroyed()) {
      current.view.webContents.setBackgroundThrottling(!current.keepActive);
    }
  }

  state.activeTabId = next.id;
  const view = createTabView(state, next);
  state.browserWindow.contentView.addChildView(view);
  view.webContents.setBackgroundThrottling(false);
  layoutActiveView(state);

  if (!view.webContents.getURL()) await loadTab(next);
  else view.webContents.focus();

  sendTabState(state);
  saveDesktopStateSoon();
  return true;
}

async function createTab(state, profileInput) {
  const profile = applyPreset(normalizePrivacy(clone(profileInput)), profileInput.privacyPreset || 'hardened');
  const tab = {
    id: id('tab'),
    windowId: state.id,
    profile,
    title: profile.name || profile.domain || 'New tab',
    url: profile.url,
    keepActive: false,
    parked: false,
    temporary: Boolean(profile.temporary),
    createdAt: Date.now(),
    view: null
  };
  state.tabs.set(tab.id, tab);
  await activateTab(state, tab.id);
  return publicTab(tab);
}

function parkTab(state, tabId) {
  const tab = state.tabs.get(tabId);
  if (!tab) return false;
  if (state.activeTabId === tabId) detachViewFromWindow(state, tab);
  destroyTabView(tab);
  if (state.activeTabId === tabId) state.activeTabId = null;
  sendTabState(state, { parkedTabId: tabId });
  saveDesktopStateSoon();
  return true;
}

async function closeTab(state, tabId) {
  const tab = state.tabs.get(tabId);
  if (!tab) return false;
  const keys = [...state.tabs.keys()];
  const index = keys.indexOf(tabId);

  detachViewFromWindow(state, tab);
  destroyTabView(tab);
  state.tabs.delete(tabId);

  if (tab.temporary) {
    const partition = partitionFor(tab);
    const tempSession = session.fromPartition(partition);
    await Promise.allSettled([tempSession.clearStorageData(), tempSession.clearCache()]);
    configuredPartitions.delete(partition);
    partitionTabIds.delete(partition);
  }

  if (state.activeTabId === tabId) {
    state.activeTabId = null;
    const replacement = keys[index + 1] || keys[index - 1];
    if (replacement && state.tabs.has(replacement)) await activateTab(state, replacement);
    else sendTabState(state);
  } else {
    sendTabState(state);
  }
  saveDesktopStateSoon();
  return true;
}

function showDashboard(state) {
  const active = state.tabs.get(state.activeTabId);
  if (active) {
    detachViewFromWindow(state, active);
    if (active.profile.parkWhenInactive && !active.keepActive) destroyTabView(active);
    else if (active.view && !active.view.webContents.isDestroyed()) {
      active.view.webContents.setBackgroundThrottling(!active.keepActive);
    }
  }
  state.activeTabId = null;
  sendTabState(state, { dashboard: true });
  saveDesktopStateSoon();
}

async function detachTabToNewWindow(state, tabId) {
  const tab = state.tabs.get(tabId);
  if (!tab) return false;

  detachViewFromWindow(state, tab);
  state.tabs.delete(tabId);
  if (state.activeTabId === tabId) state.activeTabId = null;
  sendTabState(state);

  const target = createBrowserWindow();
  tab.windowId = target.id;
  target.tabs.set(tab.id, tab);
  saveDesktopStateSoon();
  return true;
}

function releaseInactiveTabs(state) {
  let count = 0;
  for (const tab of state.tabs.values()) {
    if (tab.id !== state.activeTabId && !tab.keepActive && tab.view) {
      destroyTabView(tab);
      count += 1;
    }
  }
  sendTabState(state, { releasedCount: count });
  saveDesktopStateSoon();
  return count;
}

function activeTab(state) {
  return state.tabs.get(state.activeTabId) || null;
}

function activeContents(state) {
  return activeTab(state)?.view?.webContents || null;
}

ipcMain.handle('tabs:list', (event) => {
  const state = findWindowByWebContents(event.sender);
  if (!state) return { tabs: [], activeTabId: null };
  return {
    windowId: state.id,
    activeTabId: state.activeTabId,
    tabs: [...state.tabs.values()].map(publicTab)
  };
});

ipcMain.handle('tabs:open', async (event, profile) => {
  const state = findWindowByWebContents(event.sender);
  if (!state) throw new Error('Browser window not found.');
  return createTab(state, profile);
});

ipcMain.handle('tabs:activate', async (event, tabId) => {
  const state = findWindowByWebContents(event.sender);
  return state ? activateTab(state, tabId) : false;
});

ipcMain.handle('tabs:close', async (event, tabId) => {
  const state = findWindowByWebContents(event.sender);
  return state ? closeTab(state, tabId) : false;
});

ipcMain.handle('tabs:keep-active', (event, tabId, keepActive) => {
  const state = findWindowByWebContents(event.sender);
  const tab = state?.tabs.get(tabId);
  if (!tab) return false;
  tab.keepActive = Boolean(keepActive);
  if (tab.view && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.setBackgroundThrottling(!tab.keepActive && state.activeTabId !== tab.id);
  }
  sendTabState(state);
  saveDesktopStateSoon();
  return true;
});

ipcMain.handle('tabs:park', (event, tabId) => {
  const state = findWindowByWebContents(event.sender);
  return state ? parkTab(state, tabId) : false;
});

ipcMain.handle('tabs:release-inactive', (event) => {
  const state = findWindowByWebContents(event.sender);
  return state ? releaseInactiveTabs(state) : 0;
});

ipcMain.handle('tabs:set-preset', (event, tabId, preset) => {
  const state = findWindowByWebContents(event.sender);
  const tab = state?.tabs.get(tabId);
  if (!tab || !['hardened', 'balanced', 'compatibility', 'custom'].includes(preset)) return false;
  applyPreset(tab.profile, preset);
  sendTabState(state);
  saveDesktopStateSoon();
  return true;
});

ipcMain.handle('tabs:detach', async (event, tabId) => {
  const state = findWindowByWebContents(event.sender);
  return state ? detachTabToNewWindow(state, tabId) : false;
});

ipcMain.handle('window:new', () => {
  const state = createBrowserWindow();
  return state.id;
});

ipcMain.handle('browser:dashboard', (event) => {
  const state = findWindowByWebContents(event.sender);
  if (!state) return false;
  showDashboard(state);
  return true;
});

ipcMain.handle('browser:navigate', async (event, input) => {
  const state = findWindowByWebContents(event.sender);
  const tab = state && activeTab(state);
  const contents = state && activeContents(state);
  const url = validatedWebUrl(input);
  if (!tab || !contents || !url) return false;
  await contents.loadURL(tab.profile.privacy?.clearUrls ? stripTracking(url) : url);
  return true;
});

ipcMain.handle('browser:toggle-desktop', (event) => {
  const state = findWindowByWebContents(event.sender);
  const tab = state && activeTab(state);
  const contents = state && activeContents(state);
  if (!tab || !contents) return false;
  const desktop = !(tab.profile.renderMode === 'desktop' || tab.profile.uaPreset === 'desktop');
  tab.profile.renderMode = desktop ? 'desktop' : 'mobile';
  tab.profile.uaPreset = desktop ? 'desktop' : 'mobile';
  contents.setUserAgent(desktop ? DESKTOP_UA : MOBILE_UA);
  contents.reload();
  sendTabState(state);
  saveDesktopStateSoon();
  return desktop;
});

ipcMain.on('browser:command', (event, command) => {
  const state = findWindowByWebContents(event.sender);
  const contents = state && activeContents(state);
  if (!contents) return;
  if (command === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  else if (command === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  else if (command === 'reload') contents.reload();
  else if (command === 'devtools') contents.openDevTools({ mode: 'detach' });
});

ipcMain.handle('app:quit-and-release', () => {
  saveDesktopState();
  shuttingDown = true;
  app.quit();
  return true;
});

ipcMain.handle('app:metrics', () => app.getAppMetrics().map((metric) => ({
  pid: metric.pid,
  type: metric.type,
  cpu: metric.cpu?.percentCPUUsage || 0,
  memoryKB: metric.memory?.workingSetSize || 0
})));

app.whenReady().then(() => {
  const restored = loadDesktopState();
  if (restored.length) restored.forEach((windowState) => createBrowserWindow(windowState));
  else createBrowserWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBrowserWindow();
  });
});

app.on('before-quit', () => {
  saveDesktopState();
  shuttingDown = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
