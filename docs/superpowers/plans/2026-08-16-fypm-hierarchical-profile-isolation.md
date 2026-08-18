# FYPM Hierarchical Profile Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FYPM Browser 0.4's per-container shared partition with persistent window profiles containing isolated site/family compartments, scoped request privacy, and bounded compatibility allowances.

**Architecture:** Pure model modules own profile/compartment identity, privacy decisions, and v2→v3 migration. Electron runtime code binds each tab to the stable partition of one compartment owned by its window profile; provider OAuth uses a provider-session popup and origin-validated callback handoff without copying storage. Existing browser behavior remains wired through the current `BrowserWindow` + `WebContentsView` shell.

**Tech Stack:** Electron 43.1.1, Node.js CommonJS, plain JavaScript/HTML/CSS, `node:assert`, electron-builder 26.15.3, Linux x86_64 AppImage.

## Global Constraints

- Work only on `feat/fypm-browser-first-test-build`; do not merge to `main`.
- Keep the existing Electron user-data path `<appData>/Silent P. PWSA` and never reset or delete legacy data during migration.
- Preserve all FYPM Browser 0.4 navigation, persistence, microphone, clipboard, context-menu, upload, download, popup, parking, and exit behavior.
- Different profiles and unrelated sites must never share a partition; no generic cookie copying.
- Compatibility and exceptions must always contain both `profileId` and `compartmentId`.
- Automatically created exceptions are temporary and omitted from saved exit state unless explicitly pinned.
- Do not overwrite `$HOME/Applications/FYPM-Browser.AppImage`.
- Build a separate Linux x86_64 test artifact and verify its extracted source against HEAD.

## File Structure

**Create**

- `desktop/profile-model.js` — profile, site compartment, provider-family, stable partition, ownership, and OAuth routing rules.
- `desktop/test-profile-model.js` — isolation, family, OAuth, ownership, and deletion-target tests.
- `desktop/privacy-policy.js` — tracker/ad classification, third-party state policy, compatibility ladder, and allowance persistence.
- `desktop/test-privacy-policy.js` — blocker and scoped compatibility tests.
- `web/ui-model.js` — pure privacy-popover and profile-manager view-model builders usable by the renderer and Node tests.
- `desktop/test-browser-ui.js` — view-model and scoped UI-action tests.
- `FYPM_HIERARCHICAL_ACCEPTANCE.md` — live ASUS test checklist for architecture and preserved 0.4 behavior.

**Modify**

- `desktop/state-store.js` / `desktop/test-state-store.js` — BrowserStateV3, safe metadata backup, idempotent v2 migration, restore filtering.
- `desktop/main.js` — profile-owned windows, compartment-owned sessions, request policy, OAuth popup handoff, scoped deletion, counters, and IPC.
- `desktop/preload.js` — profile/site/privacy management bridge.
- `desktop/security.js` — retain URL cleaning while delegating request classification to the policy module.
- `desktop/check-architecture.js` — runtime wiring invariants.
- `desktop/package.json` — add new test modules and hierarchical artifact identity.
- `web/index.html`, `web/app.js`, `web/styles.css` — profile/site-aware controls and management.

---

### Task 1: Profile, Compartment, Family, and OAuth Model

**Files:**

- Create: `desktop/profile-model.js`
- Create: `desktop/test-profile-model.js`
- Modify: `desktop/package.json`

**Interfaces:**

- Produces `normalizeProfile(input) -> Profile`.
- Produces `normalizeCompartment(input) -> SiteCompartment`.
- Produces `siteKeyForUrl(url) -> string`.
- Produces `partitionForCompartment(compartment) -> string`.
- Produces `resolveCompartment({ profile, compartments, url }) -> result`.
- Produces `oauthRoute({ profile, originCompartment, targetUrl }) -> result`.
- Produces `validateTabOwnership(profileId, compartment) -> boolean`.
- Produces `partitionKeysForProfile(profileId, compartments) -> string[]`.

- [ ] **Step 1: Write the failing isolation and family tests**

Create literal fixtures for `google-a`, `google-b`, Gmail, ChatGPT, and Example. Assert:

