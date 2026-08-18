'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  migrateV2State,
  loadBrowserState,
  saveBrowserState,
  serializableBrowserState,
  legacyUserDataPath
} = require('./state-store');

assert.equal(legacyUserDataPath('/home/tester/.config'), path.join('/home/tester/.config', 'Silent P. PWSA'));

const oldGoogleAPartition = 'persist:fypm-container-google-a';
const v2 = {
  version: 2,
  containers: [
    {
      id: 'google-a', name: 'Google A', primaryUrl: 'https://mail.google.com/',
      domainRules: [{ type: 'suffix', value: 'google.com' }],
      partitionKey: oldGoogleAPartition, permissions: { microphone: true }, color: '#aabbcc'
    },
    {
      id: 'google-b', name: 'Google B', primaryUrl: 'https://drive.google.com/',
      domainRules: [{ type: 'suffix', value: 'google.com' }],
      partitionKey: 'persist:fypm-container-google-b'
    },
    {
      id: 'chat-profile', name: 'ChatGPT', primaryUrl: 'https://chatgpt.com/',
      partitionKey: 'persist:fypm-container-chat-profile'
    },
    {
      id: 'temp-profile', name: 'Private', primaryUrl: 'https://private.example/',
      partitionKey: 'fypm-temp-old', temporary: true
    }
  ],
  windows: [{
    id: 'mixed-window', activeTabId: 'google-tab',
    tabs: [
      { id: 'google-tab', containerId: 'google-a', url: 'https://mail.google.com/mail/u/0/' },
      { id: 'example-tab', containerId: 'google-a', url: 'https://example.com/work' },
      { id: 'google-b-tab', containerId: 'google-b', url: 'https://docs.google.com/document/d/1' },
      { id: 'chat-one', containerId: 'chat-profile', url: 'https://chatgpt.com/' },
      { id: 'chat-two', containerId: 'chat-profile', url: 'https://chatgpt.com/c/2' },
      { id: 'private-tab', containerId: 'temp-profile', url: 'https://private.example/', temporary: true }
    ]
  }]
};

const migrated = migrateV2State(v2, { completedAt: 1234, metadataBackupPath: '/backup/v2.json' });
assert.equal(migrated.version, 3);
assert.equal(migrated.profiles.filter((profile) => profile.id === 'google-a').length, 1);
assert.equal(migrated.profiles.some((profile) => profile.id === 'temp-profile'), false);
const googleA = migrated.compartments.find((site) => site.profileId === 'google-a' && site.familyId === 'google');
const googleB = migrated.compartments.find((site) => site.profileId === 'google-b' && site.familyId === 'google');
const exampleA = migrated.compartments.find((site) => site.profileId === 'google-a' && site.key === 'site:example.com');
const chatSites = migrated.compartments.filter((site) => site.profileId === 'chat-profile' && site.key === 'site:chatgpt.com');
assert.equal(googleA.partitionKey, oldGoogleAPartition);
assert.notEqual(googleA.partitionKey, googleB.partitionKey);
assert.notEqual(exampleA.partitionKey, oldGoogleAPartition);
assert.equal(googleA.permissions.microphone, true);
assert.equal(chatSites.length, 1);
assert.equal(migrated.windows.length, 3);
assert.equal(migrated.windows.every((windowRecord) => windowRecord.profileId), true);
const byCompartmentId = new Map(migrated.compartments.map((site) => [site.id, site]));
assert.equal(migrated.windows.every((windowRecord) => windowRecord.tabs.every((tab) =>
  byCompartmentId.get(tab.compartmentId)?.profileId === windowRecord.profileId
)), true);
assert.equal(migrated.windows.flatMap((windowRecord) => windowRecord.tabs).some((tab) => tab.id === 'private-tab'), false);
assert.deepEqual(migrated.migration, {
  sourceVersion: 2,
  migrationId: 'hierarchical-profile-isolation-v1',
  completedAt: 1234,
  metadataBackupPath: '/backup/v2.json'
});

const temporaryAllowance = {
  id: 'temp-a', profileId: 'google-a', compartmentId: googleA.id,
  host: 'temporary.example', resourceTypes: ['xhr'], level: 2, temporary: true, pinned: false
};
const pinnedAllowance = {
  id: 'pin-a', profileId: 'google-a', compartmentId: googleA.id,
  host: 'pinned.example', resourceTypes: ['xhr'], level: 2, temporary: false, pinned: true
};
const serialized = serializableBrowserState({
  ...migrated,
  compatibilityAllowances: [temporaryAllowance, pinnedAllowance],
  windows: [...migrated.windows, {
    id: 'bad-window', profileId: 'google-a', activeTabId: 'bad-tab',
    tabs: [{ id: 'bad-tab', compartmentId: googleB.id, url: 'https://docs.google.com/' }]
  }]
});
assert.deepEqual(serialized.compatibilityAllowances.map((allowance) => allowance.id), ['pin-a']);
assert.equal(serialized.windows.some((windowRecord) => windowRecord.id === 'bad-window'), false);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fypm-state-v3-test-'));
try {
  const browserStatePath = path.join(temporaryDirectory, 'browser-state-v3.json');
  const v2StatePath = path.join(temporaryDirectory, 'browser-state-v2.json');
  const backupDirectory = path.join(temporaryDirectory, 'migration-backups');
  fs.writeFileSync(v2StatePath, JSON.stringify(v2, null, 2));

  const loadedFirst = loadBrowserState({ browserStatePath, v2StatePath, backupDirectory, now: () => 5678 });
  assert.equal(loadedFirst.version, 3);
  assert.equal(fs.existsSync(browserStatePath), true);
  const firstBytes = fs.readFileSync(browserStatePath);
  const backupFiles = fs.readdirSync(backupDirectory);
  assert.equal(backupFiles.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(backupDirectory, backupFiles[0]), 'utf8'));
  assert.equal(backup.sourceVersion, 2);
  assert.equal(backup.sha256, crypto.createHash('sha256').update(JSON.stringify(v2)).digest('hex'));
  assert.deepEqual(backup.state, v2);

  const loadedSecond = loadBrowserState({ browserStatePath, v2StatePath, backupDirectory, now: () => 9999 });
  assert.deepEqual(loadedSecond, loadedFirst);
  assert.deepEqual(fs.readFileSync(browserStatePath), firstBytes);
  assert.equal(fs.readdirSync(backupDirectory).length, 1);
  assert.equal(fs.existsSync(`${browserStatePath}.tmp`), false);

  saveBrowserState(browserStatePath, loadedSecond);
  assert.equal(JSON.parse(fs.readFileSync(browserStatePath, 'utf8')).version, 3);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('state-store v3 migration tests passed');
