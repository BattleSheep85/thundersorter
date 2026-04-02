#!/usr/bin/env bash
set -euo pipefail

# Usage: ./release.sh 0.3.0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
REPO="BattleSheep85/thundersorter"

if [[ -z "$VERSION" ]]; then
  echo "Usage: ./release.sh <version>"
  echo "Example: ./release.sh 0.3.0"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install it from https://cli.github.com"
  exit 1
fi

# --- Safety: verify no secrets in tracked files ---

if git grep -l 'AIza\|sk-ant-\|sk-proj-\|sk-or-' -- ':!.env*' ':!.gitignore' 2>/dev/null; then
  echo "ERROR: Possible API key found in tracked files. Aborting."
  exit 1
fi

# --- Bump version in manifest.json ---

cd "$SCRIPT_DIR"

sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" extension/manifest.json
echo "Bumped extension/manifest.json to $VERSION"

# --- Build .xpi ---

./build.sh
echo "Built thundersorter.xpi"

# --- Compute hash for update verification ---

XPI_HASH=$(sha256sum thundersorter.xpi | cut -d' ' -f1)
echo "SHA-256: $XPI_HASH"

# --- Update updates.json with hash ---

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/thundersorter.xpi"

cat > updates.json <<EOF
{
  "addons": {
    "thundersorter@local": {
      "updates": [
        {
          "version": "$VERSION",
          "update_link": "$DOWNLOAD_URL",
          "update_hash": "sha256:$XPI_HASH",
          "applications": {
            "gecko": {
              "strict_min_version": "128.0"
            }
          }
        }
      ]
    }
  }
}
EOF
echo "Updated updates.json for v$VERSION"

# --- Commit, tag, push ---

git add extension/manifest.json updates.json
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin main --tags

echo "Pushed v$VERSION to GitHub"

# --- Create GitHub release with .xpi ---

gh release create "v$VERSION" \
  thundersorter.xpi \
  --title "v$VERSION" \
  --notes "Thundersorter v$VERSION"

echo ""
echo "Done! Release v$VERSION is live."
echo "Thunderbird will pick up the update automatically."
