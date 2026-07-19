# Silent P. PWSA CPU Policy

The desktop build is optimized around CPU availability for GIS and map workloads, not minimum installation size.

## Runtime rules

1. Only one website renderer may exist at a time.
2. Saved profiles that are not open have no renderer and perform no website work.
3. Chromium background throttling remains enabled for both the control interface and active website renderer.
4. Minimizing the application destroys the active website renderer automatically.
5. **Release CPU** destroys the active renderer immediately while preserving the persistent profile's cookies, storage, permissions, and configuration.
6. **Map mode** closes the renderer and exits Silent P. PWSA completely.
7. The application has no tray process, startup service, scheduled background task, or background-tab pool.
8. Closing the final window exits the application on Linux and Windows.
9. GPU acceleration remains enabled. Disabling it can shift WebGL and page-rendering work onto the CPU, which is counterproductive for the mapping use case.

## What can and cannot be promised

A website actively rendering in Chromium can consume substantial CPU, especially animated pages, video, WebGL, and browser-based maps. Silent P. PWSA cannot make the same active website inherently cheaper than every Firefox configuration.

The measurable advantage targeted here is narrower:

- fewer loaded sites;
- no inactive tab renderers;
- immediate destruction of the active renderer when released;
- complete process exit for map work;
- persistent login state without keeping the website running.

## ASUS acceptance test

Test on the ASUS G74Sx under the intended Debian desktop.

Record CPU and resident memory in these states after a two-minute settling period:

1. Silent P. PWSA closed.
2. Silent P. PWSA dashboard open with no website renderer.
3. One ordinary website open.
4. The same website after pressing **Release CPU**.
5. Silent P. PWSA after pressing **Map mode**.
6. Firefox or LibreWolf with the comparable site and configuration, only as a benchmark.
7. QGIS or the selected map workload alone.
8. QGIS or the selected map workload while Silent P. PWSA is in each state above.

## Passing criteria

- **Map mode:** no Silent P. PWSA or Electron processes remain.
- **Released state:** no website renderer process remains.
- **Dashboard idle:** sustained CPU should settle near zero; investigate any repeated wakeups.
- **Minimized:** active website renderer is destroyed, not merely hidden.
- **Map workload:** no material measurable slowdown after Map mode is engaged.

No browser replacement decision is final until this test is completed with an actual packaged build.
