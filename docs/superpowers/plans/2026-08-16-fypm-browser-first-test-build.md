# FYPM Browser First Test Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Linux AppImage test build of FYPM Browser that behaves like a normal desktop browser while using persistent isolated containers for logins, permissions, and storage.

**Architecture:** Keep Electron 43 and the existing BrowserWindow + WebContentsView architecture, but move session identity from per-tab partitions to persistent container partitions. The main process becomes authoritative for containers, tabs, permissions, session restoration, routing, downloads, and context menus; the renderer becomes a browser-first shell that asks the main process to route URLs and mutate container settings. Preserve the existing internal application identity for this migration release and preserve legacy partitions where they can be mapped safely.

**Tech Stack:** Electron 43.1.1, Node.js 22 in CI, plain JavaScript/HTML/CSS, electron-builder 26.15.3, GitHub Actions, Linux AppImage.

## Global Constraints

- Official visible product name: `FYPM Browser`.
- Keep the existing internal package name and app ID for this migration release: `silent-p-pwsa-desktop` and `com.fypm.silentpwebspace`.
- Preserve existing Silent P user data wherever practical; never delete legacy partitions during migration.
- The exact approved FYPM artwork must be copied byte-for-byte into the repository and used without redraw, recolor, crop, or regeneration.
- Every persistent saved container has its own Chromium/Electron session partition.
- Multiple tabs opened from one container share that container partition.
- Different containers do not share cookies/site storage by default.
- Keep Active affects renderer execution only, never login persistence.
- Restore the previous non-temporary session by default.
- Retain the existing clipboard permission hotfix.
- No LocalCDN, exhaustive fingerprint work, authenticated proxy support, encrypted exports, maintained filter-list project, Android work, or unrelated refactoring in this milestone.

---

## File Structure for This Milestone

**Create**
- `desktop/container-model.js` — pure container normalization, partition naming, domain matching, preset application, and permission mutation.
- `desktop/state-store.js` — versioned browser-state load/save and legacy desktop-session migration.
- `desktop/context-menu.js` — context-menu action selection and Electron menu binding.
- `desktop/test-container-model.js` — unit tests for matching, partition reuse, presets, and manual permission overrides.
- `desktop/test-state-store.js` — migration tests proving legacy partitions are preserved.
- `desktop/test-context-menu.js` — unit tests for right-click action selection.
- `web/assets/fypm-brand.png` — exact approved artwork bytes.
- `tools/install-fypm-launcher.sh` — LXQt desktop-entry installer for the test AppImage.
- `FYPM_V0.4_ACCEPTANCE.md` — exact ASUS test pass for the new build.

**Modify**
- `desktop/main.js` — container-backed tab/session lifecycle, URL routing, permission updates, downloads, context menus, restoration.
- `desktop/preload.js` — FYPM container/routing/permission/download IPC bridge while retaining existing tab controls.
- `desktop/package.json` — FYPM visible/build names, tests, build assets, artifact names.
- `desktop/check-architecture.js` — replace obsolete per-tab partition assertion with container-partition invariants.
- `web/index.html` — browser-first chrome, new-tab/start screen, container chooser, permission popover, download indicator.
- `web/app.js` — browser shell state and IPC flow; remove profile-first startup behavior.
- `web/styles.css` — polished FYPM browser chrome and readable start screen over the locked artwork.
- `web/manifest.webmanifest` — FYPM Browser visible identity.
- `.github/workflows/clipboard-hotfix-build.yml` — evolve the Linux branch workflow into the FYPM test-build workflow and upload the AppImage plus checksum.

---

### Task 1: Introduce the Persistent Container Model

**Files:**
- Create: `desktop/container-model.js`
- Create: `desktop/test-container-model.js`
- Modify: `desktop/package.json`

**Interfaces:**
- Produces: `normalizeContainer(input) -> Container`
- Produces: `partitionForContainer(container) -> string`
- Produces: `matchingContainers(containers, url) -> Container[]`
- Produces: `applyPreset(container, preset) -> Container`
- Produces: `setContainerPermission(container, permission, allowed) -> Container`
- `Container` fields used by later tasks: `id`, `name`, `primaryUrl`, `domainRules`, `partitionKey`, `privacyPreset`, `privacy`, `permissions`, `temporary`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write failing container-model tests**

