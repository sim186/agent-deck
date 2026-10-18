// Cross-platform installer: copies the Agent Deck plugin into OpenDeck, generates
// the profiles from deck.config.mjs (+ deck.local.mjs), registers the Claude Code
// hooks and restarts OpenDeck. Run via ./install.sh or .\install.ps1.
//
// OpenDeck rewrites profiles on exit, so it must be closed while we write them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const OPENDECK = WIN
  ? path.join(process.env.APPDATA, 'opendeck')
  : path.join(os.homedir(), 'Library', 'Application Support', 'opendeck');
const PLUGIN_ID = 'com.simone.agentdeck.sdPlugin';
const STARTER = 'com.amansprojects.starterpack.sdPlugin';
const OLD_PLUGINS = ['com.simone.claudestatus.sdPlugin'];

const log = (msg) => console.log(`- ${msg}`);

// ---------- OpenDeck process ----------

function quitOpenDeck() {
  try {
    if (WIN) execFileSync('taskkill', ['/IM', 'opendeck.exe', '/F'], { stdio: 'ignore' });
    else execFileSync('osascript', ['-e', 'quit app "OpenDeck"'], { stdio: 'ignore' });
  } catch { /* not running */ }
  const until = Date.now() + 8000;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < until && running()) Atomics.wait(nap, 0, 0, 500);
}

function running() {
  try {
    const out = WIN
      ? execFileSync('tasklist', ['/FI', 'IMAGENAME eq opendeck.exe'], { encoding: 'utf8' })
      : execFileSync('pgrep', ['-f', 'OpenDeck.app/Contents/MacOS/opendeck'], { encoding: 'utf8' });
    return WIN ? /opendeck\.exe/i.test(out) : out.trim().length > 0;
  } catch { return false; }
}

function startOpenDeck() {
  if (!WIN) return spawn('open', ['-a', 'OpenDeck'], { detached: true, stdio: 'ignore' }).unref();
  const exe = [
    path.join(process.env.LOCALAPPDATA ?? '', 'OpenDeck', 'opendeck.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenDeck', 'opendeck.exe'),
    path.join(process.env.ProgramFiles ?? '', 'OpenDeck', 'opendeck.exe'),
  ].find((p) => fs.existsSync(p));
  if (exe) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  else log('Start OpenDeck manually (executable not found in the usual places)');
}

// ---------- plugin ----------

function installPlugin() {
  const dst = path.join(OPENDECK, 'plugins', PLUGIN_ID);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'agentdeck.sdPlugin'), dst, { recursive: true });
  if (!WIN) fs.chmodSync(path.join(dst, 'bin', 'agentdeck'), 0o755);
  for (const old of OLD_PLUGINS) fs.rmSync(path.join(OPENDECK, 'plugins', old), { recursive: true, force: true });
  log(`plugin -> ${dst}`);
}

// ---------- profiles ----------

const ACTION_NAMES = {
  status: 'Agent Status', approve: 'Approve', keys: 'Send Keys', prompt: 'Prompt',
  launch: 'Launch Agent', project: 'Project', editor: 'VS Code', run: 'Run Command',
};

function state({ image, text = '', alignment = 'middle' }) {
  return {
    alignment, background_colour: '#000000', colour: '#FFFFFF', family: 'Liberation Sans',
    image, image_scale: 100, name: '', show: true, size: 14, stroke_colour: '#000000',
    stroke_size: 3, style: 'Regular', text, underline: false,
  };
}

function keyFor(spec, index, device, terminal) {
  if (!spec) return null;
  const context = `Keypad.${index}.0`;
  if (spec.type === 'switch') {
    const image = `plugins/${PLUGIN_ID}/icons/nav@2x.png`;
    const st = state({ image, text: spec.label });
    return {
      action: {
        controllers: ['Keypad'], disable_automatic_states: false, encoder: null,
        icon: `plugins/${STARTER}/icons/switchProfile.png`, name: 'Switch Profile', plugin: STARTER,
        property_inspector: `plugins/${STARTER}/propertyInspector/switchProfile.html`,
        states: [st], supported_in_multi_actions: true, tooltip: 'Switch to another profile',
        uuid: 'com.amansprojects.starterpack.switchprofile', visible_in_action_list: true,
      },
      children: null, context, current_state: 0,
      settings: { device, profile: spec.to },
      states: [st],
    };
  }
  const { type, ...settings } = spec;
  const live = type === 'status' || type === 'approve';
  const icon = type === 'status' ? 'status' : type === 'approve' ? 'approve' : 'tile';
  const st = state({
    image: `plugins/${PLUGIN_ID}/icons/${icon}@2x.png`,
    text: typeof settings.label === 'string' && !live ? settings.label : '',
    alignment: live ? 'bottom' : 'middle',
  });
  return {
    action: {
      controllers: ['Keypad'], disable_automatic_states: false, encoder: null,
      icon: `plugins/${PLUGIN_ID}/icons/${icon}@2x.png`, name: ACTION_NAMES[type], plugin: PLUGIN_ID,
      property_inspector: '', states: [st], supported_in_multi_actions: false, tooltip: '',
      uuid: `com.simone.agentdeck.${type}`, visible_in_action_list: true,
    },
    children: null, context, current_state: 0,
    settings: { terminal, ...settings },
    states: [st],
  };
}

