'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  migrateLegacyDesktopState,
  loadBrowserState,
  saveBrowserState,
  legacyUserDataPath
} = require('./state-store');

assert.equal(
  legacyUserDataPath('/home/tester/.config'),
  path.join('/home/tester/.config', 'Silent P. PWSA')
);

const legacyWindows = [{
  id: 'win_1',
  activeTabId: 'tab_abc',
  tabs: [
    {
      id: 'tab_abc',
      url: 'https://chatgpt.com/',
      profile: {
        id: 'chat-profile',
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        permissions: { microphone: true }
      }
    },
    {
      id: 'tab_def',
      url: 'https://chatgpt.com/c/2',
      profile: {
        id: 'chat-profile',
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        permissions: { microphone: true }
      }
    },
    {
      id: 'tab_other',
      url: 'https://chatgpt.com/',
      profile: {
        id: 'other-profile',
        name: 'ChatGPT Account 2',
        url: 'https://chatgpt.com/'
      }
    }
  ]
}];

const migrated = migrateLegacyDesktopState(legacyWindows);
assert.equal(migrated.version, 2);
assert.equal(migrated.containers.length, 2);
const chat = migrated.containers.find((container) => container.id === 'chat-profile');
const other = migrated.containers.find((container) => container.id === 'other-profile');
assert.equal(chat.partitionKey, 'persist:silentp-tab-tab_abc');
assert.equal(chat.permissions.microphone, true);
assert.notEqual(chat.partitionKey, other.partitionKey);
assert.deepEqual(
  migrated.windows[0].tabs.map((tab) => tab.containerId),
  ['chat-profile', 'chat-profile', 'other-profile']
);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fypm-state-test-'));
try {
  const browserStatePath = path.join(temporaryDirectory, 'browser-state-v2.json');
  const legacyStatePath = path.join(temporaryDirectory, 'desktop-session.json');
  fs.writeFileSync(legacyStatePath, JSON.stringify({ version: 1, windows: legacyWindows }));

  const loadedLegacy = loadBrowserState({ browserStatePath, legacyStatePath });
  assert.deepEqual(loadedLegacy, migrated);

  saveBrowserState(browserStatePath, migrated);
  assert.deepEqual(JSON.parse(fs.readFileSync(browserStatePath, 'utf8')), migrated);
  assert.equal(fs.existsSync(`${browserStatePath}.tmp`), false);

  const loadedV2 = loadBrowserState({ browserStatePath, legacyStatePath });
  assert.deepEqual(loadedV2, migrated);

  const persistent = migrated.containers[0];
  const temporary = { ...migrated.containers[1], id: 'temp-private', temporary: true, partitionKey: 'fypm-temp-private' };
  saveBrowserState(browserStatePath, {
    version: 2,
    containers: [persistent, temporary],
    windows: [{
      id: 'restore-window',
      activeTabId: 'private-tab',
      tabs: [
        { id: 'shared-one', containerId: persistent.id, url: 'https://chatgpt.com/' },
        { id: 'shared-two', containerId: persistent.id, url: 'https://chatgpt.com/c/2' },
        { id: 'private-tab', containerId: temporary.id, url: 'https://example.com/', temporary: true }
      ]
    }]
  });
  const filtered = JSON.parse(fs.readFileSync(browserStatePath, 'utf8'));
  assert.deepEqual(filtered.containers.map((container) => container.id), [persistent.id]);
  assert.deepEqual(filtered.windows[0].tabs.map((tab) => tab.id), ['shared-one', 'shared-two']);
  assert.equal(filtered.windows[0].activeTabId, 'shared-one');
  assert.equal(filtered.containers[0].partitionKey, persistent.partitionKey);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('state-store tests passed');
