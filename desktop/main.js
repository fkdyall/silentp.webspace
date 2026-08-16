'use strict';

const path = require('path');
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  shell,
  Menu,
  clipboard
} = require('electron');
const { stripTracking, shouldBlock } = require('./security');
const {
  normalizeContainer,
  partitionForContainer,
  matchingContainers,
  applyPreset,
  setContainerPermission
} = require('./container-model');
const { loadBrowserState, saveBrowserState } = require('./state-store');
const { contextActionIds } = require('./context-menu');

const APP_ID = 'com.fypm.silentpwebspace';
const VERSION = '0.3';
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 SilentP/${VERSION}`;
const DESKTOP_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 SilentP/${VERSION}`;
const TAB_STRIP_HEIGHT = 44;
const BROWSER_BAR_HEIGHT = 64;

const windows = new Map();
const containers = new Map();
const configuredPartitions = new Set();
const partitionContainerIds = new Map();
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

function browserStatePath() {
  return path.join(app.getPath('userData'), 'browser-state-v2.json');
}

function legacyStatePath() {
  return path.join(app.getPath('userData'), 'desktop-session.json');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validatedWebUrl(input) {
  try {
    const value = new URL(input);
    return ['http:', 'https:'].includes(value.protocol) ? value.href : null;
  } catch {
    return null;
  }
}

function findWindowByWebContents(webContents) {
  const browserWindow = BrowserWindow.fromWebContents(webContents);
  if (!browserWindow) return null;
  for (const state of windows.values()) {
    if (state.browserWindow === browserWindow) return state;
  }
  return null;
}

function containerForTab(tab) {
  return tab ? containers.get(tab.containerId) || null : null;
}

function containerForPartition(partition) {
  return containers.get(partitionContainerIds.get(partition)) || null;
}

function partitionForTab(tab) {
  const container = containerForTab(tab);
  return container ? partitionForContainer(container) : null;
}

function permissionAllowed(container, permission, details = {}) {
  const permissions = container?.permissions || {};
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
    callback(permissionAllowed(containerForPartition(partition), permission, details));
  });

  profileSession.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    return permissionAllowed(containerForPartition(partition), permission, details);
  });

  profileSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const container = containerForPartition(partition);
      if (!container) return callback({});
      if (container.privacy?.blocking && shouldBlock(details.url)) {
        return callback({ cancel: true });
      }
      const cleaned = container.privacy?.clearUrls && details.resourceType === 'mainFrame'
        ? stripTracking(details.url)
        : details.url;
      callback(cleaned !== details.url ? { redirectURL: cleaned } : {});
    }
  );

  profileSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const container = containerForPartition(partition);
      const requestHeaders = { ...details.requestHeaders };
      if (container?.privacy?.gpc) {
        requestHeaders['Sec-GPC'] = '1';
        requestHeaders.DNT = '1';
      }
      const language = container?.language || 'en-US';
      requestHeaders['Accept-Language'] = `${language},en;q=0.8`;
      callback({ requestHeaders });
    }
  );

  profileSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));

  profileSession.on('will-download', (_event, item) => {
    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sendDownload = (state) => {
      const containerId = partitionContainerIds.get(partition);
      for (const windowState of windows.values()) {
        if (![...windowState.tabs.values()].some((tab) => tab.containerId === containerId)) continue;
        sendToWindow(windowState, 'downloads:changed', {
          id: downloadId,
          filename: item.getFilename(),
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          savePath: item.getSavePath() || ''
        });
      }
    };
    sendDownload('started');
    item.on('updated', (_updatedEvent, state) => sendDownload(state));
    item.once('done', (_doneEvent, state) => sendDownload(state));
  });
}

function serializedTab(tab) {
  return {
    id: tab.id,
    containerId: tab.containerId,
    title: tab.title,
    url: tab.url,
    keepActive: Boolean(tab.keepActive),
    parked: Boolean(tab.parked),
    temporary: Boolean(tab.temporary),
    createdAt: tab.createdAt
  };
}

