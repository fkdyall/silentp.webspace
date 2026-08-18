'use strict';

const assert = require('assert');
const { privacyViewModel, profileManagerViewModel, scopedAllowanceAction } = require('../web/ui-model');

const privacy = privacyViewModel({
  profile: { id: 'google-a', name: 'Google A' },
  compartment: { id: 'gmail-a', profileId: 'google-a', name: 'Gmail' },
  protectionLevel: 'hardened', blockedRequestCount: 7, authorizedFamily: 'google',
  compatibilityLevel: 1,
  temporaryAllowances: [{ id: 'temp-a', host: 'accounts.google.com', reason: 'OAuth' }],
  pinnedAllowances: []
});
assert.deepEqual(privacy, {
  profileName: 'Google A', compartmentName: 'Gmail', protectionLabel: 'Hardened',
  blockedRequestCount: 7, authorizedFamily: 'Google', compatibilityLevel: 1,
  temporaryAllowances: [{ id: 'temp-a', host: 'accounts.google.com', reason: 'OAuth' }], pinnedAllowances: []
});

const manager = profileManagerViewModel({
  profile: { id: 'google-a', name: 'Google A', authorizedFamilies: [{ providerId: 'google', compartmentId: 'gmail-a' }] },
  compartments: [
    { id: 'gmail-a', profileId: 'google-a', name: 'Gmail', persistent: true },
    { id: 'gmail-b', profileId: 'google-b', name: 'Gmail B', persistent: true }
  ],
  allowances: [
    { id: 'pin-a', profileId: 'google-a', compartmentId: 'gmail-a', host: 'cdn.example', pinned: true },
    { id: 'pin-b', profileId: 'google-b', compartmentId: 'gmail-b', host: 'cdn.example', pinned: true }
  ]
});
assert.deepEqual(manager.compartments.map((site) => site.id), ['gmail-a']);
assert.deepEqual(manager.allowances.map((allowance) => allowance.id), ['pin-a']);
assert.deepEqual(scopedAllowanceAction('pin', 'google-a', 'gmail-a', 'pin-a'), {
  action: 'pin', profileId: 'google-a', compartmentId: 'gmail-a', allowanceId: 'pin-a'
});
assert.equal(scopedAllowanceAction('remove', '', 'gmail-a', 'pin-a'), null);

console.log('browser UI model tests passed');
