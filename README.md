# Agent Deck

Mirabox HSV293S (or any OpenDeck device) as a control surface for coding agents
(Claude Code, Codex, OpenCode, Pi) running in [herdr](https://herdr.dev).

## Layout

| Profile | Keys |
|---|---|
| **Home** | status per agent (Claude, Codex, OpenCode, Pi), Approve, Stop, menus: Launch, Projects, Prompts, Agent, Git |
| **Launch** | start a new agent in a pane next to the focused one; VS Code on the focused folder or on each project |
| **Projects** | open/focus a herdr workspace per project (from `deck.local.mjs`) |
| **Prompts** | canned prompts typed into the focused agent |
| **Agent** | Approve, Deny, Stop, Ctrl+C, mode toggle, clear/compact/model/resume (mapped per agent) |
| **Git** | status, diff, log, branches, pull, PR in browser (helper pane), commit / open PR (via agent) |

Status keys: spinning green ring = working, yellow = waiting for approval, grey = idle, "Off" = none running.

## How it works

- `agentdeck.sdPlugin/` — OpenDeck plugin (Node 22, no dependencies). Polls `herdr agent list`,
  and acts through `herdr agent focus|send-keys|prompt|start`, `herdr pane split|run`, `herdr workspace`.
- `hooks/deck-hook.mjs` — Claude Code hooks write `~/.claude/deck-status/<session>.json`, so Claude
  sessions outside herdr (desktop app) also light up the Claude key.
- `deck.config.mjs` — layout and key behavior (shared). `deck.local.mjs` — projects and terminal app
  for this machine (not committed; start from `deck.local.example.mjs`).
- `scripts/install.mjs` — closes OpenDeck, installs the plugin, generates profiles for every connected
  deck, registers hooks, restarts OpenDeck. Previous profiles are backed up next to them.

## Install

Requirements: OpenDeck ≥ 2.5 with the device plugin (`opendeck-akp153` for HSV293S), Node ≥ 22, herdr
with the integrations for your agents (`herdr integration install claude|codex|opencode|pi`).

```sh
cp deck.local.example.mjs deck.local.mjs   # edit projects + terminal
./install.sh                                # macOS
```

```powershell
Copy-Item deck.local.example.mjs deck.local.mjs
.\install.ps1                               # Windows (untested)
```

Re-run the installer after editing the config. `--no-hooks` / `-NoHooks` leaves `~/.claude/settings.json` alone.

## Windows notes (untested)

- The plugin starts through `bin/main.js` with OpenDeck's Node.js runtime.
- `terminal` in `deck.local.mjs` is a window title for `AppActivate` (e.g. `Windows Terminal`).
- The device plugin author lists Windows as "zero effort" support.
