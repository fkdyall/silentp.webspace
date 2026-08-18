'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  app, BrowserWindow, WebContentsView, session, ipcMain, shell, Menu, clipboard, webContents
} = require('electron');
const { stripTracking } = require('./security');
const {
  normalizeProfile, normalizeCompartment, partitionForCompartment, resolveCompartment,
  partitionKeysForProfile, validateTabOwnership, popupRouteForTarget,
  callbackBelongsToOrigin, permissionAllowed, hostForUrl
} = require('./profile-model');
const {
  classifyRequest, normalizeAllowance, serializableAllowances,
  headersForRequestPolicy, headersForResponsePolicy
} = require('./privacy-policy');
const { loadBrowserState, saveBrowserState, legacyUserDataPath } = require('./state-store');
const { contextActionIds } = require('./context-menu');

const APP_ID = 'com.fypm.silentpwebspace';
const VERSION = '0.4';
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 FYPM/${VERSION}`;
const DESKTOP_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 FYPM/${VERSION}`;
const TAB_STRIP_HEIGHT = 44;
const BROWSER_BAR_HEIGHT = 64;

const windows = new Map();
const profiles = new Map();
const compartments = new Map();
const compatibilityAllowances = new Map();
const configuredPartitions = new Set();
const partitionCompartmentIds = new Map();
let shuttingDown = false;
let saveTimer = null;

app.setAppUserModelId(APP_ID);
const migrationUserDataPath = legacyUserDataPath(app.getPath('appData'));
fs.mkdirSync(migrationUserDataPath, { recursive: true });
app.setPath('userData', migrationUserDataPath);
app.commandLine.appendSwitch('enable-features', 'GlobalPrivacyControl');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

function uiPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'web', 'index.html') : path.join(__dirname, '..', 'web', 'index.html');
}

function browserStatePath() { return path.join(app.getPath('userData'), 'browser-state-v3.json'); }
function v2StatePath() { return path.join(app.getPath('userData'), 'browser-state-v2.json'); }
function legacyStatePath() { return path.join(app.getPath('userData'), 'desktop-session.json'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function validatedWebUrl(input) {
  try {
    const value = new URL(input);
    return ['http:', 'https:'].includes(value.protocol) ? value.href : null;
  } catch { return null; }
}

function findWindowByWebContents(contents) {
  const browserWindow = BrowserWindow.fromWebContents(contents);
  if (!browserWindow) return null;
  return [...windows.values()].find((state) => state.browserWindow === browserWindow) || null;
}

function profileForWindow(state) { return state ? profiles.get(state.profileId) || null : null; }
function compartmentForTab(tab) { return tab ? compartments.get(tab.compartmentId) || null : null; }
function compartmentForPartition(partition) { return compartments.get(partitionCompartmentIds.get(partition)) || null; }
function partitionForTab(tab) { const site = compartmentForTab(tab); return site ? partitionForCompartment(site) : null; }

function tabForWebContentsId(contentsId) {
  for (const state of windows.values()) {
    for (const tab of state.tabs.values()) {
      if (tab.view?.webContents.id === contentsId) return { state, tab };
    }
  }
  return null;
}

function allowancesForCompartment(site) {
  return [...compatibilityAllowances.values()].filter((allowance) =>
    allowance.profileId === site.profileId && allowance.compartmentId === site.id
  );
}

function requestContext(partition, details) {
  const site = compartmentForPartition(partition);
  const owner = tabForWebContentsId(details.webContentsId);
  const topLevelUrl = owner?.tab?.view?.webContents.getURL() || site?.primaryUrl || details.url;
  return {
    profileId: site?.profileId,
    compartmentId: site?.id,
    compartment: site,
    allowances: site ? allowancesForCompartment(site) : [],
    topLevelUrl,
    url: details.url,
    resourceType: details.resourceType
  };
}

function configureSession(profileSession, partition) {
  if (configuredPartitions.has(partition)) return;
  configuredPartitions.add(partition);
  profileSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permissionAllowed(compartmentForPartition(partition), permission, details));
  });
  profileSession.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    permissionAllowed(compartmentForPartition(partition), permission, details)
  );
  profileSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const site = compartmentForPartition(partition);
    if (!site) return callback({});
    const decision = classifyRequest(requestContext(partition, details));
    if (decision.block) {
      const owner = tabForWebContentsId(details.webContentsId);
      if (owner) {
        owner.tab.blockedRequestCount = (owner.tab.blockedRequestCount || 0) + 1;
        sendTabState(owner.state);
      }
      return callback({ cancel: true });
    }
    const cleaned = site.privacy?.clearUrls && details.resourceType === 'mainFrame' ? stripTracking(details.url) : details.url;
    callback(cleaned !== details.url ? { redirectURL: cleaned } : {});
  });
  profileSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const site = compartmentForPartition(partition);
    const decision = classifyRequest(requestContext(partition, details));
    const requestHeaders = headersForRequestPolicy(details.requestHeaders, decision);
    if (site?.privacy?.gpc) { requestHeaders['Sec-GPC'] = '1'; requestHeaders.DNT = '1'; }
    requestHeaders['Accept-Language'] = `${site?.language || 'en-US'},en;q=0.8`;
    callback({ requestHeaders });
  });
  profileSession.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const decision = classifyRequest(requestContext(partition, details));
    callback({ responseHeaders: headersForResponsePolicy(details.responseHeaders, decision) });
  });
  profileSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  profileSession.on('will-download', (_event, item) => {
    if (!permissionAllowed(compartmentForPartition(partition), 'downloads')) { item.cancel(); return; }
    const downloadId = id('download');
    const sendDownload = (stateName) => {
      const compartmentId = partitionCompartmentIds.get(partition);
      for (const state of windows.values()) {
        if (![...state.tabs.values()].some((tab) => tab.compartmentId === compartmentId)) continue;
        sendToWindow(state, 'downloads:changed', {
          id: downloadId, filename: item.getFilename(), state: stateName,
          receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), savePath: item.getSavePath() || ''
        });
      }
    };
    sendDownload('started');
    item.on('updated', (_event, stateName) => sendDownload(stateName));
    item.once('done', (_event, stateName) => sendDownload(stateName));
  });
}

