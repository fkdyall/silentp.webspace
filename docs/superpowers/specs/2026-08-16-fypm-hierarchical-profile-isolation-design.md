# FYPM Hierarchical Profile Isolation Design

Date: 2026-08-16
Status: Approved for implementation
Branch: `feat/fypm-browser-first-test-build`
Baseline: FYPM Browser 0.4 at `24c8d6a9b84f3d90c38b6ecb7682f7fc352df45a`

## 1. Objective and invariants

FYPM Browser will replace its single-level container model with a hierarchy:

```text
Window = persistent profile container
  Tab = isolated child site compartment
    Electron session partition = storage boundary for that profile + site/site-family
```

A profile is one project or account identity. Every ordinary window belongs to exactly one persistent profile for its lifetime. Every tab belongs to that window's profile and to one child site compartment. A tab cannot silently change profiles. Moving or detaching a tab creates or uses a window owned by the same profile.

The following invariants are mandatory:

- Different profiles never share an Electron partition, even for the same site or identity provider.
- Unrelated sites in one profile never share an Electron partition.
- Tabs for the same site compartment in one profile reuse one stable persistent partition.
- Explicitly authorized identity/site families may share one family compartment inside one profile.
- No implementation copies cookies or browser databases between partitions.
- Temporary profiles, compartments, tabs, allowances, and browser state are not restored.
- Relaxing one profile and site cannot change any other profile, site, or global default.
- Removing or clearing one profile cannot address another profile's partitions.
- FYPM keeps the legacy Electron `userData` path: `<appData>/Silent P. PWSA`.

## 2. State model

Browser state advances from version 2 to version 3.

```js
BrowserStateV3 = {
  version: 3,
  migration: {
    sourceVersion: 2,
    migrationId: 'hierarchical-profile-isolation-v1',
    completedAt: number,
    metadataBackupPath: string
  } | null,
  profiles: Profile[],
  compartments: SiteCompartment[],
  windows: WindowRecord[],
  compatibilityAllowances: CompatibilityAllowance[]
}
```

`Profile` contains profile-wide presentation and identity authorization, not a shared cookie jar:

```js
Profile = {
  id: string,
  name: string,
  color: string,
  authorizedFamilies: AuthorizedFamily[],
  createdAt: number,
  updatedAt: number
}
```

`SiteCompartment` is the persistent storage and permission unit:

```js
SiteCompartment = {
  id: string,
  profileId: string,
  key: string,
  name: string,
  primaryUrl: string,
  siteRules: DomainRule[],
  familyId: string | null,
  partitionKey: string,
  protectionLevel: 'hardened' | 'custom',
  compatibilityLevel: 0 | 1 | 2 | 3,
  permissions: PermissionMap,
  privacy: PrivacySettings,
  persistent: boolean,
  temporary: boolean,
  createdAt: number,
  updatedAt: number
}
```

`WindowRecord` contains `profileId`. Its tabs contain `compartmentId`; both are checked during load and runtime. A tab whose compartment does not belong to its window's profile is rejected rather than repaired by cross-profile reassignment.

Partition names are deterministic and opaque:

```text
persist:fypm-v3-<sha256(profileId + NUL + compartmentKey).first32hex>
fypm-temp-v3-<random-id>
```

The stable `compartmentKey` is a normalized exact site key or an authorized family key. Existing migrated compartments may retain a legacy `partitionKey` to preserve safe authentication state. New profiles never reuse a migrated legacy key.

## 3. Site and family resolution

Navigation resolution is profile-scoped. FYPM normalizes the destination host and resolves it in this order:

1. An exact authorized family domain match in the current profile.
2. An existing persistent site compartment whose exact/suffix rule matches.
3. A new site compartment for the normalized site key.

Rules are boundary-aware (`host === rule` or `host.endsWith('.' + rule)`). Arbitrary redirects never add domains to a family or compartment. Multiple user-created matching compartments require a chooser; FYPM never silently selects an identity.

The initial built-in provider catalog contains an explicit Google family. It is data, not generic suffix inference:

- provider ID: `google`
- user-visible family: Google
- first-party product hosts: `accounts.google.com`, `mail.google.com`, `drive.google.com`, `docs.google.com`, `gmail.com`
- narrowly required authentication hosts: `accounts.google.com`, `oauth2.googleapis.com`

The implementation may include exact Google static/resource hosts only when required for a tested sign-in flow. It must not authorize all `google.com` subdomains or all `googleapis.com` hosts by suffix. A profile authorizes the Google family explicitly. Google A and Google B therefore have separate Google family partitions.

