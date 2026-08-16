#!/usr/bin/env bash
set -euo pipefail

applications_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
launcher_path="${applications_dir}/fypm-browser.desktop"
appimage_path="${HOME}/Applications/FYPM-Browser.AppImage"

mkdir -p "${applications_dir}"

sed \
  -e "s|@EXEC@|${appimage_path}|g" \
  > "${launcher_path}" <<'DESKTOP_ENTRY'
[Desktop Entry]
Type=Application
Name=FYPM Browser
Comment=Browse with persistent isolated identities
Exec=@EXEC@
Terminal=false
Categories=Network;WebBrowser;
StartupNotify=true
StartupWMClass=FYPM Browser
DESKTOP_ENTRY

chmod 644 "${launcher_path}"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${applications_dir}" || true
fi

printf 'Installed FYPM Browser launcher at %s\n' "${launcher_path}"
