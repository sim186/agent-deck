#!/bin/sh
# macOS: install Agent Deck into OpenDeck. Pass --no-hooks to leave Claude Code settings alone.
set -e
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
DECK_NODE="$NODE" exec "$NODE" "$(cd "$(dirname "$0")" && pwd)/scripts/install.mjs" "$@"
