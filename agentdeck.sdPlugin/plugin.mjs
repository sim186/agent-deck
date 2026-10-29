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
import { dotPng, spinnerPng, tilePng, micPng, dataUrl } from './png.mjs';
import { herdr, listAgents, snapshot } from './herdr.mjs';
import { meeting, onMeetingChange, startMeeting, stopMeeting, summarizeMeeting, lastTranscript, meetingsRoot, clock } from './meeting.mjs';
import { upcoming, hhmm, describe } from './calendar.mjs';
import { runHeadless, outputDir } from './headless.mjs';
import { askDialog } from './dialog.mjs';
import { activeReminderId, shouldShowReminder } from './rec-reminder.mjs';
import { limit, refreshLimits } from './limits.mjs';
import { audio, refreshAudio, changeVolume, toggleMic } from './audio.mjs';

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
let agenda = []; // upcoming Outlook meetings, refreshed by refreshAgenda()
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
  if (action === 'agentlist') return tileFace(settings.index ?? 0);
  const all = sessions();
  if (action === 'approve') {
    const n = all.filter((s) => s.state === 'waiting').length;
    return { state: n ? 'waiting' : 'idle', title: n > 1 ? `Approve ${n}` : 'Approve' };
  }
  const kinds = kindsOf(settings);
  const mine = kinds ? all.filter((s) => kinds.includes(s.kind)) : all;
  const sum = summarize(mine);
  const word = mine.length ? LOOK[sum.state].word : 'Off';
  return { state: sum.state, title: `${settings.label ?? 'Agents'}\n${sum.count > 1 ? `${word} ${sum.count}` : word}` };
}

// A status key covers one kind (`kind`), several (`kinds`), or every agent (neither).
const kindsOf = (settings) => settings.kinds ?? (settings.kind ? [settings.kind] : null);

const isStatus = (key) => key.action === 'status' || key.action === 'approve' || key.action === 'agentlist';

// ---- agent tiles (Agent menu): one per herdr agent, in a stable order ----
const KIND_SHORT = { claude: 'Cl', codex: 'Cx', opencode: 'OC', pi: 'Pi' };
const STATE_WORD = { waiting: 'Ask', working: 'Work', idle: 'Idle' };
let workspaces = new Map(); // workspace_id -> { label, number }

const agentTiles = () => agents
  .filter((a) => a.agent)
  .sort((x, y) => (workspaces.get(x.workspace_id)?.number ?? 99) - (workspaces.get(y.workspace_id)?.number ?? 99) || x.pane_id.localeCompare(y.pane_id));

function tileFace(index) {
  const a = agentTiles()[index];
  if (!a) return { state: 'idle', title: '-', empty: true };
  const state = FROM_HERDR[a.agent_status] ?? 'idle';
  const project = workspaces.get(a.workspace_id)?.label ?? path.basename(a.cwd ?? '') ?? '?';
  return { state, title: `${marquee(project)}\n${KIND_SHORT[a.agent] ?? a.agent.slice(0, 2)} ${STATE_WORD[state]}${a.focused ? ' <' : ''}` };
}

// Dictation keys show what we last asked Handy to do. Handy has no state query, so
// this drifts if you also use Handy's own shortcut; Cancel resets it.
let listening = false;
const LISTENING = dataUrl(dotPng(144, [235, 64, 52]));

const REC = dataUrl(dotPng(144, [235, 64, 52]));
const BUSY = dataUrl(dotPng(144, [245, 180, 0]));
const REMINDER_FRAMES = Array.from({ length: FRAMES }, (_, i) => dataUrl(micPng(144, i / FRAMES)));

function meetingFace() {
  switch (meeting.state) {
    case 'recording': return { image: REC, title: clock(Date.now() - meeting.startedAt) };
    case 'stopping':
    case 'transcribing': return { image: BUSY, title: `Transcr.${meeting.progress ? ` ${meeting.progress}` : ''}` };
    case 'summarizing': return { image: BUSY, title: 'Summary\n...' };
    default: return { image: tile('#eb4034'), title: meeting.error ? 'Rec\nerror' : 'Rec' };
  }
}

