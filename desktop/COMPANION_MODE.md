# AI Companion Mode

Silent P. PWSA is intended to remain usable beside QGIS and other map-processing software.

## Current renderer model

- The application dashboard is one lightweight renderer.
- One website profile is live at a time inside the desktop browser.
- QGIS and other native applications are separate processes and may run simultaneously.
- Opening another Silent P. profile replaces the current live website renderer; it does not create another background tab.

## Map-work behavior

- Switching focus to QGIS leaves the active AI website available.
- Minimizing Silent P. PWSA leaves the active AI website loaded; Electron background throttling limits hidden-page timers where possible.
- **Release CPU** is manual. It destroys the live website renderer but preserves persistent profile cookies, storage, settings, and login state.
- **Exit for maximum CPU** is manual. It quits Silent P. PWSA completely.
- There is no tray process, startup daemon, or hidden collection of background tabs.

## Intended workflow

1. Open the AI provider in a persistent Silent P. profile.
2. Keep Silent P. PWSA open or minimized while using QGIS.
3. Return to the AI profile whenever instructions or coding help are needed.
4. Use Release CPU only during a heavy map operation when the AI is temporarily unnecessary.
5. Use full exit only when every available CPU cycle is required.

## Planned tab model

Multiple simultaneous live browser tabs are not implemented yet. A later milestone may add:

- one pinned AI companion tab that stays live;
- parked tabs whose URL and session state are saved but whose renderer is destroyed;
- an explicit per-tab Keep Live control;
- a strict cap on simultaneous live renderers.
