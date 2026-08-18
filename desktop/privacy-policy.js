'use strict';

const TRACKER_HOSTS = Object.freeze([
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'analytics.google.com',
  'facebook.net',
  'scorecardresearch.com',
  'hotjar.com',
  'clarity.ms',
  'segment.io',
  'adnxs.com',
  'taboola.com',
  'outbrain.com'
]);

function hostForUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatches(host, rule) {
  return host === rule || host.endsWith(`.${rule}`);
}

function siteIdentity(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length < 2) return parts.join('.');
  const publicSuffixPairs = new Set(['co.uk', 'com.au', 'co.jp', 'co.nz']);
  const lastTwo = parts.slice(-2).join('.');
  return publicSuffixPairs.has(lastTwo) && parts.length >= 3 ? parts.slice(-3).join('.') : lastTwo;
}

function isKnownTracker(url) {
  const host = hostForUrl(url);
  return Boolean(host) && TRACKER_HOSTS.some((rule) => hostMatches(host, rule));
}

function normalizeAllowance(input = {}) {
  const profileId = String(input.profileId || '').trim();
  const compartmentId = String(input.compartmentId || '').trim();
  const host = String(input.host || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const level = Math.max(1, Math.min(3, Number(input.level) || 0));
  if (!profileId || !compartmentId || !host || !level) return null;
  const pinned = Boolean(input.pinned);
  return {
    id: String(input.id || `${profileId}:${compartmentId}:${host}`),
    profileId,
    compartmentId,
    host,
    resourceTypes: [...new Set((Array.isArray(input.resourceTypes) ? input.resourceTypes : ['*']).map(String))],
    level,
    reason: String(input.reason || ''),
    providerId: input.providerId ? String(input.providerId) : null,
    allowBlockedHost: Boolean(input.allowBlockedHost),
    temporary: pinned ? false : input.temporary !== false,
    pinned,
    createdAt: Number(input.createdAt) || 1,
    updatedAt: Number(input.updatedAt) || Number(input.createdAt) || 1
  };
}

function allowanceApplies(allowance, context = {}) {
  const normalized = normalizeAllowance(allowance);
  if (!normalized) return false;
  return normalized.profileId === String(context.profileId || '') &&
    normalized.compartmentId === String(context.compartmentId || '') &&
    normalized.host === String(context.host || '').toLowerCase() &&
    (normalized.resourceTypes.includes('*') || normalized.resourceTypes.includes(String(context.resourceType || '')));
}

function serializableAllowances(allowances = []) {
  return allowances.map(normalizeAllowance).filter((allowance) => allowance?.pinned && !allowance.temporary);
}

function classifyRequest(context = {}) {
  const compartment = context.compartment || {};
  const profileId = String(context.profileId || compartment.profileId || '');
  const compartmentId = String(context.compartmentId || compartment.id || '');
  const host = hostForUrl(context.url);
  const topLevelHost = hostForUrl(context.topLevelUrl);
  const thirdParty = Boolean(host && topLevelHost && siteIdentity(host) !== siteIdentity(topLevelHost));
  const resourceType = String(context.resourceType || 'other');
  const matching = (context.allowances || []).map(normalizeAllowance).filter(Boolean).filter((allowance) =>
    allowanceApplies(allowance, { profileId, compartmentId, host, resourceType })
  );
  const tracker = isKnownTracker(context.url);
  const trackerOverride = matching.some((allowance) => allowance.pinned && allowance.allowBlockedHost);
  if (tracker && compartment.privacy?.blocking !== false && !trackerOverride) {
    return { block: true, stripRequestState: true, stripResponseState: true, reason: 'known-tracker' };
  }
  if (!thirdParty) {
    return { block: false, stripRequestState: false, stripResponseState: false, reason: 'first-party' };
  }
  const level = Math.max(0, Math.min(3, Number(compartment.compatibilityLevel) || 0));
  const allowed = level === 3 || matching.some((allowance) => allowance.level <= level);
  return {
    block: false,
    stripRequestState: !allowed,
    stripResponseState: !allowed,
    reason: allowed ? `compatibility-${level}` : 'third-party-state'
  };
}

function filterHeaders(headers, deniedNames) {
  const denied = new Set(deniedNames.map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(headers || {}).filter(([name]) => !denied.has(name.toLowerCase())));
}

function headersForRequestPolicy(headers, decision) {
  return decision?.stripRequestState
    ? filterHeaders(headers, ['cookie', 'cookie2', 'authorization', 'proxy-authorization'])
    : { ...(headers || {}) };
}

function headersForResponsePolicy(headers, decision) {
  return decision?.stripResponseState
    ? filterHeaders(headers, ['set-cookie', 'set-cookie2'])
    : { ...(headers || {}) };
}

module.exports = {
  TRACKER_HOSTS,
  classifyRequest,
  normalizeAllowance,
  serializableAllowances,
  allowanceApplies,
  isKnownTracker,
  headersForRequestPolicy,
  headersForResponsePolicy,
  hostForUrl,
  siteIdentity
};