function serializedTab(tab) {
  return {
    id: tab.id, compartmentId: tab.compartmentId, title: tab.title, url: tab.url,
    keepActive: Boolean(tab.keepActive), parked: Boolean(tab.parked), temporary: Boolean(tab.temporary), createdAt: tab.createdAt
  };
}

function publicTab(tab) {
  const site = compartmentForTab(tab);
  const profile = site && profiles.get(site.profileId);
  return {
    id: tab.id, compartmentId: tab.compartmentId, containerId: tab.compartmentId,
    title: tab.title || site?.name || 'New tab', url: tab.url,
    color: profile?.color || '#68e1c5', profileName: profile?.name || 'Unknown profile',
    containerName: site?.name || 'Unknown site', compartmentName: site?.name || 'Unknown site',
    keepActive: Boolean(tab.keepActive), parked: Boolean(tab.parked || !tab.view),
    protectionLevel: site?.protectionLevel || 'hardened', compatibilityLevel: site?.compatibilityLevel || 0,
    blockedRequestCount: Number(tab.blockedRequestCount) || 0, temporary: Boolean(tab.temporary)
  };
}

function saveDesktopStateSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDesktopState, 150); }
function saveDesktopState() {
  if (windows.size === 0) return;
  const payload = {
    version: 3, migration: app.browserStateMigration || null,
    profiles: [...profiles.values()].map(clone), compartments: [...compartments.values()].map(clone),
    compatibilityAllowances: serializableAllowances([...compatibilityAllowances.values()]),
    windows: [...windows.values()].map((state) => ({
      id: state.id, profileId: state.profileId,
      bounds: state.browserWindow && !state.browserWindow.isDestroyed() ? state.browserWindow.getBounds() : state.bounds,
      activeTabId: state.activeTabId,
      tabs: [...state.tabs.values()].filter((tab) => !tab.temporary).map(serializedTab)
    }))
  };
  try { saveBrowserState(browserStatePath(), payload); } catch (error) { console.error('Unable to save desktop session:', error); }
}

function defaultProfile() {
  let profile = profiles.values().next().value;
  if (!profile) { profile = normalizeProfile({ id: id('profile'), name: 'Default Profile' }); profiles.set(profile.id, profile); }
  return profile;
}