async function writeNavIcon() {
  const { tilePng } = await import(pathToFileURL(path.join(ROOT, 'agentdeck.sdPlugin', 'png.mjs')));
  const dir = path.join(OPENDECK, 'plugins', PLUGIN_ID, 'icons');
  fs.writeFileSync(path.join(dir, 'nav@2x.png'), tilePng(144, [0x4f, 0x8c, 0xff]));
  fs.writeFileSync(path.join(dir, 'nav.png'), tilePng(72, [0x4f, 0x8c, 0xff]));
}

async function buildProfiles() {
  const config = (await import(pathToFileURL(path.join(ROOT, 'deck.config.mjs')))).default;
  const localFile = path.join(ROOT, 'deck.local.mjs');
  const local = fs.existsSync(localFile) ? (await import(pathToFileURL(localFile))).default : {};
  const { profiles, terminal } = config(local);

  const dir = path.join(OPENDECK, 'profiles');
  const devices = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    : [];
  if (!devices.length) return log('no devices found: plug in the deck, open OpenDeck once, then re-run');

  const backup = path.join(OPENDECK, `profiles.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.cpSync(dir, backup, { recursive: true });
  log(`backup of previous profiles -> ${backup}`);

  for (const device of devices) {
    const ddir = path.join(dir, device);
    let size = 18;
    try { size = JSON.parse(fs.readFileSync(path.join(ddir, 'Default.json'), 'utf8')).keys.length || 18; } catch { /* new device */ }
    for (const [name, specs] of Object.entries(profiles)) {
      if (specs.length > size) throw new Error(`profile ${name} has ${specs.length} keys, device ${device} has ${size}`);
      const keys = Array.from({ length: size }, (_, i) => keyFor(specs[i], i, device, terminal));
      fs.writeFileSync(path.join(ddir, `${name}.json`), JSON.stringify({ infobars: [], keys, sliders: [] }, null, 2));
      fs.rmSync(path.join(ddir, `${name}.json.temp`), { force: true });
    }
    fs.writeFileSync(path.join(dir, `${device}.json`), JSON.stringify({ selected_profile: 'Default' }, null, 2));
    log(`profiles for ${device}: ${Object.keys(profiles).join(', ')}`);
  }
}

// ---------- Claude Code hooks ----------

function installHooks() {
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const script = path.join(ROOT, 'hooks', 'deck-hook.mjs');
  const cmd = (st) => ({ type: 'command', command: `"${process.env.DECK_NODE || process.execPath}" "${script}" ${st}`, timeout: 5 });
  s.hooks ??= {};
  const add = (event, st, matcher) => {
    s.hooks[event] = (s.hooks[event] ?? []).filter((g) => !JSON.stringify(g).includes('deck-hook.mjs'));
    s.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [cmd(st)] });
  };
  add('SessionStart', 'idle');
  add('UserPromptSubmit', 'working');
  add('PostToolUse', 'working');
  add('Notification', 'waiting', 'permission_prompt|elicitation_dialog');
  add('Stop', 'idle');
  add('SessionEnd', 'end');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.pre-agentdeck`);
  fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
  log(`Claude Code hooks -> ${file}`);
}

// ---------- main ----------

if (!fs.existsSync(OPENDECK)) {
  console.error(`OpenDeck config not found at ${OPENDECK}. Install and open OpenDeck first.`);
  process.exit(1);
}
quitOpenDeck();
installPlugin();
await writeNavIcon();
await buildProfiles();
if (!process.argv.includes('--no-hooks')) installHooks();
startOpenDeck();
log('done');
