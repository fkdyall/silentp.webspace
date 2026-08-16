# FYPM Browser Design

Date: 2026-08-16
Status: Approved design, pending implementation plan
Branch: fix/clipboard-copy

## 1. Product identity

- Official visible product name: **FYPM Browser**.
- The phrase **Fuck You Pay Me** is part of the brand identity and may appear on the start screen/About view, but filenames, menu entries, executable names, and installer names should use the cleaner **FYPM Browser** name.
- The exact user-approved FYPM artwork from the design session is locked as the application icon and start/new-tab visual. Do not redraw, reinterpret, regenerate, recolor, or otherwise modify that artwork during implementation. If the asset is not already present in the repository at implementation time, the user will re-upload the exact approved image.
- Preserve or explicitly migrate existing Silent P application data so the rename does not strand current cookies, saved profiles, permissions, restored tabs, or login state.

## 2. Primary UX goal

FYPM Browser must feel like a familiar modern desktop browser immediately on launch while retaining stronger container isolation under the hood.

The user must be able to open FYPM Browser, type a URL in the address bar, press Enter, and browse. Container/profile configuration must not block normal navigation.

The main browser chrome should include:

- conventional horizontal tabs;
- Back, Forward, Reload;
- a large address/search field;
- New Tab;
- a compact container identity indicator;
- a compact main menu;
- normal keyboard focus and browser shortcuts.

The UI should borrow proven browser ergonomics from Chrome/Firefox without visually cloning either product. FYPM should remain visually distinct, polished, dark, and easy to understand.

## 3. Start and new-tab screen

- Use the exact approved FYPM artwork as the primary background/brand visual.
- Keep the functional area readable over the artwork.
- Show saved containers as clean shortcuts, closer to browser favorites/smart bookmarks than configuration cards.
- The user can type a URL immediately from the new-tab page.
- Advanced privacy/profile controls should not dominate the initial screen.

## 4. Container model

### 4.1 Default isolation

Each saved container is a persistent isolated browser identity with its own Electron/Chromium session partition.

A container owns its own:

- cookies;
- localStorage/session storage as applicable;
- IndexedDB/site databases;
- service workers;
- cache/session data needed for login persistence;
- site permissions;
- relevant browser/site state.

Different containers must not share this state by default.

### 4.2 Multiple tabs from one container

Multiple tabs opened from the same container share that container's session partition.

Example:

- `ChatGPT` container can open several ChatGPT tabs and all remain logged into the same ChatGPT account.
- `ChatGPT Account 2` is a separate container with a separate login.
- `Facebook` is a separate container and cannot access ChatGPT's session state.

Closing a tab does not delete its saved container. Closing FYPM Browser does not erase saved container state.

### 4.3 Address-bar routing

When the user types a URL:

- If exactly one saved container clearly matches the destination, FYPM automatically uses that container.
- If multiple saved containers match, FYPM must present a compact chooser and never silently select an identity.
- The chooser should include the matching containers plus actions for `New isolated container` and `Temporary/private`.
- A new isolated container is persistent until explicitly removed.
- A temporary/private container is disposable and must be destroyed when that temporary browsing identity is closed.

## 5. Related-domain families

A saved container may contain an explicitly related family of domains.

Example: a `Google Account A` container may share one session partition across Google-owned/required domains such as Gmail, Accounts, Drive, and Docs. `Google Account B` uses a completely separate container even though it uses the same domain family.

Rules:

- related domains share only within the selected container;
- a redirect to an arbitrary unfamiliar third-party domain must not automatically make that domain a trusted member of the family;
- OAuth/authentication popups may inherit the parent container's session as required to complete the flow without globally merging unrelated containers.

Do not add elaborate cross-container OAuth bridges unless a real compatibility case requires them.

## 6. Permission model

The current preset behavior that silently overwrites manual permissions must be removed.

Desired behavior:

- Hardened, Balanced, Compatibility, and similar presets are starting templates.
- Applying a preset populates privacy and permission defaults.
- Manually changing any setting causes the profile/container to become `Custom` rather than silently reapplying the old preset later.
- Saving must preserve the exact choices visible in the editor.
- Launching/reopening a container must use the saved resolved permissions rather than reapplying a preset and destroying overrides.
- Site permissions such as microphone, camera, location, notifications, clipboard, uploads/downloads, and popups persist across restarts unless explicitly changed or cleared.
- While viewing a site, a compact site/privacy control near the address bar should show and allow changes to the relevant permissions.