function createBrowserWindow(restored = null, requestedProfileId = null) {
  const profile = profiles.get(restored?.profileId || requestedProfileId) || defaultProfile();
  const windowId = restored?.id || id('win');
  const bounds = restored?.bounds || { width: 1420, height: 920 };
  const browserWindow = new BrowserWindow({
    ...bounds, minWidth: 900, minHeight: 640, backgroundColor: '#080b10', title: `FYPM Browser — ${profile.name}`,
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: true }
  });
  const state = { id: windowId, profileId: profile.id, browserWindow, tabs: new Map(), activeTabId: null, chromeHeight: 108, bounds };
  windows.set(windowId, state);
  for (const saved of restored?.tabs || []) {
    const site = compartments.get(saved.compartmentId);
    if (!site || !validateTabOwnership(profile.id, site) || saved.temporary) continue;
    state.tabs.set(saved.id, {
      id: saved.id, windowId, compartmentId: site.id, title: saved.title || site.name,
      url: saved.url || site.primaryUrl, keepActive: Boolean(saved.keepActive), parked: true,
      temporary: false, blockedRequestCount: 0, createdAt: saved.createdAt || Date.now(), view: null
    });
  }
  browserWindow.loadFile(uiPath());
  browserWindow.webContents.setBackgroundThrottling(true);
  browserWindow.once('ready-to-show', async () => {
    browserWindow.show();
    const active = state.tabs.has(restored?.activeTabId) ? restored.activeTabId : state.tabs.keys().next().value;
    if (active) await activateTab(state, active); else sendTabState(state);
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
  if (state?.browserWindow && !state.browserWindow.isDestroyed()) state.browserWindow.webContents.send(channel, payload);
}
function sendTabState(state, extra = {}) {
  sendToWindow(state, 'tabs:state', { windowId: state.id, profileId: state.profileId, activeTabId: state.activeTabId, tabs: [...state.tabs.values()].map(publicTab), ...extra });
}
function updateTabFromContents(state, tab, changes) { Object.assign(tab, changes); sendTabState(state); saveDesktopStateSoon(); }

function popupAllowed(tab) {
  const site = compartmentForTab(tab);
  return Boolean(site?.permissions?.popups || site?.compatibilityLevel >= 1);
}

function showTabContextMenu(state, tab, contents, params) {
  const navigation = contents.navigationHistory;
  const actions = contextActionIds(params, { canGoBack: navigation.canGoBack(), canGoForward: navigation.canGoForward() });
  const items = {
    cut: { label: 'Cut', role: 'cut' }, copy: { label: 'Copy', role: 'copy' }, paste: { label: 'Paste', role: 'paste' }, selectAll: { label: 'Select All', role: 'selectAll' },
    openLink: { label: 'Open Link in New Tab', click: () => openUrlInProfile(state, params.linkURL).catch(console.error) },
    copyLink: { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
    back: { label: 'Back', click: () => navigation.goBack() }, forward: { label: 'Forward', click: () => navigation.goForward() }, reload: { label: 'Reload', click: () => contents.reload() }
  };
  Menu.buildFromTemplate(actions.map((action) => items[action])).popup({ window: state.browserWindow });
}

function ensureCompartment(state, url, options = {}) {
  const profile = profileForWindow(state);
  const resolved = resolveCompartment({ profile, compartments: [...compartments.values()], url });
  if (resolved.compartment) return resolved.compartment;
  const site = normalizeCompartment({
    id: options.id || id(options.temporary ? 'temp' : 'site'), profileId: state.profileId,
    key: options.temporary ? `temp:${crypto.randomUUID()}` : resolved.key,
    name: options.name || hostForUrl(url), primaryUrl: url, temporary: Boolean(options.temporary), persistent: !options.temporary
  });
  compartments.set(site.id, site);
  return site;
}

function openProviderAuthWindow(state, tab, target, providerSite) {
  const partition = partitionForCompartment(providerSite);
  partitionCompartmentIds.set(partition, providerSite.id);
  const providerSession = session.fromPartition(partition, { cache: true });
  configureSession(providerSession, partition);
  const origin = new URL(tab.url || compartmentForTab(tab).primaryUrl).origin;
  const popup = new BrowserWindow({
    parent: state.browserWindow, modal: false, width: 520, height: 720, show: true, autoHideMenuBar: true,
    webPreferences: { session: providerSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false }
  });
  popup.webContents.on('will-navigate', (event, nextUrl) => {
    if (!callbackBelongsToOrigin(nextUrl, origin)) return;
    event.preventDefault();
    if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(nextUrl).catch(console.error);
    popup.close();
  });
  popup.loadURL(target).catch((error) => sendToWindow(state, 'browser:notice', { type: 'oauth-error', message: error.message }));
}

async function switchTabCompartment(state, tab, target) {
  const site = ensureCompartment(state, target);
  if (site.id === tab.compartmentId) return false;
  detachViewFromWindow(state, tab); destroyTabView(tab);
  tab.compartmentId = site.id; tab.url = target; tab.title = site.name; tab.temporary = site.temporary; tab.blockedRequestCount = 0;
  await activateTab(state, tab.id);
  return true;
}

function createTabView(state, tab) {
  if (tab.view && !tab.view.webContents.isDestroyed()) return tab.view;
  const site = compartmentForTab(tab);
  if (!site || !validateTabOwnership(state.profileId, site)) throw new Error(`Invalid compartment ownership for tab ${tab.id}`);
  const partition = partitionForCompartment(site);
  partitionCompartmentIds.set(partition, site.id);
  const profileSession = session.fromPartition(partition, { cache: !site.temporary });
  configureSession(profileSession, partition);
  const view = new WebContentsView({ webPreferences: { session: profileSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, javascript: true, backgroundThrottling: !tab.keepActive } });
  tab.view = view; tab.parked = false;
  const contents = view.webContents;
  contents.setUserAgent(site.renderMode === 'desktop' || site.uaPreset === 'desktop' ? DESKTOP_UA : MOBILE_UA);
  contents.setBackgroundThrottling(!tab.keepActive);
  contents.on('context-menu', (_event, params) => showTabContextMenu(state, tab, contents, params));
  contents.setWindowOpenHandler((details) => {
    const target = validatedWebUrl(details.url);
    if (!target) { shell.openExternal(details.url).catch(() => {}); return { action: 'deny' }; }
    const route = popupRouteForTarget({ profile: profileForWindow(state), originCompartment: site, compartments: [...compartments.values()], targetUrl: target });
    if (route.action === 'provider') {
      const providerSite = compartments.get(route.compartmentId);
      setImmediate(() => openProviderAuthWindow(state, tab, target, providerSite));
      return { action: 'deny' };
    }
    if (site.externalLinkBehavior === 'external') { shell.openExternal(target).catch(() => {}); return { action: 'deny' }; }
    if (!popupAllowed(tab)) { sendToWindow(state, 'browser:notice', { tabId: tab.id, type: 'popup-blocked', message: 'Popup blocked. Raise compatibility for this site to allow it.' }); return { action: 'deny' }; }
    return { action: 'allow', overrideBrowserWindowOptions: { parent: state.browserWindow, autoHideMenuBar: true, webPreferences: { session: profileSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } } };
  });
  contents.on('did-create-window', (childWindow) => childWindow.setParentWindow(state.browserWindow));
  contents.on('will-navigate', (event, target) => {
    if (!validatedWebUrl(target)) { event.preventDefault(); shell.openExternal(target).catch(() => {}); return; }
    const route = popupRouteForTarget({ profile: profileForWindow(state), originCompartment: site, compartments: [...compartments.values()], targetUrl: target });
    if (route.action === 'provider') { event.preventDefault(); openProviderAuthWindow(state, tab, target, compartments.get(route.compartmentId)); return; }
    const resolved = resolveCompartment({ profile: profileForWindow(state), compartments: [...compartments.values()], url: target });
    if (resolved.compartment?.id !== tab.compartmentId || resolved.action === 'create') {
      event.preventDefault(); switchTabCompartment(state, tab, target).catch(console.error);
    }
  });
  contents.on('did-navigate', (_event, target) => updateTabFromContents(state, tab, { url: target }));
  contents.on('did-navigate-in-page', (_event, target) => updateTabFromContents(state, tab, { url: target }));
  contents.on('page-title-updated', (_event, title) => updateTabFromContents(state, tab, { title }));
  contents.on('did-fail-load', (_event, code, description, target, isMainFrame) => { if (isMainFrame && code !== -3) sendToWindow(state, 'browser:notice', { tabId: tab.id, type: 'load-error', message: description, url: target, code }); });
  contents.on('render-process-gone', (_event, details) => { tab.view = null; tab.parked = true; sendTabState(state, { notice: { type: 'renderer-exited', tabId: tab.id, message: `Tab renderer exited: ${details.reason}` } }); });
  return view;
}

async function loadTab(tab) {
  const site = compartmentForTab(tab);
  const target = validatedWebUrl(tab.url || site?.primaryUrl);
  if (!target) throw new Error('Only HTTP and HTTPS website addresses are supported.');
  if (!tab.view || tab.view.webContents.isDestroyed()) throw new Error('Tab renderer is unavailable.');
  await tab.view.webContents.loadURL(site?.privacy?.clearUrls ? stripTracking(target) : target);
}
function destroyTabView(tab) { if (!tab?.view) return false; const contents = tab.view.webContents; if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }); tab.view = null; tab.parked = true; return true; }
function detachViewFromWindow(state, tab) { if (!tab?.view || !state?.browserWindow || state.browserWindow.isDestroyed()) return; try { state.browserWindow.contentView.removeChildView(tab.view); } catch {} }
function layoutActiveView(state) { const tab = state.tabs.get(state.activeTabId); if (!tab?.view || state.browserWindow.isDestroyed()) return; const [width, height] = state.browserWindow.getContentSize(); const top = state.chromeHeight || 108; tab.view.setBounds({ x: 0, y: top, width, height: Math.max(100, height - top) }); }