Create `desktop/test-container-model.js` with assertions equivalent to:

```js
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
assert.deepEqual(matchingContainers([chat], 'https://chatgpt.com/c/123').map(c => c.id), ['chat-main']);

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

const hardened = applyPreset(normalizeContainer({ id: 'x', primaryUrl: 'https://example.com/' }), 'hardened');
assert.equal(hardened.permissions.microphone, false);
const custom = setContainerPermission(hardened, 'microphone', true);
assert.equal(custom.permissions.microphone, true);
assert.equal(custom.privacyPreset, 'custom');

const legacy = normalizeContainer({
  id: 'legacy',
  primaryUrl: 'https://example.com/',
  partitionKey: 'persist:silentp-tab-tab_abc'
});
assert.equal(partitionForContainer(legacy), 'persist:silentp-tab-tab_abc');

console.log('container-model tests passed');
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd desktop
node test-container-model.js
```

Expected: failure because `container-model.js` does not exist.

- [ ] **Step 3: Implement the minimal pure container model**

`normalizeContainer()` must provide stable defaults without reapplying presets on every call. `applyPreset()` is called only when a preset is explicitly selected. `setContainerPermission()` must mutate the resolved permission and set `privacyPreset = 'custom'`.

Domain matching rules:

```js
function hostMatchesRule(host, rule) {
  if (rule.type === 'exact') return host === rule.value;
  if (rule.type === 'suffix') return host === rule.value || host.endsWith(`.${rule.value}`);
  return false;
}
```

Default rules come from the primary URL host. If the primary host is a Google subdomain, seed a suffix rule for `google.com`; if it is `gmail.com`, seed both `gmail.com` and `google.com`. Do not infer unrelated third-party domains from redirects.

- [ ] **Step 4: Run the model test and syntax checks**

Run:

```bash
cd desktop
node test-container-model.js
node --check container-model.js
```

Expected: both pass.

- [ ] **Step 5: Add the model test to `npm run check` and commit**

Update `desktop/package.json` so `check` runs `node test-container-model.js` before architecture checks.

Commit:

```bash
git add desktop/container-model.js desktop/test-container-model.js desktop/package.json
git commit -m "feat: add persistent container model"
```

---

### Task 2: Add Versioned State and Safe Legacy Migration

**Files:**
- Create: `desktop/state-store.js`
- Create: `desktop/test-state-store.js`
- Modify: `desktop/package.json`

**Interfaces:**
- Consumes: `normalizeContainer()` from Task 1.
- Produces: `migrateLegacyDesktopState(legacyWindows) -> BrowserStateV2`
- Produces: `loadBrowserState({ browserStatePath, legacyStatePath }) -> BrowserStateV2`
- Produces: `saveBrowserState(filePath, state) -> void`
- `BrowserStateV2`: `{ version: 2, containers: Container[], windows: WindowRecord[] }`.
- `WindowRecord.tabs[]` contains `containerId` rather than a full duplicated profile object.

- [ ] **Step 1: Write migration tests**

The test fixture must include a legacy tab with id `tab_abc` and a profile containing microphone permission. Assert that migration creates one container with:

```js
partitionKey === 'persist:silentp-tab-tab_abc'
permissions.microphone === true
```

Also assert two legacy tabs using the same legacy `profile.id` map to the same container when possible, while distinct profile IDs remain isolated.

- [ ] **Step 2: Run the test and verify failure**

```bash
cd desktop
node test-state-store.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement migration and atomic save**

Migration behavior:

```js
const containerId = saved.profile?.id || `legacy-${saved.id}`;
const partitionKey = `persist:silentp-tab-${safeId(saved.id)}`;
```

If several legacy tabs claim the same profile ID, preserve the first mapped legacy partition as that container's partition; do not delete the other old partitions. Save JSON by writing `<path>.tmp` then renaming it over the final file so a crash does not leave half-written state.

- [ ] **Step 4: Run tests and add to `npm run check`**

```bash
cd desktop
node test-state-store.js
npm run check
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/state-store.js desktop/test-state-store.js desktop/package.json
git commit -m "feat: migrate legacy sessions into containers"
```

---

### Task 3: Convert Main-Process Tabs From Per-Tab Sessions to Container Sessions

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/check-architecture.js`

