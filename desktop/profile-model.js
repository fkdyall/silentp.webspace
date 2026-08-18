'use strict';

const crypto = require('crypto');
const { DEFAULT_PERMISSIONS, DEFAULT_PRIVACY } = require('./container-model');

const PROVIDERS = Object.freeze({
  google: Object.freeze({
    productHosts: Object.freeze([
      'accounts.google.com',
      'mail.google.com',
      'drive.google.com',
      'docs.google.com',
      'gmail.com'
    ]),
    authHosts: Object.freeze(['accounts.google.com', 'oauth2.googleapis.com'])
  })
});

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
}

function hostForUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function siteKeyForUrl(value) {
  const host = hostForUrl(value);
  return host ? `site:${host}` : '';
}

function normalizeFamily(value) {
  const providerId = String(value?.providerId || '').toLowerCase();
  const compartmentId = safeId(value?.compartmentId);
  return PROVIDERS[providerId] && compartmentId ? { providerId, compartmentId } : null;
}

function normalizeProfile(input = {}) {
  const now = Date.now();
  const id = safeId(input.id) || `profile_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  return {
    id,
    name: String(input.name || 'New profile'),
    color: String(input.color || '#68e1c5'),
    authorizedFamilies: (Array.isArray(input.authorizedFamilies) ? input.authorizedFamilies : [])
      .map(normalizeFamily)
      .filter(Boolean),
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now
  };
}

function normalizeRule(rule) {
  const type = rule?.type === 'suffix' ? 'suffix' : 'exact';
  const value = String(rule?.value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return value ? { type, value } : null;
}

function derivedPartition(profileId, key) {
  const digest = crypto.createHash('sha256').update(`${profileId}\0${key}`).digest('hex').slice(0, 32);
  return `persist:fypm-v3-${digest}`;
}

function normalizeCompartment(input = {}) {
  const now = Date.now();
  const profileId = safeId(input.profileId);
  const primaryUrl = String(input.primaryUrl || input.url || '');
  const key = String(input.key || siteKeyForUrl(primaryUrl));
  const id = safeId(input.id) || `site_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const familyId = PROVIDERS[input.familyId] ? String(input.familyId) : null;
  const defaultHost = hostForUrl(primaryUrl);
  const suppliedRules = Array.isArray(input.siteRules) ? input.siteRules : [];
  const siteRules = suppliedRules.map(normalizeRule).filter(Boolean);
  if (!siteRules.length && defaultHost && !familyId) siteRules.push({ type: 'exact', value: defaultHost });
  const temporary = Boolean(input.temporary);
  const partitionKey = input.partitionKey
    ? String(input.partitionKey)
    : temporary
      ? `fypm-temp-v3-${id}`
      : derivedPartition(profileId, key);

  return {
    id,
    profileId,
    key,
    name: String(input.name || defaultHost || 'New site'),
    primaryUrl,
    siteRules,
    familyId,
    partitionKey,
    protectionLevel: input.protectionLevel === 'custom' ? 'custom' : 'hardened',
    compatibilityLevel: Math.max(0, Math.min(3, Number(input.compatibilityLevel) || 0)),
    permissions: { ...DEFAULT_PERMISSIONS, ...(input.permissions || {}) },
    privacy: { ...DEFAULT_PRIVACY, ...(input.privacy || {}) },
    persistent: input.persistent !== false && !temporary,
    temporary,
    keepActive: Boolean(input.keepActive),
    renderMode: String(input.renderMode || 'desktop'),
    uaPreset: String(input.uaPreset || 'desktop'),
    language: String(input.language || 'en-US'),
    externalLinkBehavior: String(input.externalLinkBehavior || 'internal'),
    parkWhenInactive: Boolean(input.parkWhenInactive),
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now
  };
}

function partitionForCompartment(compartment) {
  return normalizeCompartment(compartment).partitionKey;
}

function hostMatchesRule(host, rule) {
  return rule.type === 'suffix'
    ? host === rule.value || host.endsWith(`.${rule.value}`)
    : host === rule.value;
}

function familyForProductHost(host) {
  return Object.entries(PROVIDERS).find(([, provider]) => provider.productHosts.includes(host))?.[0] || null;
}

function authorizedFamily(profile, providerId) {
  return normalizeProfile(profile).authorizedFamilies.find((family) => family.providerId === providerId) || null;
}

function resolveCompartment({ profile, compartments = [], url }) {
  const normalizedProfile = normalizeProfile(profile);
  const host = hostForUrl(url);
  if (!host) return { action: 'invalid' };
  const owned = compartments.map(normalizeCompartment)
    .filter((compartment) => compartment.profileId === normalizedProfile.id);
  const providerId = familyForProductHost(host);
  const family = providerId && authorizedFamily(normalizedProfile, providerId);
  if (family) {
    const compartment = owned.find((candidate) => candidate.id === family.compartmentId && candidate.familyId === providerId);
    if (compartment) return { action: 'open', compartment };
  }
  const matches = owned.filter((compartment) =>
    !compartment.familyId && compartment.siteRules.some((rule) => hostMatchesRule(host, rule))
  );
  if (matches.length === 1) return { action: 'open', compartment: matches[0] };
  if (matches.length > 1) return { action: 'choose', compartments: matches };
  return { action: 'create', key: siteKeyForUrl(url), host };
}

function oauthRoute({ profile, originCompartment, compartments = [], targetUrl }) {
  const normalizedProfile = normalizeProfile(profile);
  const origin = normalizeCompartment(originCompartment);
  if (origin.profileId !== normalizedProfile.id || origin.compatibilityLevel < 1) return { action: 'deny' };
  const host = hostForUrl(targetUrl);
  const providerEntry = Object.entries(PROVIDERS).find(([, provider]) => provider.authHosts.includes(host));
  if (!providerEntry) return { action: 'none' };
  const [providerId] = providerEntry;
  const family = authorizedFamily(normalizedProfile, providerId);
  const providerCompartment = family && compartments.map(normalizeCompartment).find((candidate) =>
    candidate.id === family.compartmentId && candidate.profileId === normalizedProfile.id && candidate.familyId === providerId
  );
  return providerCompartment
    ? { action: 'provider', providerId, compartmentId: providerCompartment.id }
    : { action: 'deny' };
}

function validateTabOwnership(profileId, compartment) {
  return safeId(profileId) !== '' && normalizeCompartment(compartment).profileId === safeId(profileId);
}

function partitionKeysForProfile(profileId, compartments = []) {
  return [...new Set(compartments.map(normalizeCompartment)
    .filter((compartment) => validateTabOwnership(profileId, compartment))
    .map(partitionForCompartment))];
}

function callbackBelongsToOrigin(callbackUrl, origin) {
  try {
    return new URL(callbackUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

module.exports = {
  PROVIDERS,
  normalizeProfile,
  normalizeCompartment,
  siteKeyForUrl,
  partitionForCompartment,
  resolveCompartment,
  oauthRoute,
  validateTabOwnership,
  partitionKeysForProfile,
  callbackBelongsToOrigin,
  hostForUrl,
  hostMatchesRule
};