async function activateTab(state, tabId) {
  const next = state.tabs.get(tabId); if (!next) return false;
  const current = state.tabs.get(state.activeTabId);
  if (current && current.id !== next.id) {
    detachViewFromWindow(state, current);
    if (compartmentForTab(current)?.parkWhenInactive && !current.keepActive) destroyTabView(current);
    else if (current.view && !current.view.webContents.isDestroyed()) current.view.webContents.setBackgroundThrottling(!current.keepActive);
  }
  state.activeTabId = next.id;
  const view = createTabView(state, next); state.browserWindow.contentView.addChildView(view); view.webContents.setBackgroundThrottling(false); layoutActiveView(state);
  if (!view.webContents.getURL()) await loadTab(next); else view.webContents.focus();
  sendTabState(state); saveDesktopStateSoon(); return true;
}

async function createTab(state, request = {}) {
  let site = compartments.get(request.compartmentId || request.containerId);
  if (!site) site = ensureCompartment(state, request.url || request.primaryUrl || '', request);
  if (!validateTabOwnership(state.profileId, site)) throw new Error('A tab cannot use another profile\'s compartment.');
  const tab = { id: id('tab'), windowId: state.id, compartmentId: site.id, title: site.name, url: request.url || site.primaryUrl, keepActive: false, parked: false, temporary: Boolean(site.temporary), blockedRequestCount: 0, createdAt: Date.now(), view: null };
  state.tabs.set(tab.id, tab); await activateTab(state, tab.id); return publicTab(tab);
}
async function openUrlInProfile(state, url) { return createTab(state, { url }); }
function parkTab(state, tabId) { const tab = state.tabs.get(tabId); if (!tab) return false; if (state.activeTabId === tabId) detachViewFromWindow(state, tab); destroyTabView(tab); if (state.activeTabId === tabId) state.activeTabId = null; sendTabState(state, { parkedTabId: tabId }); saveDesktopStateSoon(); return true; }