```js
assert.notEqual(partitionForCompartment(googleA), partitionForCompartment(googleB));
assert.notEqual(partitionForCompartment(chatgptA), partitionForCompartment(exampleA));
assert.equal(partitionForCompartment(normalizeCompartment({ ...chatgptA })), partitionForCompartment(chatgptA));
assert.equal(resolveCompartment({ profile: profileA, compartments, url: 'https://docs.google.com/' }).compartment.id, googleA.id);
assert.equal(resolveCompartment({ profile: profileB, compartments, url: 'https://docs.google.com/' }).compartment.id, googleB.id);
assert.deepEqual(oauthRoute({ profile: profileA, originCompartment: relyingPartyA, targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth' }), {
  action: 'provider', providerId: 'google', compartmentId: googleA.id
});
assert.equal(oauthRoute({ profile: profileB, originCompartment: relyingPartyA, targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth' }).action, 'deny');
assert.equal(validateTabOwnership(profileA.id, googleB), false);
assert.deepEqual(partitionKeysForProfile(profileA.id, compartments).sort(), [googleA.partitionKey, chatgptA.partitionKey, exampleA.partitionKey].sort());
```

The production changes these catch are partition derivation that omits `profileId`, broad provider suffix matching, cross-profile OAuth selection, missing ownership validation, and unscoped deletion enumeration.

- [ ] **Step 2: Run the test and verify RED**

Run: `cd desktop && node test-profile-model.js`

Expected: module-not-found failure for `./profile-model`.

- [ ] **Step 3: Implement the minimal pure model**

Use SHA-256 over `profileId + '\0' + key`, exact/boundary-aware host rules, and this explicit provider catalog:

```js
const PROVIDERS = Object.freeze({
  google: Object.freeze({
    productHosts: ['accounts.google.com', 'mail.google.com', 'drive.google.com', 'docs.google.com', 'gmail.com'],
    authHosts: ['accounts.google.com', 'oauth2.googleapis.com']
  })
});
```

Return `action: 'provider'` only if the profile authorizes the provider, the origin compartment belongs to that profile, and its compatibility level is at least 1. Preserve an explicitly supplied legacy `partitionKey`; otherwise derive `persist:fypm-v3-<32 hex>`.

- [ ] **Step 4: Run GREEN and the old model tests**

Run: `cd desktop && node test-profile-model.js && node test-container-model.js && node --check profile-model.js`

Expected: all commands exit 0.

- [ ] **Step 5: Add `test-profile-model.js` to `npm run check` and commit**

```bash
git add desktop/profile-model.js desktop/test-profile-model.js desktop/package.json
git commit -m "feat: model hierarchical profile compartments"
```

---

### Task 2: Scoped Request Privacy and Compatibility Ladder

**Files:**

- Create: `desktop/privacy-policy.js`
- Create: `desktop/test-privacy-policy.js`
- Modify: `desktop/security.js`
- Modify: `desktop/package.json`

**Interfaces:**

- Produces `classifyRequest({ url, topLevelUrl, resourceType, compartment, allowances }) -> { block, stripRequestState, stripResponseState, reason }`.
- Produces `normalizeAllowance(input) -> CompatibilityAllowance | null`.
- Produces `serializableAllowances(allowances) -> CompatibilityAllowance[]`.
- Produces `allowanceApplies(allowance, context) -> boolean`.
- Produces `isKnownTracker(url) -> boolean`.

- [ ] **Step 1: Write failing policy tests with literal request contexts**

Assert known tracker blocking, boundary safety, state stripping, and scoped allowances:

```js
assert.equal(classifyRequest({ ...ctxA, url: 'https://stats.doubleclick.net/pixel' }).block, true);
assert.equal(classifyRequest({ ...ctxA, url: 'https://notdoubleclick.net/app.js' }).block, false);
assert.equal(classifyRequest({ ...ctxA, url: 'https://cdn.example.net/app.js' }).stripRequestState, true);
assert.equal(classifyRequest({ ...ctxA, url: 'https://chatgpt.com/api' }).stripRequestState, false);
assert.equal(allowanceApplies(level2ForA, { ...ctxA, host: 'cdn.example.net', resourceType: 'xhr' }), true);
assert.equal(allowanceApplies(level2ForA, { ...ctxA, profileId: 'google-b', host: 'cdn.example.net', resourceType: 'xhr' }), false);
assert.equal(normalizeAllowance({ host: 'cdn.example.net' }), null);
assert.deepEqual(serializableAllowances([temporaryA, pinnedA]), [pinnedA]);
```

Also assert an unrelated relying-party request never receives a Google allowance and level 3 in A does not affect B.

- [ ] **Step 2: Run the test and verify RED**

Run: `cd desktop && node test-privacy-policy.js`

Expected: module-not-found failure for `./privacy-policy`.

- [ ] **Step 3: Implement the four-level decision table**