## 7. Login and persistence behavior

- A saved container remains logged in across tab closes, window closes, and full application restarts unless the website itself expires the session or the user explicitly clears/deletes the container.
- Keep Active has no effect on login persistence.
- FYPM restores the previous non-temporary windows and tabs by default on startup.
- A future setting may allow `Start with clean new tab`, but restore-previous-session is the default.

## 8. Keep Active, parking, and resource controls

- Keep Active defaults OFF.
- Keep Active controls renderer/background execution only.
- Parking or releasing a renderer must not delete persistent container state.
- Reopening a parked tab must reload using the same container identity and login.
- `Release inactive` should park eligible inactive tabs while preserving selected and Keep Active tabs.
- `Exit & Free Resources` must close all FYPM Browser renderer/application processes while saving the non-temporary session for the next launch.

## 9. Normal browser behavior

FYPM Browser should provide expected desktop browser interactions:

- right-click context menus for page text, selected text, links, and editable fields;
- Copy, Cut, Paste, Select All where appropriate;
- Open Link, Copy Link, and related navigation actions where appropriate;
- Back, Forward, Reload;
- address-bar navigation;
- Ctrl+L, Ctrl+T, Ctrl+W and other basic browser shortcuts;
- functional uploads and downloads;
- visible download feedback;
- authentication popup support scoped to the originating container;
- sane focus behavior and dialogs that do not hide behind the main window.

The existing clipboard permission hotfix must be retained.

## 10. Rename and migration

Visible/build naming should move toward:

- Product: `FYPM Browser`
- Executable: `fypm-browser`
- Linux artifact: `FYPM-Browser-<version>-linux-<arch>.AppImage`
- Desktop launcher: FYPM Browser under the Internet/Network category.

Do not casually change the internal app identity or user-data path if doing so would break access to existing Silent P data. Either retain the current internal namespace for this migration release or implement a tested migration before switching namespaces.

The first FYPM test build must preserve the user's existing browser data wherever practical.

## 11. First implementation milestone

The first FYPM Browser test AppImage should prioritize usable core behavior over completing every long-term roadmap item.

Required for the first test build:

1. FYPM Browser visible branding and browser-first main UI.
2. Conventional tab/address/navigation chrome.
3. Persistent isolated containers that can power multiple tabs.
4. Address-bar reuse of a single matching saved container.
5. Chooser when multiple saved containers match.
6. Persistent login/cookie state across restart.
7. Correct manual permission persistence and Custom-preset behavior.
8. Working microphone permission persistence.
9. Proper right-click context menus.
10. Existing clipboard fix retained.
11. Previous-session restoration.
12. Keep Active/parking semantics preserved without affecting cookies/login.
13. Functional uploads, downloads, and auth popups at the current alpha level.
14. Safe migration/retention of existing Silent P user data.
15. Use the exact approved FYPM artwork once the asset is available to the build.

## 12. Acceptance testing for the first FYPM build

The test pass must cover:

- ChatGPT login survives restart;
- two ChatGPT tabs from one container share the login;
- a second ChatGPT container remains isolated;
- multiple Google containers remain independent;
- a Google domain family stays within the chosen Google container;
- mic permission survives save/restart;
- right-click works on text, selected text, links, and input fields;
- ChatGPT copy button works;
- Back/Forward/Reload/Ctrl+L/Ctrl+T/Ctrl+W work;
- upload and download flows work;
- parking and Release inactive do not destroy login state;
- Exit & Free Resources leaves no FYPM Electron processes;
- previous non-temporary tabs/windows restore;
- app appears correctly in the LXQt Internet/Network menu;
- the ASUS remains usable while FYPM is open alongside the intended GIS workload.

## 13. Explicit non-goals for this milestone

Do not delay the first usable FYPM Browser test build for:

- LocalCDN integration;
- exhaustive fingerprint resistance;
- authenticated proxy support;
- encrypted profile exports;
- a complete maintained filter-list engine;
- Android/GeckoView work;
- unrelated codebase refactoring.

Those remain later milestones after the browser shell, isolation model, persistence, permissions, and day-to-day UX are proven on the ASUS.
