# Implementation status

| Requirement | Web PWA | Electron desktop | Android target |
|---|---:|---:|---:|
| Profile/webspace management | Implemented | Implemented | To merge into fork |
| Same-domain multiple identities | Configuration only | Real separate sessions | Native isolation required |
| Persistent sessions | Origin-local config | Implemented | Upstream capability to verify |
| Temporary sessions | New tab only | Implemented in memory | Required |
| Chromium rendering | Host browser | Electron Chromium | Android WebView |
| Gecko rendering | Not possible | Not included | GeckoView adapter planned |
| Mobile/desktop compatibility mode | Saved config | UA switch implemented | Required |
| Tracking parameter cleanup | Implemented | Implemented | Required |
| Request blocking | Not possible cross-origin | Basic host blocking | adblock-rust upstream |
| GPC/DNT | Host-browser dependent | Implemented | Required |
| Per-profile permissions | Saved config | Implemented request gates | Required |
| User-script injection | Not implemented | Next native milestone | Upstream custom JS exists |
| Home-screen shortcut independence | Profile model supports it | Not shortcut-dependent | Required |
| Import/export | Implemented | Implemented | Shared schema required |
| Good responsive UI | Implemented | Reused | Adapt into Flutter |
