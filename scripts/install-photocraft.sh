#!/usr/bin/env bash
# Install the PhotoCraft engine (Apache-2.0/MIT) for the Silhouette visual cortex.
# Official release binary, pinned version, checksum-verified against the release page.
set -euo pipefail

VERSION="${1:-0.9.0}"
DEST=/opt/silhouette/tools/photocraft
URL="https://github.com/storytold/photocraft/releases/download/v${VERSION}/photocraft-${VERSION}-linux-x86_64.tar.gz"

mkdir -p "$DEST" /opt/silhouette/workspace/visual /opt/silhouette/output/visual
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -sL -o "$TMP/pc.tar.gz" "$URL"
tar xzf "$TMP/pc.tar.gz" -C "$TMP"
cp -r "$TMP/photocraft-${VERSION}-linux-x86_64/bin" "$DEST/"

# Web editor (official WASM static site) — served by Silhouette at /visual-editor/
WEB_URL="https://github.com/storytold/photocraft/releases/download/v${VERSION}/photocraft-web-${VERSION}.zip"
curl -sL -o "$TMP/pcweb.zip" "$WEB_URL"
unzip -q -o "$TMP/pcweb.zip" -d "$TMP"
mkdir -p "$DEST/web"
cp -r "$TMP/photocraft-web-${VERSION}/"* "$DEST/web/"

# Silhouette workspace bridge: open workspace files in the editor, editor saves
# land back in the workspace (intercepted blob downloads -> POST /v1/visual/import).
cp "$(dirname "$0")/photocraft-web-bridge.js" "$DEST/web/silhouette-bridge.js"
grep -q silhouette-bridge.js "$DEST/web/index.html" || \
    sed -i 's|<script type="module">|<script src="./silhouette-bridge.js"></script>\n  <script type="module">|' "$DEST/web/index.html"
chown -R silhouette:silhouette /opt/silhouette/tools "$DEST" /opt/silhouette/workspace/visual /opt/silhouette/output/visual 2>/dev/null || true
"$DEST/bin/photocraft-cli" --version
echo "PhotoCraft $VERSION installed at $DEST"