// Display tile: wall clock plus how close the next meeting is. Colour warns as it nears.
// Debug: the file `~/.claude/deck-status/test-meeting` pretends a meeting is running now,
// so the whole-deck Rec flash can be tested without touching the calendar.
const testMeeting = () => fs.existsSync(path.join(STATE_DIR, 'test-meeting'));
function clockFace() {
  const now = Date.now();
  const time = hhmm(now);
  const m = testMeeting() ? { start: now - 1, subject: 'TEST' } : agenda[0];
  if (!m) return { title: `${time}\nfree`, color: '#2a2a2a' };
  if (m.start <= now && meeting.state === 'idle') return { title: `${time}\nin meeting\nREC?`, color: '#eb4034' };
  if (m.start <= now) return { title: `${time}\nin meeting`, color: '#eb4034' };
  const mins = Math.ceil((m.start - now) / 60e3);
  let when;
  if (mins < 60) when = `in ${mins} min`;
  else if (mins < 24 * 60) when = `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}`;
  else when = new Date(m.start).toLocaleDateString('en-GB', { weekday: 'short' });
  const color = mins <= 5 ? '#eb4034' : mins <= 15 ? '#f5b400' : mins <= 30 ? '#4f8cff' : '#2a2a2a';
  return { title: `${time}\n${when}\n${m.subject.length > 9 ? `${m.subject.slice(0, 8)}.` : m.subject}`, color };
}

// Provider usage tile: how much of a limit window is left and when it resets. Colour warns as it fills.
const LIMIT_NAME = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };
const WINDOW_NAME = { session: '5h', weekly: 'week', monthly: 'month' };
function timeLeft(ms) {
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60e3));
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}
function limitFace(settings) {
  const window = settings.window ?? 'weekly';
  const head = `${LIMIT_NAME[settings.provider] ?? settings.provider}\n${WINDOW_NAME[window]}`;
  const v = limit(settings.provider, window, settings);
  if (v.used == null) return { title: `${head}\n${v.error ?? '...'}`, color: '#2a2a2a' };
  const left = Math.max(0, Math.min(100, Math.round(100 - v.used)));
  const color = v.error ? '#2a2a2a' : left <= 10 ? '#eb4034' : left <= 30 ? '#c98a00' : '#1f7a46';
  return { title: `${head}\n${left}% left${v.resetsAt ? `\n${timeLeft(v.resetsAt)}` : ''}`, color };
}

// Titles wider than a key scroll sideways: a pause on the start, then one character per tick.
const MARQUEE_WIDTH = 9;
let marqueeTick = 0;
function marquee(text) {
  if (text.length <= MARQUEE_WIDTH) return text;
  const loop = `${text}   `;
  const off = Math.max(0, marqueeTick - 4) % loop.length;
  return (loop + loop).slice(off, off + MARQUEE_WIDTH);
}

// Agenda tiles pick their colour from the meeting's day: happening now = red,
// today = blue, tomorrow = amber, further out = grey.
function meetingColor(m) {
  const now = Date.now();
  if (m.start <= now) return '#eb4034';
  const day = (t) => new Date(t).toDateString();
  if (day(m.start) === day(now)) return '#4f8cff';
  if (day(m.start) === day(now + 864e5)) return '#f5b400';
  return '#8a8a8a';
}

// Volume keys show the speaker level; the Mic key turns red while the microphone is muted.
function audioFace(settings) {
  if (settings.mode === 'mic') {
    const muted = audio.mic === 'muted';
    return { title: `Mic\n${audio.mic ? (muted ? 'muted' : 'on') : '-'}`, color: muted ? '#eb4034' : settings.color ?? '#5a5a5a' };
  }
  const level = audio.volume == null ? '-' : audio.muted ? 'muted' : `${audio.volume}%`;
  return { title: `${settings.label ?? 'Vol'}\n${level}`, color: settings.color ?? '#5a5a5a' };
}