**Interfaces:**
- Consumes: `BrowserStateV2`, `partitionForContainer()`, `matchingContainers()`.
- Produces IPC:
  - `containers:list`
  - `containers:create`
  - `containers:update`
  - `containers:remove`
  - `containers:route-url`
  - `tabs:open` accepting `{ url, containerId, temporary }`
  - existing tab lifecycle IPC retained.

- [ ] **Step 1: Change architecture checks first so the current code fails**

Replace the obsolete requirement:

```js
main.includes('persist:silentp-tab-')
```

with checks that require:

```js
main.includes('partitionForContainer')
main.includes("ipcMain.handle('containers:route-url'")
main.includes("ipcMain.handle('containers:update'")
```

Keep the checks for Keep Active, detach, popup session inheritance, Release inactive, and Exit & Free Resources.

- [ ] **Step 2: Run `npm run check` and verify failure**

```bash
cd desktop
npm run check
```

Expected: architecture failure because main-process container routing is not implemented yet.

- [ ] **Step 3: Refactor runtime state**

In `main.js`, replace `tab.profile` as the authoritative session identity with `tab.containerId` and a central `containers` map. A tab may still carry presentation fields like title/url, but permissions and partition selection come from the container.

Implement:

```js
function containerForTab(tab) {
  return tab ? containers.get(tab.containerId) || null : null;
}

function partitionForTab(tab) {
  const container = containerForTab(tab);
  return container ? partitionForContainer(container) : null;
}
```

`createTabView()` must call `session.fromPartition(partitionForContainer(container), { cache: !container.temporary })` so every tab in one saved container shares login state.

- [ ] **Step 4: Route typed URLs through saved containers**

`containers:route-url` returns one of:

```js
{ action: 'open', containerId, url }
{ action: 'choose', url, matches: [{ id, name, primaryUrl }] }
{ action: 'unmatched', url }
```

Exactly one match opens automatically. Multiple matches never auto-select. Unmatched destinations are left for the renderer to offer `New isolated container` or `Temporary/private`.

- [ ] **Step 5: Preserve temporary-container destruction semantics**

When the last tab using a temporary container closes, clear its storage/cache, delete its in-memory container record, and never serialize it into saved state.

- [ ] **Step 6: Preserve popup session inheritance and resource controls**

Authentication child windows must continue receiving the parent container's `session` in `overrideBrowserWindowOptions`. Keep Active and parking must never clear the container session.

- [ ] **Step 7: Run all checks**

```bash
cd desktop
npm run check
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/main.js desktop/preload.js desktop/check-architecture.js
git commit -m "feat: share persistent sessions by container"
```

---

### Task 4: Fix Permission Persistence and Add Live Site Controls

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `web/index.html`
- Modify: `web/app.js`

**Interfaces:**
- Consumes: `setContainerPermission(container, permission, allowed)`.
- Produces IPC:
  - `containers:get-active`
  - `containers:set-permission`
  - `containers:apply-preset`
- Renderer displays current resolved permission values from the active container.

- [ ] **Step 1: Add a failing test proving manual microphone permission survives preset history**

Extend `test-container-model.js`:

```js
const c = applyPreset(normalizeContainer({ id: 'mic', primaryUrl: 'https://chatgpt.com/' }), 'hardened');
const changed = setContainerPermission(c, 'microphone', true);
assert.equal(changed.privacyPreset, 'custom');
assert.equal(changed.permissions.microphone, true);
assert.equal(normalizeContainer(changed).permissions.microphone, true);
```

- [ ] **Step 2: Ensure main-process permission checks read the active container, not a stale profile snapshot**

`permissionAllowed()` must receive a container and evaluate `container.permissions`. For `media`, honor the requested media types. Preserve the clipboard wrapper behavior from `bootstrap.js` and `clipboard-permissions.js`.

- [ ] **Step 3: Add the address-bar permission popover**

Add a compact shield/permissions button beside the address field. The popover must show at minimum:

```text
Container: ChatGPT
Microphone  [Allow/Block]
Camera      [Allow/Block]
Location    [Allow/Block]
Clipboard   [Allow/Block]
Popups      [Allow/Block]
Preset: Custom
```

Toggling a permission must call `containers:set-permission`, immediately mark the container Custom, save state, and refresh the displayed values.

- [ ] **Step 4: Make preset selection a one-time template action**