## 4. OAuth and provider continuity

A Google-family tab uses its profile's Google family compartment directly. A third-party site remains in its own site partition.

For a third-party "Sign in with Google" popup:

1. FYPM recognizes an exact authorized Google authentication endpoint.
2. The originating profile must authorize Google and the requesting site must be at compatibility level 1 or higher.
3. FYPM opens the provider leg with that profile's Google family session, not the third-party session.
4. FYPM watches the popup's top-level navigation. When it returns to an origin/callback URL belonging to the requesting site, FYPM prevents the provider-session window from loading the callback and navigates the originating site tab to that URL in its own compartment.
5. The popup closes after handoff.

Only the callback URL and normal OAuth artifacts encoded by the provider are handed back. Cookies, localStorage, IndexedDB, cache, service workers, and other provider storage are never copied. An unrelated third party therefore receives no Google cookie header and cannot enumerate Google browser storage.

Unrecognized providers or callback origins use the originating compartment and receive no family authorization. Popup and redirect failures produce a visible notice and do not create a permanent allowance.

## 5. Request privacy policy

Each configured Electron session receives a request policy bound to exactly one compartment. Policy evaluation uses the compartment, top-level site, request destination, resource type, and current compatibility allowances.

At every level FYPM:

- preserves HTTP(S) main frames, downloads, uploads, WebSockets, media, and first-party resources unless a known blocking rule applies;
- sends Global Privacy Control and DNT when enabled;
- strips known navigation tracking parameters when enabled;
- blocks known advertising and tracking request hosts using a maintained-in-repository deterministic rule set;
- increments a per-tab blocked-request count exposed to browser chrome.

For cross-site subrequests, hardened mode removes `Cookie` and related ambient authentication request headers and removes `Set-Cookie` response headers unless an exact allowance applies. This prevents unnecessary third-party tracking state in addition to the partition boundary. It does not block ordinary stateless CDN resources.

The blocker distinguishes exact host and boundary-safe suffix rules. It never uses substring matching. Allow rules are evaluated before state stripping but do not silently disable the known tracker/ad block list. A user-pinned level-3 site allowance may explicitly permit a named otherwise-blocked host; this remains scoped to one `(profileId, compartmentId)`.

## 6. Compatibility ladder

Compatibility is stored and evaluated for one profile and one site compartment:

| Level | Name | Behavior |
|---|---|---|
| 0 | Hardened | Known trackers blocked; cross-site cookie request/response state stripped; no provider-session popup inheritance. |
| 1 | Authentication allowance | Level 0 plus exact authorized provider endpoints and OAuth provider-session handoff. |
| 2 | Narrow functional third-party allowance | Level 1 plus explicitly named third-party domains and resource types that may carry state for this site. |
| 3 | Site compatibility mode | Broad third-party state allowed only for this one site compartment; known tracker/ad rules remain blocked unless an exact pinned host override exists. |

`CompatibilityAllowance` includes `profileId`, `compartmentId`, exact `host`, allowed resource types, level, reason, `temporary`, `pinned`, and timestamps. Missing profile or compartment scope is invalid. There is no global compatibility mutation API.

Automatically created allowances are temporary and memory-resident by default. `Exit & Free Resources` clears them. Normal serialization omits them unless `pinned === true`. Persistent authentication consists of provider/site partition state and explicit `authorizedFamilies`; it is not represented as a temporary allowance and survives restart. The user can pin or remove a compatibility allowance explicitly.

## 7. Permissions and preserved browser behavior

Microphone, camera, location, notifications, clipboard, uploads, downloads, and popup choices move from the old container to each site compartment. Resolved permissions persist and are never overwritten merely by reopening a compartment. A manual change makes protection `custom`.

The existing clipboard permission wrappers remain installed before `main.js`, including Electron's `clipboard-sanitized-write` and deprecated clipboard-read normalization. Existing context-menu construction, file chooser behavior, download events, navigation controls, renderer parking, Keep Active, and popup parent/foreground behavior remain intact.

Back, Forward, Reload, address-bar navigation, Ctrl+L/T/W/R, context menus, ChatGPT Copy, uploads, downloads, authentication windows, session restoration, parking, Release inactive, and Exit & Free Resources remain browser-first behaviors. Storage isolation must not be coupled to renderer lifetime.

## 8. Browser chrome and management

The site/privacy control beside the address bar shows:

- current profile;
- current site compartment;
- protection level;
- blocked request count for the active tab;
- authorized identity family/provider, or none;
- compatibility level;
- temporary allowances with their hosts and reasons.

