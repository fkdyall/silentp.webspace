# Silent P. PWSA Desktop v0.3 Acceptance Checklist

This checklist controls the first multi-tab desktop alpha.

## 1. Tab isolation

**Technical requirement:** Every tab uses its own Electron session partition named from that tab's unique ID.

**Plain meaning:** Logging into a site in one tab must not log the same site into another tab.

Test:

1. Open two separate profiles for the same domain.
2. Sign into one tab.
3. Confirm the second tab remains signed out.
4. Repeat with cookies, local storage, service workers, and site permissions.

## 2. Multiple tabs and windows

- Open at least five tabs.
- Switch between all five without losing their URLs or settings.
- Move one tab into another window.
- Switch between both windows and QGIS.
- Close and reopen Silent P. PWSA and confirm the saved window/tab layout restores.

## 3. Keep Active / Companion behavior

**Technical requirement:** Any number of tabs may have background throttling disabled by the user.

**Plain meaning:** ChatGPT, another AI, a download, or another chosen page may keep working while another tab or QGIS is selected.

Test:

1. Mark two tabs Keep Active.
2. Start work in both tabs.
3. Switch to QGIS for several minutes.
4. Confirm both chosen tabs continued working.
5. Confirm an ordinary unselected tab was throttled.

## 4. Parking

**Technical requirement:** Parking destroys a tab's renderer while retaining its tab record and persistent session partition.

**Plain meaning:** The webpage stops using CPU and memory, but the tab identity, login storage, URL, and settings remain available when reopened.

Test:

1. Park an inactive tab.
2. Confirm its PARKED badge appears.
3. Confirm its renderer process disappears.
4. Select the tab and confirm it reloads using its original isolated identity.

## 5. Release inactive

- Keep two tabs active.
- Leave three ordinary tabs open.
- Press Release inactive.
- Confirm the two Keep Active tabs and the selected tab remain live.
- Confirm the other inactive tabs become parked.

## 6. Authentication popups

**Technical requirement:** A popup inherits only the session partition of the parent tab that opened it.

**Plain meaning:** GitHub authorization can open another window and return permission to the GitHub tab without sharing that login with unrelated tabs.

Test:

1. Set the parent tab to Balanced or Compatibility.
2. Start a GitHub or similar authorization flow.
3. Confirm the child window opens.
4. Complete authorization.
5. Confirm the parent tab receives the result.
6. Confirm unrelated tabs did not receive the login cookies.

## 7. Per-tab privacy settings

For each open tab, independently test:

- Hardened
- Balanced
- Compatibility
- Custom
- Tracking-parameter stripping
- Tracker blocking
- GPC/DNT
- WebRTC restriction
- Camera, microphone, location, clipboard, notification, upload, download, and popup permissions

Changing one tab must not change another tab.

## 8. Resource release

The public-facing control is **Exit & Free Resources**.

Test:

1. Open multiple windows and tabs.
2. Press Exit & Free Resources.
3. Confirm every Silent P. PWSA process exits.
4. Reopen the app.
5. Confirm the saved non-temporary layout restores.

## 9. CPU comparison on the ASUS

Record total CPU and memory for:

1. QGIS alone.
2. QGIS plus one AI tab.
3. QGIS plus two Keep Active tabs.
4. QGIS plus five tabs with three parked.
5. QGIS plus five live tabs.
6. Comparable Firefox or LibreWolf sessions.
7. Silent P. PWSA after Exit & Free Resources.

No claim that Silent P. PWSA is lighter than Firefox is approved until these measurements are recorded.

## 10. Current alpha boundaries

The v0.3 milestone establishes the tab/window/session architecture. It does not yet prove complete hardening. Full third-party-cookie enforcement, maintained filter-list integration, encrypted exports, LocalCDN, authenticated proxies, and exhaustive fingerprint defenses remain separate milestones.
