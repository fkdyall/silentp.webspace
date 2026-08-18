'use strict';

const assert = require('assert');
const {
  classifyRequest,
  normalizeAllowance,
  serializableAllowances,
  allowanceApplies,
  isKnownTracker,
  headersForRequestPolicy,
  headersForResponsePolicy
} = require('./privacy-policy');

const compartmentA = {
  id: 'chatgpt-a',
  profileId: 'google-a',
  key: 'site:chatgpt.com',
  compatibilityLevel: 0,
  privacy: { blocking: true }
};
const ctxA = {
  profileId: 'google-a',
  compartmentId: 'chatgpt-a',
  topLevelUrl: 'https://chatgpt.com/c/1',
  resourceType: 'xhr',
  compartment: compartmentA,
  allowances: []
};

assert.equal(isKnownTracker('https://stats.doubleclick.net/pixel'), true);
assert.equal(isKnownTracker('https://notdoubleclick.net/app.js'), false);
assert.equal(classifyRequest({ ...ctxA, url: 'https://stats.doubleclick.net/pixel' }).block, true);
assert.equal(classifyRequest({ ...ctxA, url: 'https://notdoubleclick.net/app.js' }).block, false);
assert.equal(classifyRequest({ ...ctxA, url: 'https://cdn.example.net/app.js' }).stripRequestState, true);
assert.equal(classifyRequest({ ...ctxA, url: 'https://chatgpt.com/api' }).stripRequestState, false);

const level2ForA = normalizeAllowance({
  id: 'allow-a', profileId: 'google-a', compartmentId: 'chatgpt-a',
  host: 'cdn.example.net', resourceTypes: ['xhr'], level: 2, pinned: true
});
assert.equal(allowanceApplies(level2ForA, { ...ctxA, host: 'cdn.example.net', resourceType: 'xhr' }), true);
assert.equal(allowanceApplies(level2ForA, { ...ctxA, profileId: 'google-b', host: 'cdn.example.net', resourceType: 'xhr' }), false);
assert.equal(allowanceApplies(level2ForA, { ...ctxA, compartmentId: 'example-a', host: 'cdn.example.net', resourceType: 'xhr' }), false);
assert.equal(normalizeAllowance({ host: 'cdn.example.net' }), null);

const temporaryA = normalizeAllowance({
  id: 'temp-a', profileId: 'google-a', compartmentId: 'chatgpt-a',
  host: 'temporary.example', resourceTypes: ['script'], level: 2, temporary: true
});
const pinnedA = normalizeAllowance({
  id: 'pin-a', profileId: 'google-a', compartmentId: 'chatgpt-a',
  host: 'pinned.example', resourceTypes: ['xhr'], level: 2, pinned: true
});
assert.deepEqual(serializableAllowances([temporaryA, pinnedA]), [pinnedA]);

const relaxedA = { ...compartmentA, compatibilityLevel: 3 };
assert.equal(classifyRequest({ ...ctxA, compartment: relaxedA, url: 'https://cdn.example.net/api' }).stripRequestState, false);
assert.equal(classifyRequest({
  ...ctxA,
  profileId: 'google-b',
  compartmentId: 'chatgpt-b',
  compartment: { ...relaxedA, profileId: 'google-b', id: 'chatgpt-b', compatibilityLevel: 0 },
  url: 'https://cdn.example.net/api'
}).stripRequestState, true);

const authAllowance = normalizeAllowance({
  id: 'google-auth-a', profileId: 'google-a', compartmentId: 'chatgpt-a',
  host: 'accounts.google.com', resourceTypes: ['xhr'], level: 1, providerId: 'google', temporary: true
});
assert.equal(classifyRequest({
  ...ctxA,
  compartment: { ...compartmentA, compatibilityLevel: 1 },
  allowances: [authAllowance],
  url: 'https://accounts.google.com/session'
}).stripRequestState, false);
assert.equal(classifyRequest({
  ...ctxA,
  profileId: 'google-b',
  compartmentId: 'chatgpt-b',
  compartment: { ...compartmentA, id: 'chatgpt-b', profileId: 'google-b', compatibilityLevel: 1 },
  allowances: [authAllowance],
  url: 'https://accounts.google.com/session'
}).stripRequestState, true);

assert.deepEqual(
  headersForRequestPolicy({ Cookie: 'google=secret', Authorization: 'Bearer secret', Accept: 'application/json' }, { stripRequestState: true }),
  { Accept: 'application/json' }
);
assert.deepEqual(
  headersForResponsePolicy({ 'Set-Cookie': ['track=1'], 'Content-Type': ['text/plain'] }, { stripResponseState: true }),
  { 'Content-Type': ['text/plain'] }
);

console.log('privacy policy tests passed');
