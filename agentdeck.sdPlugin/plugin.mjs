// Agent Deck: OpenDeck / Stream Deck plugin for driving coding agents through herdr.
//
// State comes from two sources, merged per agent kind:
//   - herdr (`herdr agent list`): every agent running in a herdr pane, any kind.
//   - Claude Code hooks (../hooks/deck-hook.mjs): one JSON file per session in
//     STATE_DIR, for sessions outside herdr (e.g. the Claude desktop app).
// Every key's behavior is driven by its settings, which profiles/build.mjs bakes
// into the OpenDeck profiles, so this process needs no config file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { dotPng, spinnerPng, tilePng, dataUrl } from './png.mjs';
import { herdr, listAgents, snapshot } from './herdr.mjs';

const STATE_DIR = path.join(os.homedir(), '.claude', 'deck-status');
const NS = 'com.simone.agentdeck.';
const POLL_MS = 1000;
const FRAMES = 12;
const FRAME_MS = 110;

// Most urgent first. A hook session that stops updating is treated as idle after `staleMs`.
const LOOK = {
  waiting: { rgb: [245, 180, 0], word: 'Approve', staleMs: 4 * 3600e3 },
  working: { rgb: [46, 204, 113], word: 'Working', staleMs: 20 * 60e3 },
  idle: { rgb: [70, 70, 70], word: 'Idle', staleMs: Infinity },
};
const PRIORITY = ['waiting', 'working', 'idle'];
const FROM_HERDR = { blocked: 'waiting', working: 'working', idle: 'idle', done: 'idle', unknown: 'idle' };

const IMAGES = {
  waiting: [dataUrl(dotPng(144, LOOK.waiting.rgb))],
  working: Array.from({ length: FRAMES }, (_, i) => dataUrl(spinnerPng(144, LOOK.working.rgb, (i / FRAMES) * Math.PI * 2))),
  idle: [dataUrl(dotPng(144, LOOK.idle.rgb, { glow: false }))],
};
const tileCache = new Map();
const tile = (hex) => {
  if (!tileCache.has(hex)) tileCache.set(hex, dataUrl(tilePng(144, hex.match(/\w\w/g).map((h) => parseInt(h, 16)))));
  return tileCache.get(hex);
};

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];

// context -> { action, settings, last }
const keys = new Map();
let agents = [];
let frame = 0;
let anim = null;

// ---------- state ----------

function hookSessions() {
  let names = [];
  try { names = fs.readdirSync(STATE_DIR).filter((n) => n.endsWith('.json')); } catch { return []; }
  const now = Date.now();
  const out = [];
  for (const name of names) {
    const file = path.join(STATE_DIR, name);
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      const age = now - (s.updatedAt ?? 0);
      if (age > 24 * 3600e3) { fs.rmSync(file, { force: true }); continue; }
      if (s.herdrPane) continue; // herdr already reports this session
      if (!LOOK[s.state] || age > LOOK[s.state].staleMs) s.state = 'idle';
      out.push({ kind: 'claude', state: s.state, bundleId: s.bundleId, updatedAt: s.updatedAt });
    } catch { /* half-written or foreign file: skip */ }
  }
  return out;
}

function sessions() {
  const fromHerdr = agents.filter((a) => a.agent).map((a) => ({
    kind: a.agent, state: FROM_HERDR[a.agent_status] ?? 'idle', pane: a.pane_id, focused: a.focused,
  }));
  return [...fromHerdr, ...hookSessions()];
}

function summarize(list) {
  for (const state of PRIORITY) {
    const hits = list.filter((s) => s.state === state);
    if (hits.length) return { state, count: hits.length };
  }
  return { state: 'idle', count: 0 };
}

// ---------- drawing ----------

const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
const setImage = (context, image) => send({ event: 'setImage', context, payload: { image, target: 0 } });
const setTitle = (context, title) => send({ event: 'setTitle', context, payload: { title, target: 0 } });

function statusFace(key) {
  const { action, settings } = key;
  const all = sessions();
  if (action === 'approve') {
    const n = all.filter((s) => s.state === 'waiting').length;
    return { state: n ? 'waiting' : 'idle', title: n > 1 ? `Approve ${n}` : 'Approve' };
  }
  const mine = settings.kind ? all.filter((s) => s.kind === settings.kind) : all;
  const sum = summarize(mine);
  const word = mine.length ? LOOK[sum.state].word : 'Off';
  return { state: sum.state, title: `${settings.label ?? 'Agents'}\n${sum.count > 1 ? `${word} ${sum.count}` : word}` };
}

const isStatus = (key) => key.action === 'status' || key.action === 'approve';

function paint(context, force = false) {
  const key = keys.get(context);
  if (!key) return;
  if (!isStatus(key)) {
    if (force) {
      setImage(context, tile(key.settings.color ?? '#5a5a5a'));
      setTitle(context, key.settings.label ?? '');
    }
    return;
  }
  const face = statusFace(key);
  const sig = `${face.state}|${face.title}`;
  if (!force && sig === key.last) return;
  key.last = sig;
  key.state = face.state;
  setImage(context, IMAGES[face.state][frame % IMAGES[face.state].length]);
  setTitle(context, face.title);
}

function repaintAll() {
  for (const c of keys.keys()) paint(c);
  animate();
}

// Frame loop runs only while some visible key is in an animated state.
function animate() {
  const moving = [...keys.values()].some((k) => isStatus(k) && IMAGES[k.state ?? 'idle'].length > 1);
  if (moving && !anim) {
    anim = setInterval(() => {
      frame++;
      for (const [c, k] of keys) if (isStatus(k) && IMAGES[k.state].length > 1) setImage(c, IMAGES[k.state][frame % FRAMES]);
    }, FRAME_MS);
  } else if (!moving && anim) {
    clearInterval(anim);
    anim = null;
  }
}

// ---------- actions ----------

// Pick the agent a key press should act on: the one the user is looking at in
// herdr if it qualifies, otherwise the first agent in one of `states`.
function pick(snap, { states, kind } = {}) {
  let list = snap.agents.filter((a) => a.agent && (!kind || a.agent === kind));
  if (states) list = list.filter((a) => states.includes(a.agent_status));
  return list.find((a) => a.pane_id === snap.focusedPane) ?? list.find((a) => a.focused) ?? list[0];
}

function raiseTerminal(settings) {
  const app = settings.terminal;
  if (!app) return;
  if (process.platform === 'darwin') execFile('/usr/bin/open', ['-b', app], () => {});
  else if (process.platform === 'win32') {
    execFile('powershell.exe', ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate('${app.replace(/'/g, "''")}')`], { windowsHide: true }, () => {});
  }
}

const textFor = (value, kind) => (typeof value === 'string' ? value : value?.[kind] ?? value?.default);

// Cwd for new panes: the focused pane's, falling back to home.
function focusedCwd(snap) {
  const p = snap.panes.find((x) => x.pane_id === snap.focusedPane);
  return p?.foreground_cwd ?? p?.cwd ?? os.homedir();
}

const runPanes = new Map(); // workspace id -> pane we opened for commands

const ACTIONS = {
  async status({ settings }) {
    const snap = await snapshot();
    const a = pick(snap, { states: ['blocked'], kind: settings.kind })
      ?? pick(snap, { states: ['working'], kind: settings.kind })
      ?? pick(snap, { kind: settings.kind });
    if (a) {
      await herdr('agent', 'focus', a.pane_id);
      return raiseTerminal(settings);
    }
    // Not in herdr: bring forward the app hosting the newest hook session (Claude desktop).
    const s = hookSessions().filter((x) => !settings.kind || x.kind === settings.kind).sort((x, y) => y.updatedAt - x.updatedAt)[0];
    if (s?.bundleId && process.platform === 'darwin') execFile('/usr/bin/open', ['-b', s.bundleId], () => {});
  },

  async approve() {
    const a = pick(await snapshot(), { states: ['blocked'] });
    if (a) await herdr('agent', 'send-keys', a.pane_id, 'enter');
  },

  async keys({ settings }) {
    const snap = await snapshot();
    const a = pick(snap, settings.states ? { states: settings.states } : {});
    const keysFor = a && textFor(settings.keys, a.agent);
    if (keysFor) await herdr('agent', 'send-keys', a.pane_id, ...[keysFor].flat());
  },

  async prompt({ settings }) {
    const snap = await snapshot();
    const a = pick(snap, { states: ['idle', 'done', 'unknown'] }) ?? pick(snap);
    const text = a && textFor(settings.text, a.agent);
    if (!text) return;
    await herdr('agent', 'prompt', a.pane_id, text);
    await herdr('agent', 'focus', a.pane_id);
    raiseTerminal(settings);
  },

  async launch({ settings }) {
    const snap = await snapshot();
    const name = `${settings.kind}-${Date.now().toString(36).slice(-4)}`;
    let pane;
    if (snap.focusedPane) {
      pane = (await herdr('pane', 'split', snap.focusedPane, '--direction', 'right', '--cwd', focusedCwd(snap), '--focus'))?.pane?.pane_id;
    } else {
      pane = (await herdr('workspace', 'create', '--cwd', os.homedir(), '--focus'))?.root_pane?.pane_id;
    }
    if (!pane) return;
    await herdr('agent', 'start', name, '--kind', settings.kind, '--pane', pane);
    raiseTerminal(settings);
  },

  async project({ settings }) {
    const dir = settings.path.replace(/^~(?=$|[\\/])/, os.homedir());
    const label = settings.label ?? path.basename(dir);
    const existing = ((await herdr('workspace', 'list'))?.workspaces ?? []).find((w) => w.label === path.basename(dir));
    if (existing) {
      await herdr('workspace', 'focus', existing.workspace_id);
    } else {
      const res = await herdr('workspace', 'create', '--cwd', dir, '--label', path.basename(dir), '--focus');
      const pane = res?.root_pane?.pane_id;
      if (pane && settings.agent) await herdr('agent', 'start', `${settings.agent}-${label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'p'}`, '--kind', settings.agent, '--pane', pane);
    }
    raiseTerminal(settings);
  },

  // Open VS Code on a project folder, or on the focused herdr pane's folder when no path is set.
  async editor({ settings }) {
    const dir = settings.path
      ? settings.path.replace(/^~(?=$|[\\/])/, os.homedir())
      : focusedCwd(await snapshot());
    if (process.platform === 'darwin') execFile('/usr/bin/open', ['-a', 'Visual Studio Code', dir], () => {});
    else if (process.platform === 'win32') execFile('cmd.exe', ['/c', 'code', dir], { windowsHide: true }, () => {});
    else execFile('code', [dir], () => {});
  },

  // Run a shell command (git etc.) in a helper pane next to the focused one, reusing it per workspace.
  async run({ settings }) {
    const snap = await snapshot();
    if (!snap.focusedPane) return;
    const ws = snap.focusedWorkspace;
    let pane = runPanes.get(ws);
    if (!pane || !snap.panes.some((p) => p.pane_id === pane && p.agent_status === 'unknown')) {
      pane = (await herdr('pane', 'split', snap.focusedPane, '--direction', 'down', '--cwd', focusedCwd(snap), '--no-focus'))?.pane?.pane_id;
      if (!pane) return;
      runPanes.set(ws, pane);
    }
    await herdr('pane', 'run', pane, settings.command);
    raiseTerminal(settings);
  },
};

ws.onopen = () => send({ event: args.registerEvent, uuid: args.pluginUUID });
ws.onclose = () => process.exit(0);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (!m.action?.startsWith(NS)) return;
  const action = m.action.slice(NS.length);
  switch (m.event) {
    case 'willAppear':
      keys.set(m.context, { action, settings: m.payload?.settings ?? {} });
      paint(m.context, true);
      animate();
      break;
    case 'willDisappear':
      keys.delete(m.context);
      animate();
      break;
    case 'didReceiveSettings':
      if (keys.has(m.context)) { keys.get(m.context).settings = m.payload?.settings ?? {}; paint(m.context, true); }
      break;
    case 'keyDown':
      Promise.resolve(ACTIONS[action]?.({ settings: m.payload?.settings ?? {} }))
        .catch((err) => console.error(`${action}: ${err.message}`))
        .finally(() => setTimeout(poll, 300));
      break;
  }
};

async function poll() {
  agents = await listAgents();
  repaintAll();
}

fs.mkdirSync(STATE_DIR, { recursive: true });
let timer;
fs.watch(STATE_DIR, () => { clearTimeout(timer); timer = setTimeout(repaintAll, 80); });
setInterval(poll, POLL_MS);
poll();