The profile manager shows profile name, authorized identity/site families, persistent compartments, temporary exceptions, and pinned allowances. It supports clear site data, remove profile, pin allowance, and remove allowance.

Destructive actions require explicit confirmation. Clearing a site addresses only its resolved partition. Removing a profile first closes only that profile's windows/tabs, then clears only partitions whose stored `profileId` equals that profile, and finally removes its records. Partition targets are enumerated from validated state; broad paths, globs, and unrelated partitions are never used.

## 9. Restore and temporary lifecycle

Every saved ordinary window restores with its `profileId`; every saved ordinary tab restores with its `compartmentId`. Restore validates ownership before creating any renderer. A detached tab opens a new window with the same profile.

Temporary/private tabs use non-persistent random partitions and are excluded from state. Temporary-only windows are excluded. Closing the last tab for a temporary compartment clears its storage/cache and drops its runtime records. `Exit & Free Resources` saves ordinary state, discards all temporary compatibility allowances, closes renderer processes, and quits.

## 10. Migration from FYPM 0.4

Migration is deterministic, idempotent, and non-destructive:

1. Continue using the legacy Electron user-data directory without renaming it.
2. Prefer a valid v3 state file. If it exists, do not rerun migration.
3. Otherwise read v2 state. Before writing v3, atomically write a timestamped metadata backup containing the source state and a SHA-256 digest. Never delete or rewrite old Chromium partition directories.
4. Convert each old 0.4 container into one profile with the same stable ID/name/color.
5. Convert the old container's primary site or explicit Google domain set into its primary compartment. Retain the old `partitionKey` only for that primary compartment so Electron can safely preserve its login/session data.
6. Convert each restored tab into a compartment selected deterministically by its host. Tabs on unrelated hosts receive distinct new partitions; they do not inherit the legacy cookie jar. Tabs that match the primary legacy compartment retain its authentication state.
7. Preserve permissions on the primary compartment and copy resolved permission defaults to newly split compartments without copying browser storage.
8. Write v3 atomically, including the fixed migration ID and backup path.

Repeated load returns the existing v3 object and creates neither duplicate profiles nor duplicate compartments. If migration or backup writing fails, FYPM leaves v2 and legacy partitions untouched and reports the failure rather than attempting destructive recovery.

## 11. Testing strategy

Pure modules define and test identity, partition derivation, family resolution, request policy, compatibility serialization, deletion targeting, and migration. Runtime wiring is tested through exported helpers where practical and guarded by architecture assertions for Electron-specific event hookup.

Tests must prove at least:

1. Google A and Google B receive different persistent partitions.
2. Unrelated sites in one profile receive different partitions and storage identities.
3. The same site in one profile reuses its partition after serialization/reload.
4. Authorized Google-family sites resolve to Google A's family compartment.
5. Google B remains independent.
6. OAuth selects only the intended profile/provider partition and callback origin.
7. An unrelated third party receives no Google cookie state.
8. Temporary compatibility allowances are omitted on full-exit serialization.
9. Authorized family state and persistent compartments survive.
10. Temporary/private tabs and temporary-only windows do not restore.
11. Restored tabs validate against the correct parent profile.
12. v2 migration is idempotent and backs up metadata before v3 write.
13. Microphone permission persistence remains covered.
14. Clipboard permission normalization/writes remain covered.
15. Upload and download enabling/runtime wiring remain covered.
16. Context-menu actions remain covered.
17. Known tracker/ad requests are blocked with boundary-safe rules.
18. Compatibility relaxation is scoped by profile and compartment.
19. No API or serialized allowance can silently become global.
20. Profile deletion targets cannot include another profile's compartment.

The complete old `npm run check` suite plus all new tests must pass. The separate Linux x86_64 AppImage must be extracted, its packaged application source compared with HEAD source, and its SHA-256 recorded.

## 12. Delivery constraints and live testing

The feature branch is pushed but never merged to `main` by this work. The build must not overwrite `$HOME/Applications/FYPM-Browser.AppImage`. The test artifact is installed separately as `$HOME/Applications/FYPM-Browser-hierarchical-test.AppImage` when filesystem permission is granted; otherwise it remains at a clearly reported workspace path for the user to install.

Automated checks do not replace live ASUS validation. Remaining live checks include real Google A/B sign-in, Google OAuth on a third-party relying party, ChatGPT login persistence and Copy, microphone capture, native upload picker foreground behavior, a real download, context menus against live content, process exit, LXQt launch, and QGIS coexistence/resource pressure.
