'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeContainer } = require('./container-model');

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
}

function emptyBrowserState() {
  return { version: 2, containers: [], windows: [] };
}

function legacyProfileToContainer(saved, containerId, partitionKey) {
  const profile = saved.profile || {};
  return normalizeContainer({
    ...profile,
    id: containerId,
    name: profile.name,
    primaryUrl: profile.primaryUrl || profile.url || saved.url || '',
    partitionKey,
    temporary: false,
    createdAt: profile.createdAt || saved.createdAt || 1,
    updatedAt: profile.updatedAt || saved.createdAt || 1
  });
}

function migrateLegacyDesktopState(legacyWindows) {
  const containersById = new Map();
  const windows = [];

  for (const legacyWindow of Array.isArray(legacyWindows) ? legacyWindows : []) {
    const tabs = [];
    for (const saved of Array.isArray(legacyWindow.tabs) ? legacyWindow.tabs : []) {
      const tabId = safeId(saved.id) || `tab-${tabs.length + 1}`;
      const requestedContainerId = saved.profile?.id || `legacy-${tabId}`;
      const containerId = safeId(requestedContainerId) || `legacy-${tabId}`;
      if (!containersById.has(containerId)) {
        containersById.set(
          containerId,
          legacyProfileToContainer(saved, containerId, `persist:silentp-tab-${tabId}`)
        );
      }
      tabs.push({
        id: tabId,
        containerId,
        title: saved.title || saved.profile?.name || 'Restored tab',
        url: saved.url || saved.profile?.url || '',
        keepActive: Boolean(saved.keepActive),
        parked: Boolean(saved.parked),
        temporary: false,
        createdAt: Number(saved.createdAt) || 1
      });
    }
    const windowRecord = {
      id: legacyWindow.id,
      activeTabId: legacyWindow.activeTabId,
      tabs
    };
    if (legacyWindow.bounds) windowRecord.bounds = legacyWindow.bounds;
    windows.push(windowRecord);
  }

  return {
    version: 2,
    containers: [...containersById.values()],
    windows
  };
}

function normalizeBrowserState(value) {
  if (!value || value.version !== 2) return emptyBrowserState();
  return {
    version: 2,
    containers: (Array.isArray(value.containers) ? value.containers : []).map(normalizeContainer),
    windows: Array.isArray(value.windows) ? value.windows : []
  };
}

function serializableBrowserState(value) {
  const normalized = normalizeBrowserState(value);
  const persistentContainers = normalized.containers.filter((container) => !container.temporary);
  const persistentIds = new Set(persistentContainers.map((container) => container.id));
  const windows = normalized.windows.map((windowRecord) => {
    const tabs = (Array.isArray(windowRecord.tabs) ? windowRecord.tabs : [])
      .filter((tab) => !tab.temporary && persistentIds.has(tab.containerId));
    const activeTabId = tabs.some((tab) => tab.id === windowRecord.activeTabId)
      ? windowRecord.activeTabId
      : tabs[0]?.id || null;
    return { ...windowRecord, activeTabId, tabs };
  });
  return { version: 2, containers: persistentContainers, windows };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadBrowserState({ browserStatePath, legacyStatePath }) {
  const current = readJson(browserStatePath);
  if (current?.version === 2) return normalizeBrowserState(current);

  const legacy = readJson(legacyStatePath);
  if (Array.isArray(legacy?.windows)) return migrateLegacyDesktopState(legacy.windows);
  return emptyBrowserState();
}

function saveBrowserState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(serializableBrowserState(state), null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  emptyBrowserState,
  serializableBrowserState,
  migrateLegacyDesktopState,
  loadBrowserState,
  saveBrowserState
};