function publicTab(tab) {
  const container = containerForTab(tab);
  return {
    id: tab.id,
    containerId: tab.containerId,
    title: tab.title || container?.name || 'New tab',
    url: tab.url,
    color: container?.color || '#68e1c5',
    containerName: container?.name || 'Unknown container',
    keepActive: Boolean(tab.keepActive),
    parked: Boolean(tab.parked || !tab.view),
    privacyPreset: container?.privacyPreset || 'hardened',
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
    version: 2,
    containers: [...containers.values()].filter((container) => !container.temporary).map(clone),
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
    saveBrowserState(browserStatePath(), payload);
  } catch (error) {
    console.error('Unable to save desktop session:', error);
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
    title: 'FYPM Browser',
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
    chromeHeight: TAB_STRIP_HEIGHT + BROWSER_BAR_HEIGHT,
    bounds
  };
  windows.set(windowId, state);

  for (const saved of restored?.tabs || []) {
    const container = containers.get(saved.containerId);
    if (!container) continue;
    state.tabs.set(saved.id, {
      id: saved.id,
      windowId,
      containerId: container.id,
      title: saved.title || container.name || 'Restored tab',
      url: saved.url || container.primaryUrl,
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
  const container = containerForTab(tab);
  return Boolean(
    container?.permissions?.popups ||
    container?.privacyPreset === 'balanced' ||
    container?.privacyPreset === 'compatibility'
  );
}

function showTabContextMenu(state, tab, contents, params) {
  const navigation = contents.navigationHistory;
  const actions = contextActionIds(params, {
    canGoBack: navigation.canGoBack(),
    canGoForward: navigation.canGoForward()
  });
  const items = {
    cut: { label: 'Cut', role: 'cut' },
    copy: { label: 'Copy', role: 'copy' },
    paste: { label: 'Paste', role: 'paste' },
    selectAll: { label: 'Select All', role: 'selectAll' },
    openLink: {
      label: 'Open Link in New Tab',
      click: () => createTab(state, { containerId: tab.containerId, url: params.linkURL }).catch(console.error)
    },
    copyLink: { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
    back: { label: 'Back', click: () => navigation.goBack() },
    forward: { label: 'Forward', click: () => navigation.goForward() },
    reload: { label: 'Reload', click: () => contents.reload() }
  };
  Menu.buildFromTemplate(actions.map((action) => items[action])).popup({ window: state.browserWindow });
}

function createTabView(state, tab) {
  if (tab.view && !tab.view.webContents.isDestroyed()) return tab.view;

  const container = containerForTab(tab);
  if (!container) throw new Error(`Container not found for tab ${tab.id}`);
  const partition = partitionForContainer(container);
  partitionContainerIds.set(partition, container.id);
  const profileSession = session.fromPartition(partition, { cache: !container.temporary });
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
  const desktop = container.renderMode === 'desktop' || container.uaPreset === 'desktop';
  contents.setUserAgent(desktop ? DESKTOP_UA : MOBILE_UA);
  contents.setBackgroundThrottling(!tab.keepActive);
  contents.on('context-menu', (_event, params) => showTabContextMenu(state, tab, contents, params));

  contents.setWindowOpenHandler((details) => {
    const target = validatedWebUrl(details.url);
    if (!target) {
      shell.openExternal(details.url).catch(() => {});
      return { action: 'deny' };
    }

    if (container.externalLinkBehavior === 'external') {
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
  const container = containerForTab(tab);
  const target = validatedWebUrl(tab.url || container?.primaryUrl);
  if (!target) throw new Error('Only HTTP and HTTPS website addresses are supported.');
  const view = tab.view;
  if (!view || view.webContents.isDestroyed()) throw new Error('Tab renderer is unavailable.');
  const cleaned = container?.privacy?.clearUrls ? stripTracking(target) : target;
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
  const top = state.chromeHeight || TAB_STRIP_HEIGHT + BROWSER_BAR_HEIGHT;
  tab.view.setBounds({ x: 0, y: top, width, height: Math.max(100, height - top) });
}

async function activateTab(state, tabId) {
  const next = state.tabs.get(tabId);
  if (!next) return false;

  const current = state.tabs.get(state.activeTabId);
  if (current && current.id !== next.id) {
    detachViewFromWindow(state, current);
    if (containerForTab(current)?.parkWhenInactive && !current.keepActive) {
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

async function createTab(state, request = {}) {
  let container = request.containerId ? containers.get(request.containerId) : null;
  if (!container) {
    container = normalizeContainer({
      ...request,
      id: request.id || id(request.temporary ? 'temp' : 'container'),
      primaryUrl: request.primaryUrl || request.url || '',
      temporary: Boolean(request.temporary)
    });
    containers.set(container.id, container);
  }
  const tab = {
    id: id('tab'),
    windowId: state.id,
    containerId: container.id,
    title: container.name || 'New tab',
    url: request.url || container.primaryUrl,
    keepActive: false,
    parked: false,
    temporary: Boolean(container.temporary),
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
    const stillOpen = [...windows.values()].some((windowState) =>
      [...windowState.tabs.values()].some((candidate) => candidate.containerId === tab.containerId)
    );
    if (!stillOpen) {
      const container = containers.get(tab.containerId);
      const partition = container && partitionForContainer(container);
      if (partition) {
        const tempSession = session.fromPartition(partition);
        await Promise.allSettled([tempSession.clearStorageData(), tempSession.clearCache()]);
        configuredPartitions.delete(partition);
        partitionContainerIds.delete(partition);
      }
      containers.delete(tab.containerId);
    }
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
    if (containerForTab(active)?.parkWhenInactive && !active.keepActive) destroyTabView(active);
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

function publicContainer(container) {
  return clone(container);
}

function broadcastTabStateForContainer(containerId) {
  for (const state of windows.values()) {
    if ([...state.tabs.values()].some((tab) => tab.containerId === containerId)) sendTabState(state);
  }
}

ipcMain.handle('containers:list', () => [...containers.values()].map(publicContainer));

ipcMain.handle('containers:create', (_event, input = {}) => {
  const container = normalizeContainer({
    ...input,
    id: input.id || id(input.temporary ? 'temp' : 'container'),
    primaryUrl: input.primaryUrl || input.url || '',
    temporary: Boolean(input.temporary)
  });
  containers.set(container.id, container);
  saveDesktopStateSoon();
  return publicContainer(container);
});

ipcMain.handle('containers:update', (_event, containerId, changes = {}) => {
  const current = containers.get(containerId);
  if (!current) return null;
  const updated = normalizeContainer({
    ...current,
    ...changes,
    id: current.id,
    partitionKey: current.partitionKey,
    temporary: current.temporary,
    updatedAt: Date.now()
  });
  containers.set(updated.id, updated);
  saveDesktopStateSoon();
  return publicContainer(updated);
});

ipcMain.handle('containers:remove', async (_event, containerId) => {
  const inUse = [...windows.values()].some((state) =>
    [...state.tabs.values()].some((tab) => tab.containerId === containerId)
  );
  if (inUse) return false;
  const container = containers.get(containerId);
  if (!container) return false;
  const partition = partitionForContainer(container);
  const containerSession = session.fromPartition(partition, { cache: !container.temporary });
  await Promise.allSettled([containerSession.clearStorageData(), containerSession.clearCache()]);
  configuredPartitions.delete(partition);
  partitionContainerIds.delete(partition);
  containers.delete(containerId);
  saveDesktopStateSoon();
  return true;
});

ipcMain.handle('containers:clear', async (_event, containerId) => {
  const container = containers.get(containerId);
  if (!container) return false;
  const containerSession = session.fromPartition(partitionForContainer(container), { cache: !container.temporary });
  await Promise.all([containerSession.clearStorageData(), containerSession.clearCache()]);
  return true;
});

ipcMain.handle('containers:route-url', (_event, input) => {
  const url = validatedWebUrl(input);
  if (!url) return { action: 'invalid', url: String(input || '') };
  const matches = matchingContainers([...containers.values()], url);
  if (matches.length === 1) return { action: 'open', containerId: matches[0].id, url };
  if (matches.length > 1) {
    return {
      action: 'choose',
      url,
      matches: matches.map(({ id: matchId, name, primaryUrl }) => ({ id: matchId, name, primaryUrl }))
    };
  }
  return { action: 'unmatched', url };
});

ipcMain.handle('containers:get-active', (event) => {
  const state = findWindowByWebContents(event.sender);
  const container = containerForTab(state && activeTab(state));
  return container ? publicContainer(container) : null;
});

ipcMain.handle('containers:set-permission', (_event, containerId, permission, allowed) => {
  const current = containers.get(containerId);
  if (!current) return null;
  const updated = setContainerPermission(current, permission, allowed);
  containers.set(updated.id, updated);
  broadcastTabStateForContainer(updated.id);
  saveDesktopStateSoon();
  return publicContainer(updated);
});

ipcMain.handle('containers:apply-preset', (_event, containerId, preset) => {
  const current = containers.get(containerId);
  if (!current || !['hardened', 'balanced', 'compatibility'].includes(preset)) return null;
  const updated = applyPreset(current, preset);
  containers.set(updated.id, updated);
  broadcastTabStateForContainer(updated.id);
  saveDesktopStateSoon();
  return publicContainer(updated);
});

ipcMain.handle('tabs:list', (event) => {
  const state = findWindowByWebContents(event.sender);
  if (!state) return { tabs: [], activeTabId: null };
  return {
    windowId: state.id,
    activeTabId: state.activeTabId,
    tabs: [...state.tabs.values()].map(publicTab)
  };
});

ipcMain.handle('tabs:open', async (event, request) => {
  const state = findWindowByWebContents(event.sender);
  if (!state) throw new Error('Browser window not found.');
  return createTab(state, request);
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
  const container = containerForTab(tab);
  if (!container) return false;
  containers.set(container.id, preset === 'custom' ? container : applyPreset(container, preset));
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

ipcMain.handle('browser:set-chrome-height', (event, requestedHeight) => {
  const state = findWindowByWebContents(event.sender);
  if (!state) return false;
  state.chromeHeight = Math.max(108, Math.min(500, Number(requestedHeight) || 108));
  layoutActiveView(state);
  return true;
});

ipcMain.handle('browser:navigate', async (event, input) => {
  const state = findWindowByWebContents(event.sender);
  const tab = state && activeTab(state);
  const contents = state && activeContents(state);
  const url = validatedWebUrl(input);
  if (!tab || !contents || !url) return false;
  const container = containerForTab(tab);
  await contents.loadURL(container?.privacy?.clearUrls ? stripTracking(url) : url);
  return true;
});

ipcMain.handle('browser:toggle-desktop', (event) => {
  const state = findWindowByWebContents(event.sender);
  const tab = state && activeTab(state);
  const contents = state && activeContents(state);
  if (!tab || !contents) return false;
  const container = containerForTab(tab);
  if (!container) return false;
  const desktop = !(container.renderMode === 'desktop' || container.uaPreset === 'desktop');
  container.renderMode = desktop ? 'desktop' : 'mobile';
  container.uaPreset = desktop ? 'desktop' : 'mobile';
  container.updatedAt = Date.now();
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
  const restored = loadBrowserState({
    browserStatePath: browserStatePath(),
    legacyStatePath: legacyStatePath()
  });
  restored.containers.forEach((container) => containers.set(container.id, container));
  if (restored.windows.length) restored.windows.forEach((windowState) => createBrowserWindow(windowState));
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
