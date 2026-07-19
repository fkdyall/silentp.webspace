'use strict';

const fs = require('fs');
const path = require('path');

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const app = read('../web/app.js');
const html = read('../web/index.html');

const requirements = [
  [main.includes('persist:silentp-tab-'), 'each persistent tab must have its own session partition'],
  [main.includes("ipcMain.handle('tabs:keep-active'"), 'Keep Active IPC handler must exist'],
  [main.includes("ipcMain.handle('tabs:detach'"), 'tab-to-window detach handler must exist'],
  [main.includes('overrideBrowserWindowOptions'), 'authentication popups must explicitly inherit parent-tab session options'],
  [main.includes('profileSession'), 'popup/session handling must use the tab session'],
  [main.includes("ipcMain.handle('tabs:release-inactive'"), 'inactive-tab release handler must exist'],
  [main.includes("ipcMain.handle('app:quit-and-release'"), 'full resource-release exit must exist'],
  [preload.includes('setKeepActive'), 'preload bridge must expose Keep Active'],
  [preload.includes('detachTab'), 'preload bridge must expose multi-window detach'],
  [app.includes('nativeTabList'), 'web interface must render the native tab strip'],
  [app.includes('activePrivacyPreset'), 'web interface must expose per-tab privacy presets'],
  [html.includes('Exit &amp; Free Resources'), 'public resource-release label must remain generic'],
  [!main.includes('AUTO_RELEASE_ON_MINIMIZE'), 'minimizing must not automatically kill an AI companion tab']
];

const failures = requirements.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error('Architecture checks failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Architecture checks passed (${requirements.length} requirements).`);