`containers:apply-preset` explicitly applies preset defaults and saves them. Launching or restoring a container must never call `applyPreset()` again merely because `privacyPreset` says `hardened`, `balanced`, or `compatibility`.

- [ ] **Step 5: Run checks**

```bash
cd desktop
npm run check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/main.js desktop/preload.js web/index.html web/app.js desktop/test-container-model.js
git commit -m "fix: persist resolved site permissions"
```

---

### Task 5: Implement Normal Right-Click Menus and Download Feedback

**Files:**
- Create: `desktop/context-menu.js`
- Create: `desktop/test-context-menu.js`
- Modify: `desktop/main.js`
- Modify: `desktop/package.json`
- Modify: `web/index.html`
- Modify: `web/app.js`

**Interfaces:**
- Produces: `contextActionIds(params, navigation) -> string[]`
- Main process binds action IDs to Electron `Menu` items and `webContents` operations.
- Main process emits `downloads:changed` messages with `{ id, filename, state, receivedBytes, totalBytes, savePath }`.

- [ ] **Step 1: Write context-menu tests**

Assert:

- selected page text includes `copy` and `selectAll`;
- editable fields include `cut`, `copy`, `paste`, `selectAll`;
- links include `openLink`, `copyLink`;
- ordinary page background includes available `back`, `forward`, and `reload` actions.

- [ ] **Step 2: Run the test and verify failure**

```bash
cd desktop
node test-context-menu.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement `context-menu.js` and attach it to every tab WebContents**

Use `contents.on('context-menu', ...)` and `Menu.buildFromTemplate(...)`. Do not expose Node APIs to page content. Use Electron roles for edit operations where available and explicit click handlers for navigation/link actions.

- [ ] **Step 4: Add per-container download observation once per configured session**

Inside session setup:

```js
profileSession.on('will-download', (_event, item) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // emit start, updated, and done/interrupted state through the owning window(s)
});
```

The renderer should show a small download chip/indicator rather than silently downloading with no feedback.

- [ ] **Step 5: Run all checks and commit**

```bash
cd desktop
npm run check
```

Commit:

```bash
git add desktop/context-menu.js desktop/test-context-menu.js desktop/main.js desktop/package.json web/index.html web/app.js
git commit -m "feat: add browser context menus and download feedback"
```

---

### Task 6: Replace the Profile-First Dashboard With Browser-First FYPM Chrome

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Modify: `web/manifest.webmanifest`

**Interfaces:**
- Consumes preload APIs for tab list, URL routing, container list/create/select, permissions, browser commands, Keep Active, parking, release, and exit.
- Produces no new privileged APIs.

- [ ] **Step 1: Replace the startup layout with browser chrome**

The host UI must contain, in this order:

```text
[tab strip] [+]
[Back] [Forward] [Reload] [address/search field] [container badge] [permissions] [menu]
[active WebContentsView OR new-tab/start screen]
```

The user must be able to focus the address field immediately and browse without opening a profile editor.

- [ ] **Step 2: Implement the start/new-tab screen**

Use `web/assets/fypm-brand.png` as the fixed background visual with a dark readability overlay applied in CSS; do not edit the image itself. Show saved containers as compact shortcut tiles/buttons, not configuration cards.

- [ ] **Step 3: Implement URL-routing UI**

On Enter in the address field:

1. call `routeUrl(url)`;
2. if `open`, open/activate using that container;
3. if `choose`, display a compact dropdown under the address field with every matching container plus `New isolated container` and `Temporary/private`;
4. if `unmatched`, display only the two creation choices rather than blocking navigation with a full profile form.

- [ ] **Step 4: Make container management secondary**

The compact main menu may expose `Manage containers`. Container editing includes name, primary URL/domain rules, preset template, resolved permissions, and delete/clear actions. It must not be the startup screen.

- [ ] **Step 5: Preserve keyboard behavior**

Ensure:

```text
Ctrl+L -> address field
Ctrl+T -> new tab/start screen
Ctrl+W -> close active tab
Alt+Left -> back
Alt+Right -> forward
Ctrl+R -> reload
```

- [ ] **Step 6: Verify layout manually at 1366x768 and a larger external display**

Check tab overflow, address-bar width, permission popover placement, chooser placement, and that dialogs do not render behind WebContentsView content.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/app.js web/styles.css web/manifest.webmanifest
git commit -m "feat: redesign shell as FYPM Browser"
```