async function closeTab(state, tabId) {
  const tab = state.tabs.get(tabId); if (!tab) return false;
  const keys = [...state.tabs.keys()]; const index = keys.indexOf(tabId); detachViewFromWindow(state, tab); destroyTabView(tab); state.tabs.delete(tabId);
  if (tab.temporary) {
    const stillOpen = [...windows.values()].some((windowState) => [...windowState.tabs.values()].some((candidate) => candidate.compartmentId === tab.compartmentId));
    if (!stillOpen) {
      const site = compartments.get(tab.compartmentId); const partition = site && partitionForCompartment(site);
      if (partition) { const tempSession = session.fromPartition(partition); await Promise.allSettled([tempSession.clearStorageData(), tempSession.clearCache()]); configuredPartitions.delete(partition); partitionCompartmentIds.delete(partition); }
      compartments.delete(tab.compartmentId);
    }
  }
  if (state.activeTabId === tabId) { state.activeTabId = null; const replacement = keys[index + 1] || keys[index - 1]; if (replacement && state.tabs.has(replacement)) await activateTab(state, replacement); else sendTabState(state); } else sendTabState(state);
  saveDesktopStateSoon(); return true;
}

function showDashboard(state) { const active = state.tabs.get(state.activeTabId); if (active) { detachViewFromWindow(state, active); if (compartmentForTab(active)?.parkWhenInactive && !active.keepActive) destroyTabView(active); } state.activeTabId = null; sendTabState(state, { dashboard: true }); saveDesktopStateSoon(); }
async function detachTabToNewWindow(state, tabId) { const tab = state.tabs.get(tabId); if (!tab) return false; detachViewFromWindow(state, tab); state.tabs.delete(tabId); if (state.activeTabId === tabId) state.activeTabId = null; sendTabState(state); const target = createBrowserWindow(null, state.profileId); target.tabs.set(tab.id, { ...tab, windowId: target.id }); target.activeTabId = tab.id; target.browserWindow.webContents.once('did-finish-load', () => activateTab(target, tab.id).catch(console.error)); saveDesktopStateSoon(); return true; }
function releaseInactiveTabs(state) { let count = 0; for (const tab of state.tabs.values()) if (tab.id !== state.activeTabId && !tab.keepActive && tab.view) { detachViewFromWindow(state, tab); destroyTabView(tab); count++; } sendTabState(state, { releasedCount: count }); saveDesktopStateSoon(); return count; }
function activeTab(state) { return state.tabs.get(state.activeTabId) || null; }
function activeContents(state) { return activeTab(state)?.view?.webContents || null; }

function activePrivacyState(state) {
  const tab = activeTab(state); const site = compartmentForTab(tab); const profile = profileForWindow(state);
  if (!tab || !site || !profile) return null;
  const family = profile.authorizedFamilies.find((entry) => entry.compartmentId === site.id);
  return {
    profile: clone(profile), compartment: clone(site), protectionLevel: site.protectionLevel,
    blockedRequestCount: Number(tab.blockedRequestCount) || 0, authorizedFamily: family?.providerId || site.familyId || null,
    compatibilityLevel: site.compatibilityLevel, temporaryAllowances: allowancesForCompartment(site).filter((allowance) => allowance.temporary),
    pinnedAllowances: allowancesForCompartment(site).filter((allowance) => allowance.pinned)
  };
}

