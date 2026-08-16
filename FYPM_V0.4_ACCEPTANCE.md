# FYPM Browser 0.4 ASUS Acceptance Test

Target: ASUS laptop, Debian 13 x86_64, LXQt

Do not remove the working Silent P AppImage or Firefox during this test cycle. FYPM Browser 0.4 deliberately retains the legacy internal application identity so it can reuse existing Silent P user data.

## Install

```bash
mkdir -p "$HOME/Applications"
install -m 700 FYPM-Browser-0.4.0-alpha.1-linux-x86_64.AppImage "$HOME/Applications/FYPM-Browser.AppImage"
./tools/install-fypm-launcher.sh
"$HOME/Applications/FYPM-Browser.AppImage"
```

Record `PASS`, `FAIL`, or `BLOCKED` beside every test and add brief notes for failures.

## Required pass

1. **ChatGPT login survives a full restart** — Status: ____
   - Open ChatGPT in a saved `ChatGPT` container and sign in if needed.
   - Choose **Exit & Free Resources**, relaunch FYPM Browser, and confirm the restored ChatGPT tab is still signed in.

2. **Two ChatGPT tabs in one container share login** — Status: ____
   - Open a second ChatGPT tab using the `ChatGPT` container.
   - Confirm both tabs show the same signed-in account without a second login.

3. **A second ChatGPT container stays isolated** — Status: ____
   - Create `ChatGPT Account 2` for `chatgpt.com`.
   - Confirm it starts signed out and stays independent after signing into a different account.

4. **Google Account A and B remain independent** — Status: ____
   - Create two Google containers and sign each into a different account.
   - Restart FYPM Browser and confirm each container restores the correct account.

5. **The Google domain family routes safely** — Status: ____
   - In each Google container, visit `accounts.google.com`, `mail.google.com`, `drive.google.com`, and `docs.google.com`.
   - With two matching Google containers, confirm FYPM always shows the chooser and never silently selects an account.

6. **Microphone Allow survives save and restart** — Status: ____
   - Open the site-permission control, allow Microphone, and confirm the template changes to Custom.
   - Exit, relaunch, reopen the permission control, and confirm Microphone is still allowed.

7. **Right-click menus match the clicked content** — Status: ____
   - Check ordinary text, selected text, a link, and an editable field.
   - Confirm appropriate Copy/Cut/Paste/Select All, Open Link/Copy Link, and Back/Forward/Reload actions appear.

8. **ChatGPT Copy works** — Status: ____
   - Use ChatGPT's response Copy button and paste the copied text into a local editor.

9. **Browser controls and shortcuts work** — Status: ____
   - Verify Back, Forward, Reload, Ctrl+L, Ctrl+T, and Ctrl+W.

10. **Upload picker works and stays in front** — Status: ____
    - Attach a small non-sensitive file in ChatGPT and cancel or complete the upload.
    - Confirm the picker is not hidden behind FYPM Browser.

11. **Download feedback is visible** — Status: ____
    - Download a small safe file.
    - Confirm the download chip shows progress/completion and the file exists at the chosen/default destination.

12. **Parking and Release inactive preserve login** — Status: ____
    - Park a signed-in ChatGPT tab, reopen it, and confirm it remains signed in.
    - Mark one inactive tab Keep Active, choose Release inactive, and confirm the selected and Keep Active tabs remain live while other inactive tabs park.

13. **Exit & Free Resources leaves no FYPM processes** — Status: ____
    - Choose Exit & Free Resources, then run:

      ```bash
      pgrep -af 'FYPM|fypm-browser|electron'
      ```

    - Ignore the `pgrep` command itself; no FYPM Browser/Electron process should remain.

14. **Previous non-temporary session restores** — Status: ____
    - Leave several ordinary tabs open, plus one temporary/private tab.
    - Exit and relaunch. Confirm ordinary tabs/windows restore and the temporary tab does not.

15. **LXQt launcher is correct** — Status: ____
    - Confirm FYPM Browser appears under Internet/Network and launches `$HOME/Applications/FYPM-Browser.AppImage`.

16. **QGIS comparison workload remains usable** — Status: ____
    - Open the normal QGIS project/workload beside FYPM Browser.
    - Exercise several tabs, park inactive tabs, and record responsiveness and memory pressure compared with the previous build.

## Test notes

- Tester/date:
- AppImage SHA-256:
- Failures or surprises:
- Follow-up build priorities:
