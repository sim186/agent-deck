# Agent Deck

Mirabox HSV293S (or any OpenDeck device) as a control surface for coding agents
(Claude Code, Codex, OpenCode, Pi) running in [herdr](https://herdr.dev).

## Layout

On the Mirabox HSV293SV3 OpenDeck shows a 6x3 grid: 5x3 pressable keys plus a
display-only screen in the right column. The screen shows two status tiles (Claude; Codex, OpenCode and Pi)
and, in the bottom row, the time with a countdown to your next Outlook meeting, in every profile.

## Note
This layout fits exactly my use case and my workflow, you can ask your agents to adapt it to your needs.

![Home layout](docs/layout.svg)

The deck is meant to sit left of the keyboard: Dictate and Rec are in the far-left column, Approve/Deny next to the screen.
Regenerate the image after changing the layout with `node scripts/layout-svg.mjs`.

| Profile | Keys |
|---|---|
| **Home** | Launch, Projects, Prompts, Deny, Approve · Dictate, Git, Meeting, Stop, Agent · Rec, Commit, Agenda, Agents (overall status, press to focus the most urgent), Review diff |
| **Launch** | start a new agent in a pane next to the focused one; VS Code on the focused folder or on each project |
| **Projects** | open/focus a herdr workspace per project (from `deck.local.mjs`) |
| **Prompts** | canned prompts typed into the focused agent, incl. the `team-activity` skill for yourself (yesterday / last week) and the pi `worktime-calc` skill (runs in the background with GLM 5.3 Flash, answer opens as markdown) |
| **Agenda** | next Outlook meetings (time + title); press one and GLM 5.3 Flash (opencode, background) writes a briefing and opens it |
| **Agent** | Approve, Stop, mode toggle, plus one tile per running herdr agent (project, kind, state; press to jump to it). "More": Deny, Ctrl+C, clear/compact/model/resume (mapped per agent), Dictate AI / Cancel |
| **Meeting** | Rec (toggle), Summary (re-run the summary), last transcript, meetings folder |
| **Git** | status, diff, log, branches, pull, PR in browser (helper pane), commit / open PR (via agent) |

Status tiles: spinning green ring = working, yellow = waiting for approval, grey = idle, "Off" = none running.
Dictate keys toggle [Handy](https://github.com/cjpais/Handy) (`handy --toggle-transcription`); the text is typed into the focused window.
Meetings: Rec records the mic (plus an optional loopback device for system audio) with ffmpeg in
5-minute 16 kHz WAV parts under `~/Documents/Meetings/<date_time>/`; Stop transcribes them locally with
`handy --transcribe-file` into `transcript.md`. After transcription OpenCode (`opencode run -m opencode-go/glm-5.3-flash`, headless) writes `summary.md` next to it; change the model with `summaryModel` in `meetings`. Tell participants you are recording.
Agenda reads the published Outlook calendar (ICS link, set `calendar` in `deck.local.mjs`; it is private, so that file stays uncommitted).
Other decks: set `device` (and optionally `screen`) in `deck.local.mjs`.

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

Requirements: ffmpeg (for meetings), OpenDeck ≥ 2.5 with the device plugin (`opendeck-akp153` for HSV293S), Node ≥ 22, herdr
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
