#!/bin/sh
# Renders assets/feature-graphic.svg to assets/feature-graphic.png (1024x500,
# the Google Play feature graphic) with headless Chrome. Run it after editing
# the SVG; the PNG is checked in.
set -e
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1024,500 \
  --screenshot="$PWD/assets/feature-graphic.png" "file://$PWD/assets/feature-graphic.svg"
