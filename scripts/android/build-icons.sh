#!/bin/sh
# Renders the SVG sources in assets/ to the PNGs @capacitor/assets wants, then
# generates every Android launcher icon and splash size into android/.
# Run after editing assets/*.svg; the generated files are checked in.
set -e
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
render() { # name size background
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color="$3" \
    --window-size="$2,$2" --screenshot="$PWD/assets/$1.png" "file://$PWD/assets/$1.svg" >/dev/null 2>&1
}
render icon-only 1024 FF0F172A
render icon-foreground 1024 00000000
render icon-background 1024 FF0F172A
render splash 2732 FF0F172A
cp assets/splash.png assets/splash-dark.png
npx capacitor-assets generate --android --iconBackgroundColor '#0f172a' --splashBackgroundColor '#0f172a' \
  --iconBackgroundColorDark '#0f172a' --splashBackgroundColorDark '#0f172a'
