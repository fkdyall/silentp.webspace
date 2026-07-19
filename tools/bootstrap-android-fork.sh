#!/usr/bin/env bash
set -euo pipefail

UPSTREAM="https://github.com/theoden8/webspace_app.git"
TARGET_DIR="${1:-android-native}"
ORIGIN="https://github.com/fkdyall/silentp.webspace.git"

if [[ -e "$TARGET_DIR" ]]; then
  echo "Refusing to overwrite existing path: $TARGET_DIR" >&2
  exit 1
fi

git clone "$UPSTREAM" "$TARGET_DIR"
cd "$TARGET_DIR"
git remote rename origin upstream
git remote add origin "$ORIGIN"
git checkout -b silentp/main

cat <<EOF
Android upstream cloned successfully.

Upstream remote: $UPSTREAM
Project origin:  $ORIGIN
Branch:          silentp/main

Push when ready:
  git push -u origin silentp/main
EOF