ipcMain.handle('profiles:list', () => [...profiles.values()].map(clone));
ipcMain.handle('profiles:create', (_event, input = {}) => { const profile = normalizeProfile({ ...input, id: input.id || id('profile') }); profiles.set(profile.id, profile); saveDesktopStateSoon(); return clone(profile); });
ipcMain.handle('profiles:update', (_event, profileId, changes = {}) => { const current = profiles.get(profileId); if (!current) return null; const updated = normalizeProfile({ ...current, ...changes, id: current.id, createdAt: current.createdAt }); profiles.set(updated.id, updated); saveDesktopStateSoon(); return clone(updated); });
ipcMain.handle('profiles:authorize-family', (_event, profileId, providerId) => {
  const profile = profiles.get(profileId); if (!profile || providerId !== 'google') return null;
  let site = [...compartments.values()].find((candidate) => candidate.profileId === profileId && candidate.familyId === providerId);
  if (!site) { site = normalizeCompartment({ id: id('site'), profileId, key: `family:${providerId}`, familyId: providerId, name: 'Google', primaryUrl: 'https://accounts.google.com/' }); compartments.set(site.id, site); }
  profile.authorizedFamilies = [...profile.authorizedFamilies.filter((entry) => entry.providerId !== providerId), { providerId, compartmentId: site.id }]; profile.updatedAt = Date.now(); saveDesktopStateSoon(); return { profile: clone(profile), compartment: clone(site) };
});
ipcMain.handle('profiles:remove', async (_event, profileId) => {
  const profile = profiles.get(profileId); if (!profile) return false;
  for (const state of [...windows.values()]) if (state.profileId === profileId) state.browserWindow.close();
  for (const partition of partitionKeysForProfile(profileId, [...compartments.values()])) { const scopedSession = session.fromPartition(partition); await Promise.allSettled([scopedSession.clearStorageData(), scopedSession.clearCache()]); configuredPartitions.delete(partition); partitionCompartmentIds.delete(partition); }
  for (const [siteId, site] of compartments) if (site.profileId === profileId) compartments.delete(siteId);
  for (const [allowanceId, allowance] of compatibilityAllowances) if (allowance.profileId === profileId) compatibilityAllowances.delete(allowanceId);
  profiles.delete(profileId); saveDesktopStateSoon(); return true;
});
ipcMain.handle('compartments:list', (_event, profileId) => [...compartments.values()].filter((site) => !profileId || site.profileId === profileId).map(clone));
ipcMain.handle('compartments:clear', async (_event, profileId, compartmentId) => { const site = compartments.get(compartmentId); if (!site || site.profileId !== profileId) return false; const scopedSession = session.fromPartition(partitionForCompartment(site)); await Promise.all([scopedSession.clearStorageData(), scopedSession.clearCache()]); return true; });
ipcMain.handle('profiles:route-url', (event, input) => { const state = findWindowByWebContents(event.sender); const url = validatedWebUrl(input); if (!state || !url) return { action: 'invalid' }; const route = resolveCompartment({ profile: profileForWindow(state), compartments: [...compartments.values()], url }); if (route.action === 'open') return { action: 'open', compartmentId: route.compartment.id, containerId: route.compartment.id, url }; if (route.action === 'choose') return { action: 'choose', url, matches: route.compartments.map((site) => ({ id: site.id, name: site.name, primaryUrl: site.primaryUrl })) }; return { action: 'create', url }; });
ipcMain.handle('privacy:get-active', (event) => activePrivacyState(findWindowByWebContents(event.sender)));
ipcMain.handle('compartments:set-permission', (_event, profileId, compartmentId, permission, allowed) => { const site = compartments.get(compartmentId); if (!site || site.profileId !== profileId || !Object.hasOwn(site.permissions, permission)) return null; site.permissions[permission] = Boolean(allowed); site.protectionLevel = 'custom'; site.updatedAt = Date.now(); saveDesktopStateSoon(); return clone(site); });
ipcMain.handle('compatibility:set-level', (_event, profileId, compartmentId, level) => { const site = compartments.get(compartmentId); if (!site || site.profileId !== profileId) return null; site.compatibilityLevel = Math.max(0, Math.min(3, Number(level) || 0)); site.updatedAt = Date.now(); saveDesktopStateSoon(); return clone(site); });
ipcMain.handle('compatibility:add', (_event, input) => { const allowance = normalizeAllowance({ ...input, temporary: input?.pinned ? false : true }); if (!allowance || !compartments.has(allowance.compartmentId) || compartments.get(allowance.compartmentId).profileId !== allowance.profileId) return null; compatibilityAllowances.set(allowance.id, allowance); return clone(allowance); });
ipcMain.handle('compatibility:pin', (_event, profileId, compartmentId, allowanceId) => { const current = compatibilityAllowances.get(allowanceId); if (!current || current.profileId !== profileId || current.compartmentId !== compartmentId) return null; const pinned = normalizeAllowance({ ...current, temporary: false, pinned: true, updatedAt: Date.now() }); compatibilityAllowances.set(pinned.id, pinned); saveDesktopStateSoon(); return clone(pinned); });
ipcMain.handle('compatibility:remove', (_event, profileId, compartmentId, allowanceId) => { const current = compatibilityAllowances.get(allowanceId); if (!current || current.profileId !== profileId || current.compartmentId !== compartmentId) return false; compatibilityAllowances.delete(allowanceId); saveDesktopStateSoon(); return true; });

