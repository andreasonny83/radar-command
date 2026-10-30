#!/bin/sh
# Renders scripts/seo/og-image.svg to public/og-image.png (1200x630) with
# headless Chrome. Run it after editing the SVG; the PNG is checked in.
set -e
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot="$PWD/public/og-image.png" "file://$PWD/scripts/seo/og-image.svg"
