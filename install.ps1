# Windows: install Agent Deck into OpenDeck. Pass -NoHooks to leave Claude Code settings alone.
param([switch]$NoHooks)
$ErrorActionPreference = 'Stop'
$extra = @(); if ($NoHooks) { $extra += '--no-hooks' }
$env:DECK_NODE = (Get-Command node).Source
node (Join-Path $PSScriptRoot 'scripts\install.mjs') @extra
