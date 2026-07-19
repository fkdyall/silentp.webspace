# Android native target

The Android app is **not** a wrapper around the Vercel page. It must fork:

- Upstream: `https://github.com/theoden8/webspace_app`
- Project repository: `https://github.com/fkdyall/silentp.webspace`
- Package ID: `com.fypm.silentpwebspace`
- Official name: `Silent P. Progressive Webspace App`
- Display name: `Silent P. PWSA`

## Required implementation sequence

1. Fork and build the untouched upstream project.
2. Replace upstream branding and all non-reusable artwork.
3. Change Android application ID and Flutter package identifiers.
4. Port the shared profile schema from `../shared/profile-schema.json`.
5. Verify independent cookie, cache, local-storage, service-worker, and permission state for:
   - different domains;
   - duplicate profiles of the same domain;
   - persistent profiles;
   - temporary profiles.
6. Make profile controls apply regardless of home-screen shortcut status.
7. Preserve upstream ClearURLs, adblock-rust, HaGeZi, LocalCDN, JavaScript injection, and proxy functionality.
8. Add compatibility escalation:
   - mobile Chromium/WebView;
   - compatibility settings;
   - modified desktop Chromium/WebView;
   - GeckoView profile where supported;
   - explicit external fallback as last resort.
9. Add GeckoView only as a real renderer. A Firefox user-agent string is not Gecko support.
10. Build unsigned development APKs through GitHub Actions, then configure protected release signing.

See `../STATUS.md` for the shared implementation matrix.