// Compatibility aliases keep the 0.4 shell usable during the hierarchical UI transition.
ipcMain.handle('containers:list', () => [...compartments.values()].map(clone));
ipcMain.handle('containers:create', (event, input = {}) => { const state = findWindowByWebContents(event.sender) || [...windows.values()][0]; if (!state) return null; const site = ensureCompartment(state, input.primaryUrl || input.url || '', input); return clone(site); });
ipcMain.handle('containers:update', (_event, siteId, changes = {}) => { const current = compartments.get(siteId); if (!current) return null; const updated = normalizeCompartment({ ...current, ...changes, id: current.id, profileId: current.profileId, partitionKey: current.partitionKey }); compartments.set(updated.id, updated); saveDesktopStateSoon(); return clone(updated); });
ipcMain.handle('containers:remove', async (_event, siteId) => { const site = compartments.get(siteId); if (!site) return false; const inUse = [...windows.values()].some((state) => [...state.tabs.values()].some((tab) => tab.compartmentId === siteId)); if (inUse) return false; const scopedSession = session.fromPartition(partitionForCompartment(site)); await Promise.allSettled([scopedSession.clearStorageData(), scopedSession.clearCache()]); compartments.delete(siteId); saveDesktopStateSoon(); return true; });
ipcMain.handle('containers:clear', async (_event, siteId) => { const site = compartments.get(siteId); if (!site) return false; const scopedSession = session.fromPartition(partitionForCompartment(site)); await Promise.all([scopedSession.clearStorageData(), scopedSession.clearCache()]); return true; });
ipcMain.handle('containers:route-url', (event, input) => ipcMain.emit ? (() => { const state = findWindowByWebContents(event.sender); const url = validatedWebUrl(input); if (!state || !url) return { action: 'invalid' }; const route = resolveCompartment({ profile: profileForWindow(state), compartments: [...compartments.values()], url }); if (route.compartment) return { action: 'open', containerId: route.compartment.id, compartmentId: route.compartment.id, url }; return { action: route.action === 'choose' ? 'choose' : 'unmatched', url, matches: (route.compartments || []).map((site) => ({ id: site.id, name: site.name, primaryUrl: site.primaryUrl })) }; })() : null);
ipcMain.handle('containers:get-active', (event) => activePrivacyState(findWindowByWebContents(event.sender))?.compartment || null);
ipcMain.handle('containers:set-permission', (_event, siteId, permission, allowed) => { const site = compartments.get(siteId); if (!site || !Object.hasOwn(site.permissions, permission)) return null; site.permissions[permission] = Boolean(allowed); site.protectionLevel = 'custom'; saveDesktopStateSoon(); return clone(site); });
ipcMain.handle('containers:apply-preset', (_event, siteId, preset) => { const site = compartments.get(siteId); if (!site) return null; site.compatibilityLevel = preset === 'compatibility' ? 3 : preset === 'balanced' ? 1 : 0; site.protectionLevel = preset === 'custom' ? 'custom' : 'hardened'; saveDesktopStateSoon(); return clone(site); });

