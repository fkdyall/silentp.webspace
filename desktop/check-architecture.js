'use strict';

const fs = require('fs');
const path = require('path');

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const app = read('../web/app.js');
const html = read('../web/index.html');
const packageConfig = JSON.parse(read('package.json'));

const requirements = [
  [main.includes('partitionForCompartment'), 'tabs must resolve sessions through profile-owned site compartments'],
  [main.includes('profileId: state.profileId'), 'serialized windows and tab state must retain profile ownership'],
  [main.includes('compartmentId: tab.compartmentId'), 'serialized tabs must retain site-compartment ownership'],
  [main.includes("ipcMain.handle('profiles:route-url'"), 'main process must route URLs within the current profile'],
  [main.includes("ipcMain.handle('profiles:authorize-family'"), 'main process must own explicit provider-family authorization'],
  [main.includes("ipcMain.handle('compartments:clear'"), 'site data clearing must require profile and compartment scope'],
  [main.includes("ipcMain.handle('compatibility:set-level'"), 'compatibility relaxation must be site and profile scoped'],
  [main.includes("ipcMain.handle('compatibility:pin'"), 'temporary compatibility allowances must require explicit pinning'],
  [main.includes('onHeadersReceived'), 'third-party response state must be filterable before storage'],
  [main.includes('headersForRequestPolicy'), 'third-party request state must be filterable before sending'],
  [main.includes('blockedRequestCount'), 'blocked requests must be counted for browser chrome'],
  [main.includes('popupRouteForTarget'), 'OAuth popups must resolve through an authorized provider family'],
  [main.includes('callbackBelongsToOrigin'), 'OAuth callback handoff must validate the relying-party origin'],
  [main.includes('partitionKeysForProfile'), 'profile deletion must enumerate only profile-owned partitions'],
  [main.includes("ipcMain.handle('tabs:keep-active'"), 'Keep Active IPC handler must exist'],
  [main.includes("ipcMain.handle('tabs:detach'"), 'tab-to-window detach handler must exist'],
  [main.includes('overrideBrowserWindowOptions'), 'authentication popups must explicitly inherit parent-tab session options'],
  [main.includes('profileSession'), 'ordinary popup/session handling must use the originating site session'],
  [main.includes("profileSession.on('will-download'"), 'downloads must remain wired to the compartment session'],
  [main.includes("contents.on('context-menu'"), 'site views must retain native context menus'],
  [main.includes("ipcMain.handle('tabs:release-inactive'"), 'inactive-tab release handler must exist'],
  [main.includes("ipcMain.handle('app:quit-and-release'"), 'full resource-release exit must exist'],
  [preload.includes('setKeepActive'), 'preload bridge must expose Keep Active'],
  [preload.includes('detachTab'), 'preload bridge must expose multi-window detach'],
  [preload.includes('getActivePrivacy'), 'preload bridge must expose active profile/site privacy state'],
  [preload.includes('setCompatibilityLevel'), 'preload bridge must expose scoped compatibility levels'],
  [app.includes('tabList'), 'web interface must render the native tab strip'],
  [app.includes('routeUrl'), 'address bar must route through saved containers'],
  [html.includes('containerChooser'), 'multiple container matches must render a chooser'],
  [html.includes('newTabView'), 'browser must expose an immediate new-tab surface'],
  [html.includes('permissionsPopover'), 'browser chrome must expose live site permissions'],
  [html.includes('Exit &amp; Free Resources'), 'public resource-release label must remain generic'],
  [packageConfig.name === 'silent-p-pwsa-desktop', 'migration build must retain the legacy npm package identity'],
  [packageConfig.build.appId === 'com.fypm.silentpwebspace', 'migration build must retain the legacy application ID'],
  [packageConfig.productName === 'FYPM Browser', 'visible product name must be FYPM Browser'],
  [packageConfig.build.executableName === 'fypm-browser', 'Linux executable must be fypm-browser'],
  [packageConfig.build.appImage.artifactName === 'FYPM-Browser-${version}-linux-${arch}.${ext}', 'AppImage artifact naming must use FYPM Browser'],
  [!main.includes('AUTO_RELEASE_ON_MINIMIZE'), 'minimizing must not automatically kill an AI companion tab']
];

const failures = requirements.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error('Architecture checks failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Architecture checks passed (${requirements.length} requirements).`);
