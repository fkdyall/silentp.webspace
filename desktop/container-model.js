'use strict';

const crypto = require('crypto');

const DEFAULT_PRIVACY = Object.freeze({
  clearUrls: true,
  blocking: true,
  gpc: true,
  webrtc: true,
  thirdPartyCookies: false
});

const DEFAULT_PERMISSIONS = Object.freeze({
  camera: false,
  microphone: false,
  location: false,
  notifications: false,
  clipboard: false,
  downloads: true,
  uploads: true,
  popups: false
});

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
}

function normalizedHost(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function defaultDomainRules(primaryUrl) {
  const host = normalizedHost(primaryUrl);
  if (!host) return [];
  if (host === 'gmail.com') {
    return [
      { type: 'exact', value: 'gmail.com' },
      { type: 'suffix', value: 'google.com' }
    ];
  }
  if (host === 'google.com' || host.endsWith('.google.com')) {
    return [{ type: 'suffix', value: 'google.com' }];
  }
  return [{ type: 'exact', value: host }];
}

function normalizeRule(rule) {
  const type = rule?.type === 'suffix' ? 'suffix' : 'exact';
  const value = String(rule?.value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return value ? { type, value } : null;
}

function normalizeContainer(input = {}) {
  const now = Date.now();
  const id = safeId(input.id) || `container_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const primaryUrl = String(input.primaryUrl || input.url || '');
  const suppliedRules = Array.isArray(input.domainRules) ? input.domainRules : null;
  const domainRules = (suppliedRules || defaultDomainRules(primaryUrl))
    .map(normalizeRule)
    .filter(Boolean);

  return {
    id,
    name: String(input.name || normalizedHost(primaryUrl) || 'New container'),
    primaryUrl,
    domainRules,
    partitionKey: input.partitionKey ? String(input.partitionKey) : '',
    privacyPreset: String(input.privacyPreset || 'hardened'),
    privacy: { ...DEFAULT_PRIVACY, ...(input.privacy || {}) },
    permissions: { ...DEFAULT_PERMISSIONS, ...(input.permissions || {}) },
    temporary: Boolean(input.temporary),
    keepActive: Boolean(input.keepActive),
    color: String(input.color || '#68e1c5'),
    renderMode: String(input.renderMode || 'desktop'),
    uaPreset: String(input.uaPreset || 'desktop'),
    language: String(input.language || 'en-US'),
    externalLinkBehavior: String(input.externalLinkBehavior || 'internal'),
    parkWhenInactive: Boolean(input.parkWhenInactive),
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now
  };
}

function partitionForContainer(container) {
  const normalized = normalizeContainer(container);
  if (normalized.partitionKey) return normalized.partitionKey;
  const key = safeId(normalized.id);
  return normalized.temporary ? `fypm-temp-${key}` : `persist:fypm-container-${key}`;
}

function hostMatchesRule(host, rule) {
  if (rule.type === 'exact') return host === rule.value;
  if (rule.type === 'suffix') return host === rule.value || host.endsWith(`.${rule.value}`);
  return false;
}

function matchingContainers(containers, url) {
  const host = normalizedHost(url);
  if (!host) return [];
  return containers
    .map((container) => normalizeContainer(container))
    .filter((container) => !container.temporary)
    .filter((container) => container.domainRules.some((rule) => hostMatchesRule(host, rule)));
}

function applyPreset(container, preset) {
  const next = normalizeContainer(container);
  next.privacyPreset = preset;
  if (preset === 'hardened') {
    Object.assign(next.privacy, DEFAULT_PRIVACY);
    Object.assign(next.permissions, {
      popups: false,
      notifications: false,
      camera: false,
      microphone: false,
      location: false,
      clipboard: false
    });
  } else if (preset === 'balanced') {
    Object.assign(next.privacy, DEFAULT_PRIVACY);
    next.permissions.popups = true;
  } else if (preset === 'compatibility') {
    Object.assign(next.privacy, {
      clearUrls: true,
      blocking: false,
      gpc: true,
      webrtc: false,
      thirdPartyCookies: true
    });
    next.permissions.popups = true;
  }
  next.updatedAt = Date.now();
  return next;
}

function setContainerPermission(container, permission, allowed) {
  const next = normalizeContainer(container);
  if (!Object.hasOwn(DEFAULT_PERMISSIONS, permission)) return next;
  next.permissions[permission] = Boolean(allowed);
  next.privacyPreset = 'custom';
  next.updatedAt = Date.now();
  return next;
}

module.exports = {
  DEFAULT_PERMISSIONS,
  DEFAULT_PRIVACY,
  normalizeContainer,
  partitionForContainer,
  matchingContainers,
  applyPreset,
  setContainerPermission,
  hostMatchesRule
};
