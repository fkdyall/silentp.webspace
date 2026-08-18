# FYPM Browser Hierarchical Isolation ASUS Acceptance Test

Target: ASUS laptop, Debian 13 x86_64, LXQt
Test artifact: `$HOME/Applications/FYPM-Browser-hierarchical-test.AppImage`

Do not replace `$HOME/Applications/FYPM-Browser.AppImage`. Do not clear or remove the existing Silent P/FYPM data directory. Record `PASS`, `FAIL`, or `BLOCKED` beside every item.

## Artifact and startup

1. **Separate artifact and checksum** — Status: ____
   - Confirm the test artifact has the SHA-256 reported by the build handoff.
   - Confirm the working `$HOME/Applications/FYPM-Browser.AppImage` remains unchanged.

2. **Migration is non-destructive and one-time** — Status: ____
   - Launch the test build against the existing legacy user-data path.
   - Confirm profiles/tabs appear once, then exit and relaunch twice.
   - Confirm no duplicate profiles/compartments appear and `migration-backups/` contains the v2 metadata backup.

## Hierarchical isolation

3. **Google A and Google B storage differs** — Status: ____
   - Open one window for Google A and another for Google B.
   - Sign into different Google accounts, restart, and confirm each restores the intended account.

4. **Unrelated sites inside one profile are isolated** — Status: ____
   - In Google A, open ChatGPT and an unrelated test site.
   - Confirm neither site sees the other's cookies or site storage using its own UI/devtools where available.

5. **Same site in one profile retains its session** — Status: ____
   - Open two ChatGPT tabs in the same profile and confirm they share login.
   - Exit & Free Resources, relaunch, and confirm the login persists.

6. **Google family continuity in Google A** — Status: ____
   - Authorize Google for Google A.
   - Visit Accounts, Gmail, Drive, and Docs and confirm the Google A identity continues across those authorized products.

7. **Google B remains isolated** — Status: ____
   - Repeat the family flow in Google B and confirm it never changes or exposes Google A.

8. **Third-party Sign in with Google is scoped** — Status: ____
   - Set one relying-party compartment to compatibility level 1.
   - Complete its Google sign-in popup and confirm it uses the current profile's authorized Google identity.
   - Repeat in Google B and confirm it uses Google B.

9. **Unrelated third party receives no Google state** — Status: ____
   - Browse an unrelated site at level 0.
   - Confirm it does not arrive signed into Google and receives no Google cookie state.

10. **Compatibility never becomes global** — Status: ____
    - Raise one Google A site to level 2 or 3.
    - Confirm the same site in Google B and another site in Google A remain at their prior levels.

11. **Temporary exception exit lifecycle** — Status: ____
    - Create or observe a temporary compatibility exception.
    - Use Exit & Free Resources, relaunch, and confirm the exception is gone while Google authorization/login remains.

12. **Pin/remove allowance** — Status: ____
    - Pin a temporary allowance, restart, and confirm it remains only on that profile/site.
    - Remove it and confirm it disappears without affecting other sites.

13. **Profile deletion is scoped** — Status: ____
    - Create disposable Test A and Test B profiles with independent sessions.
    - Remove Test A and confirm Test B's windows, compartments, and login remain.

## FYPM 0.4 regressions

14. **Microphone persistence** — Status: ____
    - Allow microphone for a site, restart, and confirm the choice remains.
    - Make a real microphone capture and confirm audio input works.

15. **ChatGPT Copy/clipboard** — Status: ____
    - Use ChatGPT's response Copy button and paste into a local editor.
    - Also verify right-click Copy and editable-field Paste.

16. **Context menus** — Status: ____
    - Right-click plain text, selected text, a link, and an editable field.
    - Confirm Back/Forward/Reload, Copy, Cut, Paste, Select All, Open Link, and Copy Link appear where appropriate.

17. **Navigation and shortcuts** — Status: ____
    - Verify Back, Forward, Reload, Ctrl+L, Ctrl+T, Ctrl+W, Ctrl+R, Alt+Left, and Alt+Right.

18. **Upload picker** — Status: ____
    - Attach a small non-sensitive file in ChatGPT.
    - Confirm the native picker remains in front and cancel or finish the upload.

19. **Download** — Status: ____
    - Download a small safe file.
    - Confirm progress/completion feedback and the downloaded file.

20. **Parking and Keep Active** — Status: ____
    - Park/reopen a signed-in tab and confirm login remains.
    - Mark an inactive tab Keep Active, release inactive tabs, and confirm selected/kept tabs remain live.

21. **Restore ownership and private exclusion** — Status: ____
    - Leave ordinary tabs open across at least two profile windows plus a temporary/private tab.
    - Restart and confirm each ordinary tab returns under the correct profile and the private tab does not restore.

22. **Exit & Free Resources** — Status: ____
    - Exit through the menu, then run `pgrep -af 'FYPM|fypm-browser|electron'`.
    - Ignore the `pgrep` process itself; no FYPM Electron processes should remain.

23. **Normal browser-first interface** — Status: ____
    - Confirm typing/searching, tabs, controls, downloads, and site privacy remain immediately usable without profile setup blocking navigation.

24. **LXQt and QGIS coexistence** — Status: ____
    - Launch the separate hierarchical test artifact without changing the working launcher.
    - Run the normal QGIS workload beside FYPM, exercise several tabs and parking, and record responsiveness/memory pressure.

## Test record

- Tester/date:
- Commit SHA:
- AppImage SHA-256:
- Failures or surprises:
- Follow-up priorities:
