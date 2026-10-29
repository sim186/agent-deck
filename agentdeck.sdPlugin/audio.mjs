// System audio for the Volume and Mic keys: output volume of the default speakers and
// mute state of the default microphone.
//
// Windows: one long-lived PowerShell process talks to the Core Audio endpoint API, so a
// press or a state poll costs one stdin line instead of a PowerShell start-up.
// macOS: osascript (`set volume`); the mic is "muted" by setting input volume to 0.
import { execFile, spawn } from 'node:child_process';

const STEP = 5; // percent per Volume press

// state: { volume: 0-100, muted: bool, mic: 'on' | 'muted' | null }
export let audio = { volume: null, muted: false, mic: null };

// ---------- Windows ----------

const PS_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
public interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
public interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
public interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator { }
public static class Endpoint {
  // flow: 0 render, 1 capture. role: 0 console, 2 communications.
  static IAudioEndpointVolume Get(int flow, int role) {
    try {
      var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice d;
      if (e.GetDefaultAudioEndpoint(flow, role, out d) != 0 || d == null) return null;
      var iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      d.Activate(ref iid, 23, IntPtr.Zero, out o);
      return (IAudioEndpointVolume)o;
    } catch { return null; }
  }
  static string Mic() {
    var d = Get(1, 0);
    if (d == null) return "null";
    bool m; d.GetMute(out m);
    return m ? "\"muted\"" : "\"on\"";
  }
  public static string State() {
    var d = Get(0, 0);
    float v = 0; bool m = false;
    if (d != null) { d.GetMasterVolumeLevelScalar(out v); d.GetMute(out m); }
    return "{\"volume\":" + (d == null ? "null" : Math.Round(v * 100).ToString()) + ",\"muted\":" + (m ? "true" : "false") + ",\"mic\":" + Mic() + "}";
  }
  public static void Volume(int delta) {
    var d = Get(0, 0);
    if (d == null) return;
    float v; d.GetMasterVolumeLevelScalar(out v);
    v = (float)Math.Min(1, Math.Max(0, Math.Round(v * 100 + delta) / 100));
    d.SetMasterVolumeLevelScalar(v, Guid.Empty);
    if (delta > 0) d.SetMute(false, Guid.Empty);
  }
  // Mute the default recording device for both roles (apps like Teams use communications).
  public static void ToggleMic() {
    var d = Get(1, 0);
    if (d == null) return;
    bool m; d.GetMute(out m);
    foreach (var role in new[] { 0, 2 }) { var r = Get(1, role); if (r != null) r.SetMute(!m, Guid.Empty); }
  }
}
'@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $cmd, $arg = $line -split ' '
    if ($cmd -eq 'volume') { [Endpoint]::Volume([int]$arg) }
    elseif ($cmd -eq 'mic') { [Endpoint]::ToggleMic() }
    [Console]::Out.WriteLine([Endpoint]::State())
  } catch { [Console]::Out.WriteLine('{"error":"' + ($_.Exception.Message -replace '["\\\s]', ' ') + '"}') }
  [Console]::Out.Flush()
}
`;

let ps = null;
const waiting = []; // resolvers for lines not yet answered, in order
let buffered = '';

function powershell() {
  if (ps) return ps;
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (chunk) => {
    buffered += chunk;
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line) waiting.shift()?.(line);
    }
  });
  ps.stderr.on('data', (d) => console.error(`audio: ${d}`));
  ps.on('exit', () => {
    ps = null;
    buffered = '';
    while (waiting.length) waiting.shift()(null);
  });
  return ps;
}

function winCommand(line) {
  return new Promise((resolve) => {
    const p = powershell();
    waiting.push(resolve);
    p.stdin.write(`${line}\n`);
  });
}

// ---------- macOS ----------

let micRestore = 75; // input volume to restore when unmuting the mic

const osa = (script) => new Promise((resolve) => {
  execFile('/usr/bin/osascript', ['-e', script], (err, stdout) => resolve(err ? null : stdout.trim()));
});

async function macCommand(line) {
  const [cmd, arg] = line.split(' ');
  if (cmd === 'volume') {
    await osa(`set volume output volume ((output volume of (get volume settings)) + ${Number(arg)})${Number(arg) > 0 ? '\nset volume without output muted' : ''}`);
  } else if (cmd === 'mic') {
    const input = Number(await osa('input volume of (get volume settings)'));
    if (input > 0) { micRestore = input; await osa('set volume input volume 0'); }
    else await osa(`set volume input volume ${micRestore}`);
  }
  // "output volume:50, input volume:75, alert volume:100, output muted:false"
  const s = await osa('get volume settings');
  if (!s) return null;
  const field = (name) => s.match(new RegExp(`${name}:([^,]+)`))?.[1].trim();
  const input = Number(field('input volume'));
  return JSON.stringify({
    volume: Number(field('output volume')),
    muted: field('output muted') === 'true',
    mic: Number.isNaN(input) ? null : input > 0 ? 'on' : 'muted',
  });
}

// ---------- API ----------

async function command(line) {
  const out = process.platform === 'win32' ? await winCommand(line)
    : process.platform === 'darwin' ? await macCommand(line)
    : null;
  try {
    const next = JSON.parse(out);
    if (next.error) console.error(`audio: ${next.error}`);
    else audio = next;
  } catch { /* helper unavailable: keep the last known state */ }
  return audio;
}

export const refreshAudio = () => command('state');
export const changeVolume = (direction) => command(`volume ${direction === 'down' ? -STEP : STEP}`);
export const toggleMic = () => command('mic');