Use exact/boundary-safe tracker host rules. Determine third-party status from normalized top-level and destination site keys. At level 0 strip cross-site `Cookie`, `Authorization`, and response `Set-Cookie`; at level 1 allow only the profile's authorized auth endpoint; at level 2 require an exact matching allowance host/resource type; at level 3 allow third-party state for that compartment only. Known trackers remain blocked unless one exact pinned allowance sets `allowBlockedHost: true`.

- [ ] **Step 4: Run GREEN and syntax checks**

Run: `cd desktop && node test-privacy-policy.js && node --check privacy-policy.js && node --check security.js`

Expected: all commands exit 0.

- [ ] **Step 5: Add the policy test to `npm run check` and commit**

```bash
git add desktop/privacy-policy.js desktop/test-privacy-policy.js desktop/security.js desktop/package.json
git commit -m "feat: enforce scoped request privacy policy"
```

---

### Task 3: Version 3 State and Idempotent Migration

**Files:**

- Modify: `desktop/state-store.js`
- Modify: `desktop/test-state-store.js`

**Interfaces:**

- Produces `emptyBrowserState() -> BrowserStateV3`.
- Produces `migrateV2State(v2, options) -> BrowserStateV3`.
- Produces `loadBrowserState({ browserStatePath, v2StatePath, legacyStatePath, backupDirectory }) -> BrowserStateV3`.
- Produces `serializableBrowserState(state) -> BrowserStateV3`.
- Produces `saveBrowserState(filePath, state) -> void`.

- [ ] **Step 1: Replace state tests with failing v3 migration fixtures**

Use a v2 fixture containing Google A, Google B, two ChatGPT tabs, an unrelated Example tab incorrectly sharing Google A's old container, microphone permission, a temporary tab, and one temporary compatibility allowance. Assert literal profile/compartment counts and:

```js
assert.equal(migrated.version, 3);
assert.equal(migrated.profiles.filter((p) => p.id === 'google-a').length, 1);
assert.equal(primaryGoogleA.partitionKey, oldGoogleAPartition);
assert.notEqual(exampleA.partitionKey, oldGoogleAPartition);
assert.equal(primaryGoogleA.permissions.microphone, true);
assert.equal(migrated.windows[0].profileId, 'google-a');
assert.equal(migrated.windows[0].tabs.every((tab) => compartmentById.get(tab.compartmentId).profileId === 'google-a'), true);
assert.equal(serializableBrowserState(runtimeState).compatibilityAllowances.some((a) => a.temporary), false);
```

Write v2 to a temporary directory, call `loadBrowserState` twice, and assert one v3 profile per old container, unchanged v3 bytes on the second load, one metadata backup, and a matching SHA-256 digest. Assert private tabs do not restore and a cross-profile tab is filtered. Assert the legacy Electron user-data path is unchanged.

- [ ] **Step 2: Run the state test and verify RED**

Run: `cd desktop && node test-state-store.js`

Expected: assertion failure because current state version is 2 and no metadata backup exists.

- [ ] **Step 3: Implement atomic backup and deterministic migration**

Read v3 first. Before v2 conversion, write `<backupDirectory>/browser-state-v2-pre-hierarchical-<digest12>.json` using exclusive creation and include `{ sourceVersion, sha256, state }`. Keep the old v2 file and all partition directories untouched. Group old containers into profiles, retain the old partition only for the deterministic primary compartment, split unrelated hosts, validate window/profile/compartment ownership, and atomically rename the v3 temporary file.

- [ ] **Step 4: Run GREEN twice and the complete state-related suite**

Run: `cd desktop && node test-state-store.js && node test-state-store.js && node test-profile-model.js && node test-container-model.js`

Expected: both migration runs and all model tests exit 0.

- [ ] **Step 5: Commit**

```bash
git add desktop/state-store.js desktop/test-state-store.js
git commit -m "feat: migrate browser state to profile compartments"
```

---

### Task 4: Electron Runtime Ownership, Sessions, OAuth, and Deletion Safety

**Files:**

- Modify: `desktop/main.js`
- Modify: `desktop/check-architecture.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/package.json`

**Interfaces:**

- Consumes Tasks 1–3 model functions.
- IPC produces `profiles:list/create/update/remove`, `profiles:authorize-family`, `compartments:list/clear`, `privacy:get-active`, `compatibility:set-level`, `compatibility:add/pin/remove`.
- Existing tab/navigation/resource IPC remains available.

- [ ] **Step 1: Add failing runtime contract tests before runtime changes**

