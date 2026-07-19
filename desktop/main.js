const path = require('path');
const { app, BrowserWindow, WebContentsView, session, ipcMain, shell } = require('electron');
const { stripTracking, shouldBlock } = require('./security');

const APP_ID = 'com.fypm.silentpwebspace';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 SilentP/0.2';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 SilentP/0.2';
const AUTO_RELEASE_ON_MINIMIZE = true;

let mainWindow = null;
let siteView = null;
let activeProfile = null;
let desktopOverride = false;
const configuredPartitions = new Set();
const partitionProfiles = new Map();

app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('enable-features', 'GlobalPrivacyControl');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

function uiPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'web', 'index.html') : path.join(__dirname, '..', 'web', 'index.html');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#080b10',
    title: 'Silent P. PWSA',
    autoHideMenuBar: true,
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
  mainWindow.loadFile(uiPath());
  mainWindow.webContents.setBackgroundThrottling(true);
  mainWindow.on('resize', layoutSiteView);
  mainWindow.on('minimize', () => {
    if (AUTO_RELEASE_ON_MINIMIZE) releaseRenderer('minimized');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    siteView = null;
  });
}

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || `profile-${Date.now()}`;
}

function partitionFor(profile) {
  const id = safeId(profile.id);
  return profile.temporary ? `silentp-temp-${id}` : `persist:silentp-${id}`;
}

function currentProfile(partition) {
  return partitionProfiles.get(partition) || {};
}

function permissionAllowed(profile, permission, details = {}) {
  const permissions = profile.permissions || {};
  if (permission === 'media') {
    const requested = details.mediaTypes || [];
    if (!requested.length) return Boolean(permissions.camera || permissions.microphone);
    return requested.every((type) => type === 'video' ? Boolean(permissions.camera) : type === 'audio' ? Boolean(permissions.microphone) : false);
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
  profileSession.setPermissionRequestHandler((_webContents, permission, callback, details) => callback(permissionAllowed(currentProfile(partition), permission, details)));
  profileSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => permissionAllowed(currentProfile(partition), permission, details));
  profileSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const profile = currentProfile(partition);
    if (profile.privacy?.blocking && shouldBlock(details.url)) return callback({ cancel: true });
    const cleaned = profile.privacy?.clearUrls && details.resourceType === 'mainFrame' ? stripTracking(details.url) : details.url;
    callback(cleaned !== details.url ? { redirectURL: cleaned } : {});
  });
  profileSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const profile = currentProfile(partition);
    const requestHeaders = { ...details.requestHeaders };
    if (profile.privacy?.gpc) {
      requestHeaders['Sec-GPC'] = '1';
      requestHeaders.DNT = '1';
    }
    const language = profile.language || 'en-US';
    requestHeaders['Accept-Language'] = `${language},en;q=0.8`;
    callback({ requestHeaders });
  });
  profileSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function validatedWebUrl(input) {
  try {
    const value = new URL(input);
    return ['http:', 'https:'].includes(value.protocol) ? value.href : null;
  } catch {
    return null;
  }
}

async function openProfile(profile) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const url = validatedWebUrl(profile.url);
  if (!url) throw new Error('Only HTTP and HTTPS website addresses are supported.');

  activeProfile = profile;
  desktopOverride = profile.renderMode === 'desktop' || profile.uaPreset === 'desktop';
  releaseRenderer('profile-switch', false);

  const partition = partitionFor(profile);
  partitionProfiles.set(partition, profile);
  const profileSession = session.fromPartition(partition, { cache: !profile.temporary });
  configureSession(profileSession, partition);

  siteView = new WebContentsView({
    webPreferences: {
      session: profileSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      javascript: true,
      backgroundThrottling: true
    }
  });
  siteView.webContents.setBackgroundThrottling(true);
  mainWindow.contentView.addChildView(siteView);
  layoutSiteView();

  const webContents = siteView.webContents;
  webContents.setUserAgent(desktopOverride ? DESKTOP_UA : MOBILE_UA);
  webContents.setWindowOpenHandler(({ url: target }) => {
    const safeTarget = validatedWebUrl(target);
    if (!safeTarget) {
      shell.openExternal(target).catch(() => {});
      return { action: 'deny' };
    }
    if (activeProfile?.externalLinkBehavior === 'external') shell.openExternal(safeTarget).catch(() => {});
    else webContents.loadURL(safeTarget).catch((error) => sendState({ error: { description: error.message, url: safeTarget } }));
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, target) => {
    if (!validatedWebUrl(target)) {
      event.preventDefault();
      shell.openExternal(target).catch(() => {});
    }
  });
  webContents.on('did-navigate', (_event, target) => sendState({ url: target }));
  webContents.on('did-navigate-in-page', (_event, target) => sendState({ url: target }));
  webContents.on('page-title-updated', (_event, title) => sendState({ title }));
  webContents.on('did-fail-load', (_event, code, description, target, isMainFrame) => {
    if (isMainFrame && code !== -3) sendState({ error: { code, description, url: target } });
  });
  webContents.on('render-process-gone', (_event, details) => sendState({ error: { description: `Renderer exited: ${details.reason}` } }));

  await webContents.loadURL(profile.privacy?.clearUrls ? stripTracking(url) : url);
  return true;
}

