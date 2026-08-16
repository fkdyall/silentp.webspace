'use strict';

const assert = require('assert');
const {
  normalizeContainer,
  partitionForContainer,
  matchingContainers,
  applyPreset,
  setContainerPermission
} = require('./container-model');

const chat = normalizeContainer({
  id: 'chat-main',
  name: 'ChatGPT',
  primaryUrl: 'https://chatgpt.com/',
  permissions: { microphone: true }
});
assert.equal(partitionForContainer(chat), 'persist:fypm-container-chat-main');
assert.deepEqual(
  matchingContainers([chat], 'https://chatgpt.com/c/123').map((container) => container.id),
  ['chat-main']
);

const googleA = normalizeContainer({
  id: 'google-a',
  name: 'Google A',
  primaryUrl: 'https://mail.google.com/',
  domainRules: [
    { type: 'suffix', value: 'google.com' },
    { type: 'exact', value: 'gmail.com' }
  ]
});
assert.equal(matchingContainers([googleA], 'https://accounts.google.com/').length, 1);
assert.equal(matchingContainers([googleA], 'https://example.com/').length, 0);

const googleB = normalizeContainer({
  id: 'google-b',
  name: 'Google B',
  primaryUrl: 'https://drive.google.com/'
});
assert.deepEqual(
  matchingContainers([googleA, googleB], 'https://docs.google.com/').map((container) => container.id),
  ['google-a', 'google-b']
);
assert.notEqual(partitionForContainer(googleA), partitionForContainer(googleB));

const hardened = applyPreset(
  normalizeContainer({ id: 'x', primaryUrl: 'https://example.com/' }),
  'hardened'
);
assert.equal(hardened.permissions.microphone, false);
const custom = setContainerPermission(hardened, 'microphone', true);
assert.equal(custom.permissions.microphone, true);
assert.equal(custom.privacyPreset, 'custom');
assert.equal(normalizeContainer(custom).permissions.microphone, true);

const legacy = normalizeContainer({
  id: 'legacy',
  primaryUrl: 'https://example.com/',
  partitionKey: 'persist:silentp-tab-tab_abc'
});
assert.equal(partitionForContainer(legacy), 'persist:silentp-tab-tab_abc');

console.log('container-model tests passed');