ipcMain.handle('tabs:list', (event) => { const state = findWindowByWebContents(event.sender); return state ? { windowId: state.id, profileId: state.profileId, activeTabId: state.activeTabId, tabs: [...state.tabs.values()].map(publicTab) } : { tabs: [], activeTabId: null }; });
ipcMain.handle('tabs:open', (event, request) => { const state = findWindowByWebContents(event.sender); if (!state) throw new Error('Browser window not found.'); return createTab(state, request); });
ipcMain.handle('tabs:activate', (event, tabId) => { const state = findWindowByWebContents(event.sender); return state ? activateTab(state, tabId) : false; });
ipcMain.handle('tabs:close', (event, tabId) => { const state = findWindowByWebContents(event.sender); return state ? closeTab(state, tabId) : false; });
ipcMain.handle('tabs:keep-active', (event, tabId, keepActive) => { const state = findWindowByWebContents(event.sender); const tab = state?.tabs.get(tabId); if (!tab) return false; tab.keepActive = Boolean(keepActive); if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.setBackgroundThrottling(!tab.keepActive && state.activeTabId !== tab.id); sendTabState(state); saveDesktopStateSoon(); return true; });
ipcMain.handle('tabs:park', (event, tabId) => { const state = findWindowByWebContents(event.sender); return state ? parkTab(state, tabId) : false; });
ipcMain.handle('tabs:release-inactive', (event) => { const state = findWindowByWebContents(event.sender); return state ? releaseInactiveTabs(state) : 0; });
ipcMain.handle('tabs:set-preset', (event, tabId, preset) => { const state = findWindowByWebContents(event.sender); const site = compartmentForTab(state?.tabs.get(tabId)); if (!site) return false; site.compatibilityLevel = preset === 'compatibility' ? 3 : preset === 'balanced' ? 1 : 0; site.protectionLevel = preset === 'custom' ? 'custom' : 'hardened'; sendTabState(state); saveDesktopStateSoon(); return true; });
ipcMain.handle('tabs:detach', (event, tabId) => { const state = findWindowByWebContents(event.sender); return state ? detachTabToNewWindow(state, tabId) : false; });
ipcMain.handle('window:new', (event, profileId) => { const source = findWindowByWebContents(event.sender); return createBrowserWindow(null, profileId || source?.profileId).id; });
ipcMain.handle('browser:dashboard', (event) => { const state = findWindowByWebContents(event.sender); if (!state) return false; showDashboard(state); return true; });
ipcMain.handle('browser:set-chrome-height', (event, requestedHeight) => { const state = findWindowByWebContents(event.sender); if (!state) return false; state.chromeHeight = Math.max(108, Math.min(600, Number(requestedHeight) || 108)); layoutActiveView(state); return true; });
ipcMain.handle('browser:navigate', async (event, input) => { const state = findWindowByWebContents(event.sender); const tab = state && activeTab(state); const url = validatedWebUrl(input); if (!tab || !url) return false; const resolved = resolveCompartment({ profile: profileForWindow(state), compartments: [...compartments.values()], url }); if (resolved.compartment?.id !== tab.compartmentId || resolved.action === 'create') return switchTabCompartment(state, tab, url); const contents = activeContents(state); await contents.loadURL(compartmentForTab(tab)?.privacy?.clearUrls ? stripTracking(url) : url); return true; });
ipcMain.handle('browser:toggle-desktop', (event) => { const state = findWindowByWebContents(event.sender); const tab = state && activeTab(state); const contents = state && activeContents(state); const site = compartmentForTab(tab); if (!site || !contents) return false; const desktop = !(site.renderMode === 'desktop' || site.uaPreset === 'desktop'); site.renderMode = desktop ? 'desktop' : 'mobile'; site.uaPreset = desktop ? 'desktop' : 'mobile'; site.updatedAt = Date.now(); contents.setUserAgent(desktop ? DESKTOP_UA : MOBILE_UA); contents.reload(); sendTabState(state); saveDesktopStateSoon(); return desktop; });
ipcMain.on('browser:command', (event, command) => { const contents = activeContents(findWindowByWebContents(event.sender)); if (!contents) return; const nav = contents.navigationHistory; if (command === 'back' && nav.canGoBack()) nav.goBack(); else if (command === 'forward' && nav.canGoForward()) nav.goForward(); else if (command === 'reload') contents.reload(); else if (command === 'devtools') contents.openDevTools({ mode: 'detach' }); });
ipcMain.handle('app:quit-and-release', () => { compatibilityAllowances.clear(); saveDesktopState(); shuttingDown = true; app.quit(); return true; });
ipcMain.handle('app:metrics', () => app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type, cpu: metric.cpu?.percentCPUUsage || 0, memoryKB: metric.memory?.workingSetSize || 0 })));

app.whenReady().then(() => {
  const restored = loadBrowserState({ browserStatePath: browserStatePath(), v2StatePath: v2StatePath(), legacyStatePath: legacyStatePath(), backupDirectory: path.join(app.getPath('userData'), 'migration-backups') });
  app.browserStateMigration = restored.migration;
  restored.profiles.forEach((profile) => profiles.set(profile.id, profile));
  restored.compartments.forEach((site) => compartments.set(site.id, site));
  restored.compatibilityAllowances.forEach((allowance) => compatibilityAllowances.set(allowance.id, allowance));
  if (restored.windows.length) restored.windows.forEach((windowState) => createBrowserWindow(windowState)); else createBrowserWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createBrowserWindow(); });
});
app.on('before-quit', () => { compatibilityAllowances.clear(); saveDesktopState(); shuttingDown = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