function layoutSiteView() {
  if (!mainWindow || mainWindow.isDestroyed() || !siteView) return;
  const [width, height] = mainWindow.getContentSize();
  const toolbarHeight = width < 900 ? 108 : 64;
  siteView.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(100, height - toolbarHeight) });
}

function sendState(value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('browser:state', value);
}

function destroySiteView() {
  if (!siteView || !mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.contentView.removeChildView(siteView);
  if (!siteView.webContents.isDestroyed()) siteView.webContents.close({ waitForBeforeUnload: false });
  siteView = null;
  return true;
}

function releaseRenderer(reason = 'manual', notify = true) {
  const released = destroySiteView();
  if (released && notify) sendState({ released: true, reason, profileId: activeProfile?.id || null });
  return released;
}

function clearTemporaryProfile() {
  if (!activeProfile?.temporary) return;
  const partition = partitionFor(activeProfile);
  const temporarySession = session.fromPartition(partition);
  temporarySession.clearStorageData().catch(() => {});
  temporarySession.clearCache().catch(() => {});
  partitionProfiles.delete(partition);
  configuredPartitions.delete(partition);
}

function closeProfile() {
  releaseRenderer('profile-close', false);
  clearTemporaryProfile();
  activeProfile = null;
  sendState({ closed: true });
}

ipcMain.handle('browser:open', async (_event, profile) => openProfile(profile));
ipcMain.handle('browser:close', () => { closeProfile(); return true; });
ipcMain.handle('browser:release', () => releaseRenderer('manual'));
ipcMain.handle('app:quit-for-maps', () => {
  closeProfile();
  app.quit();
  return true;
});
ipcMain.handle('app:metrics', () => app.getAppMetrics().map((metric) => ({
  pid: metric.pid,
  type: metric.type,
  cpu: metric.cpu?.percentCPUUsage || 0,
  memoryKB: metric.memory?.workingSetSize || 0
})));
ipcMain.handle('browser:navigate', async (_event, input) => {
  if (!siteView) return false;
  const url = validatedWebUrl(input);
  if (!url) throw new Error('Only HTTP and HTTPS website addresses are supported.');
  await siteView.webContents.loadURL(activeProfile?.privacy?.clearUrls ? stripTracking(url) : url);
  return true;
});
ipcMain.handle('browser:toggle-desktop', () => {
  if (!siteView) return false;
  desktopOverride = !desktopOverride;
  siteView.webContents.setUserAgent(desktopOverride ? DESKTOP_UA : MOBILE_UA);
  siteView.webContents.reload();
  return desktopOverride;
});
ipcMain.on('browser:command', (_event, command) => {
  if (!siteView) return;
  const webContents = siteView.webContents;
  if (command === 'back' && webContents.navigationHistory.canGoBack()) webContents.navigationHistory.goBack();
  else if (command === 'forward' && webContents.navigationHistory.canGoForward()) webContents.navigationHistory.goForward();
  else if (command === 'reload') webContents.reload();
  else if (command === 'devtools') webContents.openDevTools({ mode: 'detach' });
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('before-quit', () => {
  releaseRenderer('quit', false);
  clearTemporaryProfile();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
