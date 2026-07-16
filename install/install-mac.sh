#!/usr/bin/env bash
# Lantern — macOS launcher. Double-click, or run:  bash install-mac.sh
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Lantern needs Node.js (a free tool that runs it)."
  echo "  1. Go to https://nodejs.org"
  echo "  2. Download the LTS version and install it."
  echo "  3. Run this file again."
  echo ""
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then
  echo "  Your Node.js is too old ($(node -v)). Update it at https://nodejs.org, then try again."
  exit 1
fi

echo "  Starting Lantern… your browser will open."
node "$DIR/bin/lantern.js"