---

### Task 7: Apply FYPM Branding Without Breaking User Data

**Files:**
- Create: `web/assets/fypm-brand.png`
- Modify: `desktop/package.json`
- Modify: `desktop/main.js`
- Create: `tools/install-fypm-launcher.sh`

**Interfaces:**
- Build product: `FYPM Browser`
- Linux artifact: `FYPM-Browser-<version>-linux-<arch>.AppImage`
- Executable: `fypm-browser`
- Internal app ID remains `com.fypm.silentpwebspace` in this migration release.

- [ ] **Step 1: Copy the approved artwork byte-for-byte**

Use the exact approved image from the conversation/runtime as the source and verify source and repository-copy SHA-256 are identical before committing. Do not resize or transcode it.

- [ ] **Step 2: Update visible/build names while retaining internal identity**

In `desktop/package.json` set:

```json
{
  "productName": "FYPM Browser",
  "desktopName": "fypm-browser.desktop",
  "build": {
    "appId": "com.fypm.silentpwebspace",
    "productName": "FYPM Browser",
    "executableName": "fypm-browser",
    "appImage": {
      "artifactName": "FYPM-Browser-${version}-linux-${arch}.${ext}"
    }
  }
}
```

Keep the top-level npm `name` as `silent-p-pwsa-desktop` for this migration build.

- [ ] **Step 3: Change window title and visible copy to FYPM Browser**

`BrowserWindow` title and About/start-screen text must use FYPM Browser. Remove user-facing `Silent P. PWSA` strings from the desktop shell while leaving migration/internal identifiers alone.

- [ ] **Step 4: Add an LXQt launcher installer**

`tools/install-fypm-launcher.sh` must create `~/.local/share/applications/fypm-browser.desktop` pointing to `$HOME/Applications/FYPM-Browser.AppImage`, category `Network;WebBrowser;`, and refresh the desktop database when available.

- [ ] **Step 5: Run syntax/check suite and commit**

```bash
cd desktop
npm run check
```

Commit:

```bash
git add web/assets/fypm-brand.png desktop/package.json desktop/main.js tools/install-fypm-launcher.sh
git commit -m "chore: brand desktop build as FYPM Browser"
```

---