function paint(context, force = false) {
  const key = keys.get(context);
  if (!key) return;
  if (key.action === 'meeting' && key.settings.mode?.startsWith('reminder-')) {
    const record = key.settings.mode === 'reminder-record';
    setImage(context, record ? REMINDER_FRAMES[reminderFrame] : tile('#000000'));
    setTitle(context, record ? 'Record\nmeeting?' : '');
    return;
  }
  if (key.busy) {
    key.last = null;
    setImage(context, BUSY);
    setTitle(context, 'Working...');
    return;
  }
  if (key.action === 'dictate' && key.settings.mode !== 'cancel') {
    const sig = String(listening);
    if (!force && sig === key.last) return;
    key.last = sig;
    setImage(context, listening ? LISTENING : tile(key.settings.color ?? '#eb4034'));
    setTitle(context, listening ? 'Listening' : key.settings.label ?? 'Dictate');
    return;
  }
  if (key.action === 'meeting' && (key.settings.mode ?? 'toggle') === 'toggle') {
    const face = meetingFace();
    const sig = face.title + face.image;
    if (!force && sig === key.last) return;
    key.last = sig;
    setImage(context, face.image);
    setTitle(context, face.title);
    return;
  }
  if (key.action === 'clock') {
    const face = clockFace();
    const sig = face.title + face.color;
    if (!force && sig === key.last) return;
    key.last = sig;
    setImage(context, tile(face.color));
    setTitle(context, face.title);
    return;
  }
  if (key.action === 'audio') {
    const face = audioFace(key.settings);
    const sig = face.title + face.color;
    if (!force && sig === key.last) return;
    key.last = sig;
    setImage(context, tile(face.color));
    setTitle(context, face.title);
    return;
  }
  if (key.action === 'limit') {
    const face = limitFace(key.settings);
    const sig = face.title + face.color;
    if (!force && sig === key.last) return;
    key.last = sig;
    setImage(context, tile(face.color));
    setTitle(context, face.title);
    return;
  }
  if (key.action === 'agenda') {
    const m = agenda[key.settings.index ?? 0];
    const title = m ? `${hhmm(m.start)}\n${marquee(m.subject)}` : '-';
    const color = m ? meetingColor(m) : '#2a2a2a';
    const sig = title + color;
    if (!force && sig === key.last) return;
    key.last = sig;
    setImage(context, tile(color));
    setTitle(context, title);
    return;
  }
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
function pick(snap, { states, kinds } = {}) {
  let list = snap.agents.filter((a) => a.agent && (!kinds || kinds.includes(a.agent)));
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

// Teams has no shortcut for a particular window. Ctrl+Shift+E opens its Share content
// tray, where the user can select exactly one window instead of an entire display.
function openTeamsShare() {
  if (process.platform !== 'win32') return console.error('Teams Share is currently supported on Windows only');
  const script = "$shell = New-Object -ComObject WScript.Shell; if (!$shell.AppActivate('Microsoft Teams')) { throw 'Microsoft Teams is not running' }; Start-Sleep -Milliseconds 150; $shell.SendKeys('^+e')";
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err) => {
    if (err) console.error(`teams: ${err.message}`);
  });
}

function handyBin(settings) {
  const candidates = [
    settings.handy,
    '/Applications/Handy.app/Contents/MacOS/handy',
    path.join(process.env.LOCALAPPDATA ?? '', 'Handy', 'handy.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Handy', 'handy.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Handy', 'handy.exe'),
  ];
  return candidates.find((p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } });
}

