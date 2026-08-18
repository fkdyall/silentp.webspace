'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeProfile, normalizeCompartment, siteKeyForUrl, PROVIDERS } = require('./profile-model');
const { normalizeAllowance, serializableAllowances } = require('./privacy-policy');

const MIGRATION_ID = 'hierarchical-profile-isolation-v1';

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
}

function deterministicId(prefix, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 20);
  return `${prefix}_${digest}`;
}

function emptyBrowserState() {
  return { version: 3, migration: null, profiles: [], compartments: [], windows: [], compatibilityAllowances: [] };
}

function legacyUserDataPath(appDataPath) {
  return path.join(appDataPath, 'Silent P. PWSA');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function hostForUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isGoogleProductHost(host) {
  return PROVIDERS.google.productHosts.includes(host);
}

function compartmentIdentity(profileId, url, googleAuthorized) {
  const host = hostForUrl(url);
  if (googleAuthorized && isGoogleProductHost(host)) return { key: 'family:google', familyId: 'google' };
  return { key: siteKeyForUrl(url) || `site:invalid-${deterministicId('host', url)}`, familyId: null };
}

function v2ContainerToProfile(container) {
  const profileId = safeId(container.id) || deterministicId('profile', container.name, container.primaryUrl);
  const googleAuthorized = isGoogleProductHost(hostForUrl(container.primaryUrl));
  const primaryIdentity = compartmentIdentity(profileId, container.primaryUrl, googleAuthorized);
  const primaryCompartmentId = deterministicId('site', profileId, primaryIdentity.key);
  const profile = normalizeProfile({
    id: profileId,
    name: container.name,
    color: container.color,
    authorizedFamilies: googleAuthorized ? [{ providerId: 'google', compartmentId: primaryCompartmentId }] : [],
    createdAt: container.createdAt,
    updatedAt: container.updatedAt
  });
  const primary = normalizeCompartment({
    ...container,
    id: primaryCompartmentId,
    profileId,
    key: primaryIdentity.key,
    familyId: primaryIdentity.familyId,
    name: primaryIdentity.familyId ? 'Google' : container.name,
    siteRules: primaryIdentity.familyId ? [] : container.domainRules,
    partitionKey: container.partitionKey,
    protectionLevel: container.privacyPreset === 'custom' ? 'custom' : 'hardened',
    compatibilityLevel: container.privacyPreset === 'compatibility' ? 3 : container.privacyPreset === 'balanced' ? 1 : 0,
    temporary: false,
    persistent: true
  });
  return { profile, primary, googleAuthorized };
}

function migrateV2State(v2, options = {}) {
  const result = emptyBrowserState();
  const containerRecords = new Map();
  const compartmentByProfileKey = new Map();

  for (const oldContainer of Array.isArray(v2?.containers) ? v2.containers : []) {
    if (oldContainer.temporary) continue;
    const record = v2ContainerToProfile(oldContainer);
    containerRecords.set(oldContainer.id, record);
    result.profiles.push(record.profile);
    result.compartments.push(record.primary);
    compartmentByProfileKey.set(`${record.profile.id}\0${record.primary.key}`, record.primary);
  }

  for (const oldWindow of Array.isArray(v2?.windows) ? v2.windows : []) {
    const tabsByProfile = new Map();
    for (const oldTab of Array.isArray(oldWindow.tabs) ? oldWindow.tabs : []) {
      if (oldTab.temporary) continue;
      const record = containerRecords.get(oldTab.containerId);
      if (!record) continue;
      const url = oldTab.url || record.primary.primaryUrl;
      const identity = compartmentIdentity(record.profile.id, url, record.googleAuthorized);
      const mapKey = `${record.profile.id}\0${identity.key}`;
      let compartment = compartmentByProfileKey.get(mapKey);
      if (!compartment) {
        compartment = normalizeCompartment({
          ...record.primary,
          id: deterministicId('site', record.profile.id, identity.key),
          profileId: record.profile.id,
          key: identity.key,
          familyId: identity.familyId,
          name: hostForUrl(url) || 'Migrated site',
          primaryUrl: url,
          siteRules: identity.familyId ? [] : [{ type: 'exact', value: hostForUrl(url) }],
          partitionKey: '',
          temporary: false,
          persistent: true
        });
        result.compartments.push(compartment);
        compartmentByProfileKey.set(mapKey, compartment);
      }
      if (!tabsByProfile.has(record.profile.id)) tabsByProfile.set(record.profile.id, []);
      tabsByProfile.get(record.profile.id).push({
        id: safeId(oldTab.id) || deterministicId('tab', oldWindow.id, url),
        compartmentId: compartment.id,
        title: oldTab.title || compartment.name,
        url,
        keepActive: Boolean(oldTab.keepActive),
        parked: Boolean(oldTab.parked),
        temporary: false,
        createdAt: Number(oldTab.createdAt) || 1
      });
    }
    for (const [profileId, tabs] of tabsByProfile) {
      const activeTabId = tabs.some((tab) => tab.id === oldWindow.activeTabId) ? oldWindow.activeTabId : tabs[0]?.id || null;
      const suffix = tabsByProfile.size === 1 ? '' : `--${profileId}`;
      result.windows.push({
        id: `${oldWindow.id || deterministicId('win', profileId)}${suffix}`,
        profileId,
        ...(oldWindow.bounds ? { bounds: oldWindow.bounds } : {}),
        activeTabId,
        tabs
      });
    }
  }

  result.migration = {
    sourceVersion: 2,
    migrationId: MIGRATION_ID,
    completedAt: Number(options.completedAt) || Date.now(),
    metadataBackupPath: String(options.metadataBackupPath || '')
  };
  return normalizeBrowserState(result);
}

function migrateLegacyDesktopState(legacyWindows) {
  const containers = new Map();
  const windows = [];
  for (const oldWindow of Array.isArray(legacyWindows) ? legacyWindows : []) {
    const tabs = [];
    for (const saved of Array.isArray(oldWindow.tabs) ? oldWindow.tabs : []) {
      const tabId = safeId(saved.id) || deterministicId('tab', saved.url);
      const containerId = safeId(saved.profile?.id) || `legacy-${tabId}`;
      if (!containers.has(containerId)) {
        containers.set(containerId, {
          ...(saved.profile || {}), id: containerId,
          name: saved.profile?.name || 'Migrated profile',
          primaryUrl: saved.profile?.primaryUrl || saved.profile?.url || saved.url || '',
          partitionKey: `persist:silentp-tab-${tabId}`,
          temporary: false
        });
      }
      tabs.push({ ...saved, id: tabId, containerId, temporary: false });
    }
    windows.push({ ...oldWindow, tabs });
  }
  return { version: 2, containers: [...containers.values()], windows };
}

function normalizeBrowserState(value) {
  if (!value || value.version !== 3) return emptyBrowserState();
  return {
    version: 3,
    migration: value.migration || null,
    profiles: (Array.isArray(value.profiles) ? value.profiles : []).map(normalizeProfile),
    compartments: (Array.isArray(value.compartments) ? value.compartments : []).map(normalizeCompartment),
    windows: Array.isArray(value.windows) ? value.windows : [],
    compatibilityAllowances: (Array.isArray(value.compatibilityAllowances) ? value.compatibilityAllowances : [])
      .map(normalizeAllowance).filter(Boolean)
  };
}

function serializableBrowserState(value) {
  const normalized = normalizeBrowserState(value);
  const profiles = normalized.profiles;
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const compartments = normalized.compartments.filter((site) => site.persistent && !site.temporary && profileIds.has(site.profileId));
  const byId = new Map(compartments.map((site) => [site.id, site]));
  const windows = normalized.windows.map((windowRecord) => {
    if (!profileIds.has(windowRecord.profileId)) return null;
    const tabs = (Array.isArray(windowRecord.tabs) ? windowRecord.tabs : []).filter((tab) => {
      const site = byId.get(tab.compartmentId);
      return !tab.temporary && site?.profileId === windowRecord.profileId;
    });
    if (!tabs.length) return null;
    return {
      ...windowRecord,
      activeTabId: tabs.some((tab) => tab.id === windowRecord.activeTabId) ? windowRecord.activeTabId : tabs[0].id,
      tabs
    };
  }).filter(Boolean);
  return {
    version: 3,
    migration: normalized.migration,
    profiles,
    compartments,
    windows,
    compatibilityAllowances: serializableAllowances(normalized.compatibilityAllowances)
  };
}

function saveBrowserState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(serializableBrowserState(state), null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function writeMigrationBackup(backupDirectory, sourceState) {
  const canonical = JSON.stringify(sourceState);
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `browser-state-v2-pre-hierarchical-${digest.slice(0, 12)}.json`);
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify({ sourceVersion: 2, sha256: digest, state: sourceState }, null, 2), { encoding: 'utf8', flag: 'wx' });
  }
  return backupPath;
}

function loadBrowserState(options) {
  const current = readJson(options.browserStatePath);
  if (current?.version === 3) return normalizeBrowserState(current);
  let source = readJson(options.v2StatePath);
  if (source?.version !== 2 && current?.version === 2) source = current;
  if (source?.version !== 2) {
    const legacy = readJson(options.legacyStatePath);
    if (Array.isArray(legacy?.windows)) source = migrateLegacyDesktopState(legacy.windows);
  }
  if (source?.version !== 2) return emptyBrowserState();
  const backupDirectory = options.backupDirectory || path.join(path.dirname(options.browserStatePath), 'migration-backups');
  const metadataBackupPath = writeMigrationBackup(backupDirectory, source);
  const migrated = migrateV2State(source, {
    completedAt: typeof options.now === 'function' ? options.now() : Date.now(),
    metadataBackupPath
  });
  saveBrowserState(options.browserStatePath, migrated);
  return migrated;
}

module.exports = {
  MIGRATION_ID,
  emptyBrowserState,
  legacyUserDataPath,
  migrateLegacyDesktopState,
  migrateV2State,
  normalizeBrowserState,
  serializableBrowserState,
  loadBrowserState,
  saveBrowserState
};