Extend pure tests to exercise exported runtime helpers moved into `profile-model.js`: `popupRouteForTarget`, `callbackBelongsToOrigin`, `headersForRequestPolicy`, and `headersForResponsePolicy`. Assert Google cookies are removed from a third-party request, an exact relying-party callback is accepted, a lookalike suffix is rejected, and upload/download permission checks remain true when enabled.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `cd desktop && node test-profile-model.js && node test-privacy-policy.js`

Expected: missing-export or assertion failures for the new runtime contracts.

- [ ] **Step 3: Implement minimal runtime helpers and run GREEN**

Implement header filtering case-insensitively, preserving non-state headers, and callback validation by exact origin. Run: `cd desktop && node test-profile-model.js && node test-privacy-policy.js`.

- [ ] **Step 4: Rewire main-process state and sessions**

Replace the global container map with `profiles`, `compartments`, and `compatibilityAllowances`. Add `profileId` to window runtime state and `compartmentId` to tabs. Resolve every `session.fromPartition()` through `partitionForCompartment()`. Configure webRequest handlers to apply request/response policy and increment the owning active tab's `blockedRequestCount`. Keep the clipboard bootstrap unchanged.

For a recognized provider popup, choose the authorized provider compartment session. On top-level navigation back to the recorded relying-party origin, prevent provider-session navigation, load the callback URL in the origin tab, then close the popup. Otherwise use the origin compartment's existing popup behavior.

- [ ] **Step 5: Preserve 0.4 file, download, context, permission, and resource paths**

Keep `will-download`, permission handlers including media types, context-menu construction, `setWindowOpenHandler`, Back/Forward/Reload, parking, Keep Active, `tabs:release-inactive`, and `app:quit-and-release`. On full exit clear runtime temporary allowances before serialization. Clearing/removing uses only `partitionKeysForProfile(profileId, compartments)` or the exact selected compartment partition.

- [ ] **Step 6: Update architecture checks and run the full check**

Architecture assertions must require profile-owned windows, compartment partitions, `onHeadersReceived` state stripping, provider popup routing, blocked counters, scoped compatibility IPC, upload/download hooks, context menus, clipboard bootstrap, and Exit & Free Resources.

Run: `cd desktop && npm run check`

Expected: exit 0 with all old and new tests and architecture checks passing.

- [ ] **Step 7: Commit**

```bash
git add desktop/main.js desktop/preload.js desktop/check-architecture.js desktop/profile-model.js desktop/privacy-policy.js desktop/test-profile-model.js desktop/test-privacy-policy.js desktop/package.json
git commit -m "feat: isolate profile-owned site sessions"
```

---

### Task 5: Profile/Site Privacy UI and Management

**Files:**

- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Create: `web/ui-model.js`
- Create: `desktop/test-browser-ui.js`
- Modify: `desktop/check-architecture.js`

**Interfaces:**

- Consumes Task 4 IPC through `window.silentP`.
- Renders active privacy state fields `profile`, `compartment`, `protectionLevel`, `blockedRequestCount`, `authorizedFamily`, `compatibilityLevel`, `temporaryAllowances`, and `pinnedAllowances`.

- [ ] **Step 1: Add a failing DOM behavior check**

Create `web/ui-model.js` as a UMD-style pure module exporting `privacyViewModel(state)`, `profileManagerViewModel({ profile, compartments, allowances })`, and `scopedAllowanceAction(action, profileId, compartmentId, allowanceId)`. Create `desktop/test-browser-ui.js` requiring that module. Assert a literal privacy fixture returns Google A, Gmail, Hardened, 7 blocked, Google, level 1, and its temporary host. Assert profile management returns only that profile's compartments/allowances and that action payloads contain exact `profileId`, `compartmentId`, and `allowanceId` values for pin/remove actions.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `cd desktop && node test-browser-ui.js`

Expected: module-not-found or missing-export failure.

- [ ] **Step 3: Implement the profile/site-aware chrome**

Rename user-facing "container" concepts to Profile and Site Compartment. Expand the near-address privacy popover with all required state. Add compatibility level control and temporary allowance list. Expand management with authorized families, persistent compartments, clear-site action, remove-profile action, and pin/remove allowance controls. Keep the ordinary new-tab/address UI dominant.

- [ ] **Step 4: Run UI, syntax, and complete checks**

