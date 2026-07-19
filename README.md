# Silent P. Progressive Webspace App

**Display name:** Silent P. PWSA  
**Repository:** `silentp.webspace`  
**Android package ID:** `com.fypm.silentpwebspace`  
**Short project name:** Silent P. PWA

This repository is the working cross-platform project structure.

## What is functional in this revision

### Web / Vercel PWA
- Responsive polished profile dashboard
- Webspaces and multiple profiles for the same site
- Persistent local profile configuration
- Tracking-parameter cleanup
- Import/export
- PWA manifest, offline shell, and install icons
- Honest web-runtime boundaries

### Desktop native shell
- Electron 43 desktop wrapper
- Real per-profile Chromium sessions using `persist:silentp-<profile-id>`
- In-memory disposable sessions for temporary profiles
- Navigation toolbar
- Desktop/mobile user-agent switching
- Permission request gates
- Global Privacy Control and DNT request headers
- Basic request interception and tracker-host blocking
- Detached Chromium DevTools
- Linux AppImage and Debian package build targets
- Windows NSIS and portable build targets

## Important remaining work

- Replace the basic tracker host list with `adblock-rust` or a maintained filter-list engine
- Add encrypted exports and optional encrypted profile storage
- Test cookie/storage isolation across a full matrix
- Implement stronger third-party-cookie policy
- Add authenticated proxy profiles
- Add LocalCDN
- Finish the Android WebSpace fork and optional GeckoView backend
- Add automated UI and security regression tests

## Run the desktop build

```bash
cd desktop
npm install
npm run check
npm start
```

## Build Linux packages

```bash
cd desktop
npm install
npm run dist:linux
```

Artifacts appear under `desktop/dist/`.

## Web preview

Serve the `web/` directory over HTTP:

```bash
python3 -m http.server 8080 --directory web
```

Then open `http://127.0.0.1:8080`.
