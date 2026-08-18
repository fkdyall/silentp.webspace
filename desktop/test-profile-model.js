'use strict';

const assert = require('assert');
const {
  normalizeProfile,
  normalizeCompartment,
  partitionForCompartment,
  resolveCompartment,
  oauthRoute,
  validateTabOwnership,
  partitionKeysForProfile,
  callbackBelongsToOrigin
} = require('./profile-model');

const profileA = normalizeProfile({
  id: 'google-a',
  name: 'Google A',
  authorizedFamilies: [{ providerId: 'google', compartmentId: 'google-a-family' }]
});
const profileB = normalizeProfile({
  id: 'google-b',
  name: 'Google B',
  authorizedFamilies: [{ providerId: 'google', compartmentId: 'google-b-family' }]
});

const googleA = normalizeCompartment({
  id: 'google-a-family', profileId: profileA.id, key: 'family:google',
  familyId: 'google', name: 'Google', primaryUrl: 'https://mail.google.com/'
});
const googleB = normalizeCompartment({
  id: 'google-b-family', profileId: profileB.id, key: 'family:google',
  familyId: 'google', name: 'Google', primaryUrl: 'https://mail.google.com/'
});
const chatgptA = normalizeCompartment({
  id: 'chatgpt-a', profileId: profileA.id, key: 'site:chatgpt.com',
  name: 'ChatGPT', primaryUrl: 'https://chatgpt.com/'
});
const exampleA = normalizeCompartment({
  id: 'example-a', profileId: profileA.id, key: 'site:example.com',
  name: 'Example', primaryUrl: 'https://example.com/'
});
const relyingPartyA = normalizeCompartment({
  id: 'relying-a', profileId: profileA.id, key: 'site:relying.example',
  name: 'Relying Party', primaryUrl: 'https://relying.example/', compatibilityLevel: 1
});
const compartments = [googleA, googleB, chatgptA, exampleA, relyingPartyA];

assert.notEqual(partitionForCompartment(googleA), partitionForCompartment(googleB));
assert.notEqual(partitionForCompartment(chatgptA), partitionForCompartment(exampleA));
assert.equal(
  partitionForCompartment(normalizeCompartment({ ...chatgptA })),
  partitionForCompartment(chatgptA)
);

assert.equal(
  resolveCompartment({ profile: profileA, compartments, url: 'https://docs.google.com/' }).compartment.id,
  googleA.id
);
assert.equal(
  resolveCompartment({ profile: profileB, compartments, url: 'https://docs.google.com/' }).compartment.id,
  googleB.id
);
assert.equal(
  resolveCompartment({ profile: profileA, compartments, url: 'https://notgoogle.com/' }).action,
  'create'
);

assert.deepEqual(
  oauthRoute({
    profile: profileA,
    originCompartment: relyingPartyA,
    compartments,
    targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
  }),
  { action: 'provider', providerId: 'google', compartmentId: googleA.id }
);
assert.equal(
  oauthRoute({
    profile: profileB,
    originCompartment: relyingPartyA,
    compartments,
    targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
  }).action,
  'deny'
);
assert.equal(
  oauthRoute({
    profile: profileA,
    originCompartment: relyingPartyA,
    compartments,
    targetUrl: 'https://evilaccounts.google.com/o/oauth2/v2/auth'
  }).action,
  'none'
);

assert.equal(validateTabOwnership(profileA.id, googleB), false);
assert.deepEqual(
  partitionKeysForProfile(profileA.id, compartments).sort(),
  [googleA.partitionKey, chatgptA.partitionKey, exampleA.partitionKey, relyingPartyA.partitionKey].sort()
);
assert.equal(callbackBelongsToOrigin('https://relying.example/callback?code=abc', 'https://relying.example'), true);
assert.equal(callbackBelongsToOrigin('https://relying.example.evil.test/callback', 'https://relying.example'), false);

const legacy = normalizeCompartment({
  id: 'legacy-google', profileId: profileA.id, key: 'family:google',
  partitionKey: 'persist:fypm-container-google-a'
});
assert.equal(partitionForCompartment(legacy), 'persist:fypm-container-google-a');

console.log('profile model tests passed');
