#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/thundersorter.xpi"

rm -f "$OUT"
cd "$SCRIPT_DIR/extension"

if command -v zip &>/dev/null; then
  zip -r "$OUT" . -x '.*'
elif command -v 7z &>/dev/null; then
  7z a -tzip "$OUT" . -x'!.*'
else
  echo "Error: need zip or 7z to build the .xpi" >&2
  exit 1
fi

echo "Built: $OUT"
