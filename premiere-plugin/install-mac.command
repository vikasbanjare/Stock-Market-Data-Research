#!/bin/bash
# CutPilot one-click installer for macOS.
# Enables CEP debug mode (required for unsigned panels) and copies the
# plugin into Premiere's extensions folder.
# If double-clicking is blocked by Gatekeeper: right-click -> Open,
# or run in Terminal:  bash install-mac.command

echo
echo " Installing CutPilot for Premiere Pro..."
echo

for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null
done

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/CutPilot"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

if [ -f "$DEST/index.html" ]; then
  echo " Done!"
  echo
  echo " 1. Restart Premiere Pro"
  echo " 2. Open:  Window > Extensions > CutPilot"
else
  echo " Something went wrong - the files did not copy."
  echo " Copy this folder manually to: $DEST"
fi
echo
read -p "Press Enter to close..."
