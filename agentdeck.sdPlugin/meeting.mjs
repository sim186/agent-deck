// Meeting recorder: ffmpeg records the mic (and optionally a loopback device for
// system audio) into 5-minute 16 kHz mono WAV parts; on stop, Handy transcribes each
// part locally and the text is written to transcript.md next to the audio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PART_SECS = 300;
const WIN = process.platform === 'win32';

export const meeting = {
  state: 'idle', // idle | recording | transcribing | summarizing
  startedAt: 0,
  progress: '', // e.g. "2/5" while transcribing
  dir: null, // current or last session folder
  error: null,
};

// macOS: OpenDeck has no microphone usage description, so anything it spawns records
// silence. We launch ffmpeg through a tiny app bundle that does (see recorder/).
const RECORDER_APP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recorder', 'AgentDeckRecorder.app');

let ffmpeg = null; // { stop(), error() }
let onChange = () => {};
export const onMeetingChange = (fn) => { onChange = fn; };

const expand = (p) => p.replace(/^~(?=$|[\\/])/, os.homedir());
export const meetingsRoot = (settings) => expand(settings.dir ?? '~/Documents/Meetings');

function findFfmpeg(settings) {
  const exe = WIN ? 'ffmpeg.exe' : 'ffmpeg';
  return [settings.ffmpeg, `/opt/homebrew/bin/${exe}`, `/usr/local/bin/${exe}`, path.join(process.env.ProgramFiles ?? '', 'ffmpeg', 'bin', exe)]
    .find((p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } }) ?? exe;
}