Run: `cd desktop && node test-browser-ui.js && node --check ../web/ui-model.js && node --check ../web/app.js && npm run check`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/app.js web/styles.css web/ui-model.js desktop/test-browser-ui.js desktop/check-architecture.js desktop/package.json
git commit -m "feat: expose profile site privacy controls"
```

---

### Task 6: Regression Coverage and ASUS Acceptance Guide

**Files:**

- Modify: `desktop/test-clipboard-permissions.js`
- Modify: `desktop/test-context-menu.js`
- Modify: `desktop/check-architecture.js`
- Create: `FYPM_HIERARCHICAL_ACCEPTANCE.md`

**Interfaces:**

- Tests the final contracts from Tasks 1–5 and documents live-only checks.

- [ ] **Step 1: Add failing regression assertions where behavior is not yet covered**

Add direct assertions for microphone permission persistence, clipboard sanitized write/read normalization, upload and download permission results, link/editable/text context menus, temporary restore filtering, exact profile restore ownership, and inability to produce an unscoped compatibility allowance.

- [ ] **Step 2: Run targeted regression tests and verify any new assertion fails for its intended missing behavior**

Run: `cd desktop && node test-clipboard-permissions.js && node test-context-menu.js && node test-state-store.js && node test-profile-model.js && node test-privacy-policy.js`

Expected: each newly introduced missing behavior fails before its corresponding minimal correction; existing behaviors may pass and must not be rewritten solely to force RED.

- [ ] **Step 3: Make only the minimal corrections needed and run GREEN**

Run the same targeted command until it exits 0, then run `cd desktop && npm run check`.

- [ ] **Step 4: Write the live ASUS acceptance guide**

Include all 20 architecture checks plus real Google A/B sign-in, third-party Google OAuth, ChatGPT persistence/Copy, microphone capture, upload picker foreground behavior, a real download, context menus, process exit, LXQt launcher, and QGIS coexistence. Use `PASS`, `FAIL`, or `BLOCKED` fields and record artifact SHA-256.

- [ ] **Step 5: Commit**

```bash
git add desktop/test-clipboard-permissions.js desktop/test-context-menu.js desktop/check-architecture.js FYPM_HIERARCHICAL_ACCEPTANCE.md
git commit -m "test: cover hierarchical isolation regressions"
```

---

### Task 7: Full Verification, Separate AppImage, Source Inspection, and Push

**Files:**

- Modify: `desktop/package.json` only if needed to make the artifact name unambiguously hierarchical-test.
- Generated (not committed): `desktop/dist/*.AppImage`, extracted AppImage directory, SHA-256 report.

**Interfaces:**

- Consumes the complete source tree at final HEAD.
- Produces a separate x86_64 AppImage, extracted-source comparison, size, and SHA-256.

- [ ] **Step 1: Verify repository scope and complete test suite**

Run:

```bash
git status --short
git diff 24c8d6a9b84f3d90c38b6ecb7682f7fc352df45a --check
cd desktop && npm run check
```

Expected: only intended work, no whitespace errors, all tests exit 0.

- [ ] **Step 2: Build without touching the working AppImage**

Run: `cd desktop && npm run dist:linux -- --x64`

Copy the resulting artifact only to `$HOME/Applications/FYPM-Browser-hierarchical-test.AppImage` after explicit filesystem approval. Never write `$HOME/Applications/FYPM-Browser.AppImage`. If approval is unavailable, keep the artifact under `desktop/dist/` and report that path.

- [ ] **Step 3: Extract and inspect the artifact**

Run the built AppImage with `--appimage-extract` in a new `/tmp/fypm-hierarchical-inspect-*` directory. Unpack `resources/app.asar` with the project-local `asar` implementation. Compare every packaged application source file named in `desktop/package.json` and every `web/` extra resource against HEAD using SHA-256/file comparison. Read packaged `package.json` and verify product, version, app ID, executable, and artifact name.

- [ ] **Step 4: Record artifact evidence**

Run `stat --printf='%s' <artifact>` and `sha256sum <artifact>`. Record the absolute path, byte size, human-readable size, and digest.

- [ ] **Step 5: Commit any final packaging-only correction after rerunning tests/build inspection**

```bash
git add desktop/package.json
git commit -m "build: name hierarchical test artifact"
```

Skip this commit if no tracked packaging correction was required.

- [ ] **Step 6: Push the current feature branch without merging**

Run: `git push -u origin feat/fypm-browser-first-test-build`.

If rejected because the remote moved, fetch and inspect divergence; do not force-push, reset, or rebase without user direction.

- [ ] **Step 7: Produce the completion report**

Report branch, final SHA, commit list, changed files, exact test counts/results, all architecture checks, AppImage path/size/SHA-256, migration/backup/idempotence behavior, blocker and compatibility behavior, and remaining live ASUS tests.