### Task 8: Harden Session Restore, Parking, and Exit Semantics

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/state-store.js`
- Modify: `web/app.js`
- Create: `FYPM_V0.4_ACCEPTANCE.md`

**Interfaces:**
- Non-temporary containers/windows/tabs serialize to BrowserStateV2.
- Park/release destroys only renderer objects, never the persistent session partition.

- [ ] **Step 1: Add state-store tests for temporary exclusion and shared-container tabs**

Assert that two serialized tabs may reference the same `containerId`, temporary containers/tabs do not serialize, and reopening state preserves the same `partitionKey`.

- [ ] **Step 2: Make startup restore BrowserStateV2 by default**

If state has saved windows, recreate them and reactivate their last active non-temporary tab. If state is empty, open one clean FYPM start page.

- [ ] **Step 3: Verify Keep Active and parking semantics in code**

`destroyTabView()` must never call `clearStorageData()` for persistent containers. `Release inactive` skips the selected tab and every `keepActive` tab. Closing the final ordinary tab leaves the saved container itself intact.

- [ ] **Step 4: Verify Exit & Free Resources**

Before quit: save BrowserStateV2, set shutdown guard, close all windows/processes. On Linux, manual acceptance will verify:

```bash
pgrep -af 'FYPM|fypm-browser|electron'
```

returns no FYPM Electron process after exit.

- [ ] **Step 5: Write the exact acceptance document**

`FYPM_V0.4_ACCEPTANCE.md` must include:

1. ChatGPT login survives full restart.
2. Two ChatGPT tabs in one container share login.
3. Second ChatGPT container stays logged out/separate until independently authenticated.
4. Google Account A and B containers stay independent.
5. `accounts.google.com`, Gmail, Drive, Docs route within the chosen Google container family.
6. Microphone Allow survives save/restart.
7. Right-click works on page text, selected text, links, and editable fields.
8. ChatGPT copy button copies successfully.
9. Back/Forward/Reload/Ctrl+L/Ctrl+T/Ctrl+W work.
10. Upload picker works in ChatGPT.
11. Small download completes and visible download feedback appears.
12. Parking and Release inactive preserve login state.
13. Exit & Free Resources leaves no FYPM processes.
14. Previous non-temporary tabs/windows restore.
15. FYPM Browser appears in the LXQt Internet/Network menu.
16. QGIS + FYPM remains usable on the ASUS during the comparison pass.

- [ ] **Step 6: Run checks and commit**

```bash
cd desktop
npm run check
```

Commit:

```bash
git add desktop/main.js desktop/state-store.js web/app.js desktop/test-state-store.js FYPM_V0.4_ACCEPTANCE.md
git commit -m "fix: make FYPM session restore container-safe"
```

---

### Task 9: CI Build, Artifact Verification, and ASUS Install Package

**Files:**
- Modify: `.github/workflows/clipboard-hotfix-build.yml`
- Modify: `desktop/package.json` if CI exposes packaging omissions.

**Interfaces:**
- CI artifact contains the Linux x86_64 AppImage and a SHA-256 text file.

- [ ] **Step 1: Update the branch workflow**

Workflow must run on pushes to the working branch and perform:

```text
checkout
setup-node 22
cd desktop
npm install
npm run check
npm run dist:linux
sha256sum dist/FYPM-Browser-*.AppImage > dist/SHA256SUMS.txt
upload AppImage + SHA256SUMS.txt
```

- [ ] **Step 2: Push implementation commits and inspect CI**

Every check and build step must succeed. If CI fails, fix the first failing layer rather than changing unrelated code.

- [ ] **Step 3: Independently verify the produced AppImage**

After downloading the CI artifact:

```bash
sha256sum -c SHA256SUMS.txt
chmod +x FYPM-Browser-*.AppImage
./FYPM-Browser-*.AppImage --appimage-extract
```

Confirm the extracted resources contain:

```text
container-model.js
state-store.js
context-menu.js
clipboard-permissions.js
web/assets/fypm-brand.png
```

- [ ] **Step 4: Prepare the ASUS replacement commands without deleting the working fallback**

Install the new test build as:

```bash
mkdir -p "$HOME/Applications"
install -m 700 FYPM-Browser-*.AppImage "$HOME/Applications/FYPM-Browser.AppImage"
```

Keep the current `Silent-P-PWSA.AppImage` and `.old` fallback until FYPM passes the acceptance test. Do not purge Firefox until FYPM passes normal browsing, permissions, login persistence, uploads/downloads, and restart tests.

- [ ] **Step 5: Install/update the LXQt launcher and launch FYPM**

Run the launcher installer or create the equivalent desktop entry, refresh the application database, then start:

```bash
"$HOME/Applications/FYPM-Browser.AppImage"
```

- [ ] **Step 6: Execute `FYPM_V0.4_ACCEPTANCE.md` on the ASUS**

Record PASS/FAIL for each numbered item. Batch resulting defects into the next test build rather than generating a new AppImage for each individual bug.

- [ ] **Step 7: Final verification commit only if packaging corrections were required**

```bash
git add .github/workflows/clipboard-hotfix-build.yml desktop/package.json
git commit -m "ci: build verified FYPM Browser AppImage"
```

---

## Plan Self-Review

**Spec coverage:** Product naming, browser-first UI, locked artwork, persistent containers, same-container multi-tab sharing, multiple-container chooser, Google domain family, persistent permissions/microphone, right-click menu, clipboard hotfix, session restoration, Keep Active/parking semantics, upload/download support, popup inheritance, legacy data preservation, LXQt menu registration, and ASUS acceptance testing all map to explicit tasks above.

**Scope:** Long-term privacy roadmap items remain explicitly excluded so this plan produces a usable test browser rather than an unfinished security rewrite.

**Type/interface consistency:** Tabs refer to `containerId`; containers own `partitionKey`, permissions, and domain rules; `partitionForContainer()` is the single partition-selection interface; URL routing returns `open`, `choose`, or `unmatched`; manual permission changes always produce `privacyPreset: 'custom'`.

**Migration safety:** The implementation retains `silent-p-pwsa-desktop` and `com.fypm.silentpwebspace` for this release and preserves legacy `persist:silentp-tab-*` partition keys when migrating currently recoverable sessions. No task deletes old persistent partitions.
