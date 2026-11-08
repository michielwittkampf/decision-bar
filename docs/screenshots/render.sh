#!/usr/bin/env bash
# Renders the README screenshots (docs/*.png) from the pages in this folder, at twice the size for
# sharp text. Needs Google Chrome and Python with Pillow; uses the font of the installed desktop app.
# Usage: docs/screenshots/render.sh [name ...]   (default: all pages)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/.."
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

names=("$@")
[ ${#names[@]} -eq 0 ] && names=(main box collapsed many)

for name in "${names[@]}"; do
  page="$here/$name.html"
  # Width from the page (html width in px); height generous, trimmed afterwards.
  width=$(sed -n 's/.*html, body { width: \([0-9]*\)px.*/\1/p' "$page" | head -1)
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=2 --window-size="${width},900" --virtual-time-budget=2000 \
    --screenshot="$tmp/$name.png" "file://$page" >/dev/null 2>&1
  # Cut off the empty page below the content (rows equal to the page colour).
  python3 - "$tmp/$name.png" "$out/$name.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
bg = im.getpixel((w - 1, h - 1))
px = im.load()
bottom = h
near = lambda c: max(abs(a - b) for a, b in zip(c, bg)) <= 6  # a soft shadow counts as empty
while bottom > 1 and all(near(px[x, bottom - 1]) for x in range(0, w, 2)):
    bottom -= 1
im.crop((0, 0, w, min(h, bottom + 12))).save(sys.argv[2], optimize=True)
PY
  echo "docs/$name.png"
done