// One ffmpeg input per device: avfoundation on macOS, dshow on Windows.
function inputArgs(device) {
  return WIN ? ['-f', 'dshow', '-i', `audio=${device}`] : ['-f', 'avfoundation', '-i', `:${device}`];
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

export function startMeeting(settings) {
  if (meeting.state !== 'idle') return;
  const dir = path.join(meetingsRoot(settings), stamp());
  fs.mkdirSync(dir, { recursive: true });
  const devices = [settings.mic ?? 'default', settings.system].filter(Boolean);
  const args = ['-hide_banner', '-loglevel', 'error', ...devices.flatMap(inputArgs)];
  if (devices.length > 1) args.push('-filter_complex', `amix=inputs=${devices.length}:duration=longest`);
  args.push('-ac', '1', '-ar', '16000', '-f', 'segment', '-segment_time', String(PART_SECS), path.join(dir, 'part-%03d.wav'));

  const onExit = () => {
    const err = ffmpeg?.error();
    ffmpeg = null;
    if (meeting.state === 'recording') { // died on its own (bad device, no permission...)
      meeting.error = err || 'ffmpeg stopped';
      console.error(`meeting: ${meeting.error}`);
    }
    transcribe(settings);
  };
  ffmpeg = process.platform === 'darwin'
    ? launchViaApp(findFfmpeg(settings), args, dir, onExit)
    : launchDirect(findFfmpeg(settings), args, onExit);
  Object.assign(meeting, { state: 'recording', startedAt: Date.now(), dir, error: null, progress: '' });
  onChange();
}

export function stopMeeting() {
  if (meeting.state !== 'recording' || !ffmpeg) return;
  meeting.state = 'stopping';
  ffmpeg.stop();
  onChange();
}

function launchDirect(bin, args, onExit) {
  const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', onExit);
  return {
    stop: () => child.stdin.write('q'), // lets ffmpeg finalize the WAV headers
    error: () => stderr.trim().split('\n').pop(),
  };
}

function launchViaApp(bin, args, dir, onExit) {
  const pidFile = path.join(dir, '.ffmpeg.pid');
  const logFile = path.join(dir, 'ffmpeg.log');
  execFile('/usr/bin/open', ['-n', '-g', '-a', RECORDER_APP, '--args', pidFile, logFile, bin, '-nostdin', ...args], () => {});
  let pid = null;
  let stopRequested = false;
  const started = Date.now();
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const watch = setInterval(() => {
    if (!pid) {
      try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* not started yet */ }
      if (pid && stopRequested) process.kill(pid, 'SIGINT');
      if (!pid && Date.now() - started > 10000) { clearInterval(watch); onExit(); }
      return;
    }
    if (!alive()) { clearInterval(watch); fs.rmSync(pidFile, { force: true }); onExit(); }
  }, 500);
  return {
    stop: () => { stopRequested = true; if (pid) process.kill(pid, 'SIGINT'); }, // SIGINT lets ffmpeg finalize the WAV headers
    error: () => { try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').pop(); } catch { return ''; } },
  };
}

function handyText(bin, file) {
  return new Promise((resolve) => {
    execFile(bin, ['--transcribe-file', file, '--json'], { maxBuffer: 64 << 20, timeout: 30 * 60e3, windowsHide: true }, (err, stdout) => {
      try { resolve(JSON.parse(stdout.trim().split('\n').pop()).text ?? ''); } catch { resolve(err ? `[transcription failed: ${err.message}]` : ''); }
    });
  });
}

async function transcribe(settings) {
  const { dir, startedAt } = meeting;
  const parts = fs.readdirSync(dir).filter((f) => /^part-\d+\.wav$/.test(f)).sort();
  const bin = settings.handy;
  meeting.state = 'transcribing';
  const lines = [
    `# Meeting ${path.basename(dir).replace('_', ' ')}`,
    '',
    `- Started: ${new Date(startedAt).toLocaleString()}`,
    `- Duration: ${clock(Date.now() - startedAt)}`,
    `- Audio: ${parts.length} part(s) in this folder`,
    '',
    '## Transcript',
    '',
  ];
  for (const [i, part] of parts.entries()) {
    meeting.progress = `${i + 1}/${parts.length}`;
    onChange();
    const text = bin ? await handyText(bin, path.join(dir, part)) : '[Handy not found]';
    lines.push(`**[${clock(i * PART_SECS * 1000)}]** ${text.trim()}`, '');
  }
  fs.writeFileSync(path.join(dir, 'transcript.md'), lines.join('\n'));
  if (settings.summarize === false) {
    Object.assign(meeting, { state: 'idle', progress: '' });
    return onChange();
  }
  await summarizeMeeting(settings, dir);
  notifySummaryReady(settings, dir);
}

// A recording can opt into opening its completed summary; manual Summary presses stay separate.
export function notifySummaryReady(settings, dir) {
  const file = path.join(dir, 'summary.md');
  if (!fs.existsSync(file)) return false;
  settings.onSummaryReady?.(file);
  return true;
}

const SUMMARY_PROMPT = 'Read the attached meeting transcript and write summary.md in the current directory with: a 5-line summary, decisions, action items (owner, due date if mentioned), and open questions. Keep the language of the meeting. Do not ask questions, just write the file.';

// Runs the OpenCode harness headless on the transcript; writes summary.md next to it.
export function summarizeMeeting(settings, dir = meeting.dir) {
  return new Promise((resolve) => {
    const model = settings.summaryModel ?? 'opencode-go/glm-5.3-flash';
    const args = ['run', SUMMARY_PROMPT, '-m', model, '--dir', dir, '-f', path.join(dir, 'transcript.md')]; // -f takes a list, so it goes last
    Object.assign(meeting, { state: 'summarizing', progress: '', dir });
    onChange();
    // On Windows opencode is an npm .cmd shim, which needs a shell (and manual quoting).
    const bin = settings.opencode ?? 'opencode';
    const stdio = ['ignore', 'ignore', 'pipe'];
    const child = WIN
      ? spawn([bin, ...args].map((a) => `"${a.replace(/"/g, '')}"`).join(' '), { shell: true, windowsHide: true, stdio })
      : spawn(bin, args, { stdio });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const done = (err) => {
      if (err) { meeting.error = `summary: ${err}`; console.error(meeting.error); }
      Object.assign(meeting, { state: 'idle', progress: '' });
      onChange();
      resolve();
    };
    child.on('error', (e) => done(e.message));
    child.on('exit', (code) => done(code ? stderr.trim().split('\n').pop() || `opencode exit ${code}` : null));
  });
}

export function clock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

// Newest session folder that has a transcript.
export function lastTranscript(settings) {
  const root = meetingsRoot(settings);
  let dirs = [];
  try { dirs = fs.readdirSync(root).sort().reverse(); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(root, d, 'transcript.md');
    if (fs.existsSync(f)) return f;
  }
  return null;
}