function openPath(p) {
  if (process.platform === 'darwin') execFile('/usr/bin/open', [p], () => {});
  else if (process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${p.replace(/'/g, "''")}'`], { windowsHide: true }, () => {});
  else execFile('xdg-open', [p], () => {});
}

const textFor = (value, kind) => (typeof value === 'string' ? value : value?.[kind] ?? value?.default);

// Cwd for new panes: the focused pane's, falling back to home.
function focusedCwd(snap) {
  const p = snap.panes.find((x) => x.pane_id === snap.focusedPane);
  return p?.foreground_cwd ?? p?.cwd ?? os.homedir();
}

const runPanes = new Map(); // workspace id -> pane we opened for commands

// A title/people match is safe only for a calendar event that is actually in progress.
// When events overlap, prefer the one that began most recently.
async function activeCalendarMeeting(settings) {
  if (!settings.calendar) return null;
  const now = Date.now();
  const events = await upcoming(settings.calendar);
  return events.filter((event) => event.start <= now && now < event.end)
    .sort((a, b) => b.start - a.start)[0] ?? null;
}

const ACTIONS = {
  async status({ settings }) {
    const snap = await snapshot();
    const kinds = kindsOf(settings);
    const a = pick(snap, { states: ['blocked'], kinds })
      ?? pick(snap, { states: ['working'], kinds })
      ?? pick(snap, { kinds });
    if (a) {
      await herdr('agent', 'focus', a.pane_id);
      return raiseTerminal(settings);
    }
    // Not in herdr: bring forward the app hosting the newest hook session (Claude desktop).
    const s = hookSessions().filter((x) => !kinds || kinds.includes(x.kind)).sort((x, y) => y.updatedAt - x.updatedAt)[0];
    if (s?.bundleId && process.platform === 'darwin') execFile('/usr/bin/open', ['-b', s.bundleId], () => {});
  },

  async agentlist({ settings }) {
    const a = agentTiles()[settings.index ?? 0];
    if (!a) return;
    await herdr('agent', 'focus', a.pane_id);
    raiseTerminal(settings);
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

  async switch({ settings }) {
    if (settings.device && settings.profile) send({ event: 'switchProfile', device: settings.device, profile: settings.profile });
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

  // Start/stop Handy dictation; the text lands in whatever window has focus.
  async dictate({ settings }) {
    const flag = { post: '--toggle-post-process', cancel: '--cancel' }[settings.mode] ?? '--toggle-transcription';
    const bin = handyBin(settings);
    if (!bin) return console.error('Handy not found; set "handy" in deck.local.mjs');
    execFile(bin, [flag], { windowsHide: true }, () => {});
    listening = settings.mode === 'cancel' ? false : !listening;
  },

  // Meeting recorder: toggle Rec, summarize the last transcript, or open the files.
  async meeting({ settings }) {
    const opts = { ...settings, handy: handyBin(settings) };
    switch (settings.mode ?? 'toggle') {
      case 'toggle':
        if (meeting.state === 'recording') return stopMeeting();
        return startMeeting({ ...opts, calendarMeeting: await activeCalendarMeeting(settings), onSummaryReady: openPath });
      case 'folder': {
        const dir = meetingsRoot(settings);
        fs.mkdirSync(dir, { recursive: true });
        return openPath(dir);
      }
      case 'last': {
        const file = lastTranscript(settings);
        return file && openPath(file);
      }
      case 'summary': {
        const file = lastTranscript(settings);
        if (!file || meeting.state !== 'idle') return;
        return summarizeMeeting(opts, path.dirname(file)).then(() => openPath(path.join(path.dirname(file), 'summary.md')));
      }
    }
  },

  // Opens Teams' Share content tray; choose a single window there to present it.
  async teams() {
    openTeamsShare();
  },

  // One-shot prompt through pi or opencode (GLM 5.3 Flash by default); the answer is saved
  // as markdown and opened. The key shows "Working..." meanwhile. If the key defines a
  // dialog, a small native prompt asks for a value first, which replaces <answer> in the
  // text; cancelling or leaving it empty skips the run.
  async headless({ settings, context }) {
    const key = keys.get(context);
    if (key?.busy) return;
    if (key) { key.busy = true; paint(context); }
    try {
      let prompt = settings.text;
      if (settings.dialog) {
        const answer = await askDialog({ title: settings.name ?? 'AgentDeck', ...settings.dialog });
        if (!answer) return;
        prompt = prompt.replace('<answer>', answer);
      }
      const file = await runHeadless({ ...settings, prompt, outDir: outputDir(settings) });
      openPath(file);
    } finally {
      if (key) { key.busy = false; paint(context, true); }
    }
  },

  // Brief me on one upcoming meeting from the Outlook calendar (always GLM 5.3 Flash via opencode).
  async agenda({ settings, context }) {
    const m = (await upcoming(settings.calendar))[settings.index ?? 0];
    if (!m) return;
    const text = `Brief me on this meeting from my calendar. Say what it is about, who is involved, and what I should prepare. Use only the details below, do not invent anything.\n\n${describe(m)}`;
    return ACTIONS.headless({ settings: { runner: 'opencode', name: 'briefing', ...settings, text }, context });
  },

  // Speaker volume up/down, or mute/unmute the default microphone.
  async audio({ settings }) {
    if (settings.mode === 'mic') await toggleMic();
    else await changeVolume(settings.mode);
    for (const [c, k] of keys) if (k.action === 'audio') paint(c);
  },

  // Pressing a limit tile refetches every provider on the next tick.
  async limit() {
    refreshLimits();
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
      if (action === 'agenda' && !agenda.length) refreshAgenda();
      animate();
      break;
    case 'willDisappear':
      keys.delete(m.context);
      animate();
      break;
    case 'didReceiveSettings':
      if (keys.has(m.context)) { keys.get(m.context).settings = m.payload?.settings ?? {}; paint(m.context, true); }
      break;
    case 'keyDown': {
      const settings = m.payload?.settings ?? {};
      if (action === 'meeting' && settings.mode?.startsWith('reminder-')) {
        dismissRecordingReminder();
        switchReminderProfile(settings.device, false);
        if (settings.mode === 'reminder-record') {
          Promise.resolve(ACTIONS.meeting({ settings: { ...settings, mode: 'toggle' } }))
            .catch((err) => console.error(`meeting: ${err.message}`));
        }
        break;
      }
      if (action === 'meeting' && (settings.mode ?? 'toggle') === 'toggle') dismissRecordingReminder();
      Promise.resolve(ACTIONS[action]?.({ settings, context: m.context }))
        .catch((err) => console.error(`${action}: ${err.message}`))
        .finally(() => setTimeout(poll, 300));
      break;
    }
  }
};

onMeetingChange(() => { for (const c of keys.keys()) paint(c); });

// Meetings still ahead of us, today first; keys of any 'agenda' action read from this list.
async function refreshAgenda() {
  const url = [...keys.values()].find((k) => k.settings.calendar)?.settings.calendar;
  agenda = (await upcoming(url)).filter((m) => m.end > Date.now());
  for (const c of keys.keys()) if (keys.get(c).action === 'agenda') paint(c);
}

let pollCount = 0;
async function poll() {
  agents = await listAgents();
  if (pollCount++ % 5 === 0) { // workspace names change rarely
    const list = (await herdr('workspace', 'list'))?.workspaces;
    if (list) workspaces = new Map(list.map((w) => [w.workspace_id, { label: w.label, number: w.number }]));
  }
  repaintAll();
}

fs.mkdirSync(STATE_DIR, { recursive: true });
let timer;
fs.watch(STATE_DIR, () => { clearTimeout(timer); timer = setTimeout(repaintAll, 80); });
setInterval(poll, POLL_MS);
setInterval(refreshAgenda, 60e3);
// Agenda keys exist only while that profile is on screen, so this is a no-op otherwise.
setInterval(() => { for (const [c, k] of keys) if (k.action === 'clock') paint(c); }, 15e3);
// Volume and mic can change outside the deck, so audio keys re-read them while visible.
setInterval(async () => {
  if (![...keys.values()].some((k) => k.action === 'audio')) return;
  await refreshAudio();
  for (const [c, k] of keys) if (k.action === 'audio') paint(c);
}, 2000);
// Switch to a dedicated profile so blank keys can dismiss without running other actions.
let reminderOverlay = false;
let reminderFrame = 0;
let dismissedReminderId = null;
let reminderDevice = null;

function switchReminderProfile(device, show) {
  if (!device) return;
  reminderOverlay = show;
  reminderDevice = show ? device : null;
  reminderFrame = 0;
  send({ event: 'switchProfile', device, profile: show ? 'RecordingReminder' : 'Default' });
}

function dismissRecordingReminder() {
  const isTest = testMeeting();
  const m = isTest ? { start: Date.now() } : agenda[0];
  const id = activeReminderId({ meeting: m, isTest });
  if (!id || dismissedReminderId === id) return false;
  dismissedReminderId = id;
  return true;
}

setInterval(() => {
  const isTest = testMeeting();
  const m = isTest ? { start: Date.now() } : agenda[0];
  const showReminder = shouldShowReminder({ meeting: m, recorderIdle: meeting.state === 'idle', dismissedId: dismissedReminderId, isTest });
  if (showReminder === reminderOverlay) return;
  const device = reminderDevice ?? [...keys.values()].find((k) => k.settings.device)?.settings.device;
  switchReminderProfile(device, showReminder);
}, 1000);
setInterval(() => {
  if (!reminderOverlay) return;
  reminderFrame = (reminderFrame + 1) % REMINDER_FRAMES.length;
  for (const [c, k] of keys) if (k.action === 'meeting' && k.settings.mode === 'reminder-record') setImage(c, REMINDER_FRAMES[reminderFrame]);
}, FRAME_MS);
setInterval(() => {
  marqueeTick++;
  for (const [c, k] of keys) if (k.action === 'agenda' || k.action === 'agentlist') paint(c);
}, 450);
poll();
refreshAgenda();
