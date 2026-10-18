// Thin async wrapper around the herdr CLI (works the same on macOS and Windows).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const exe = process.platform === 'win32' ? 'herdr.exe' : 'herdr';
const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', exe),
  `/opt/homebrew/bin/${exe}`,
  `/usr/local/bin/${exe}`,
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'herdr', exe),
];
const BIN = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) ?? exe;

export function herdr(...args) {
  return new Promise((resolve) => {
    execFile(BIN, args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
      try { resolve(JSON.parse(stdout).result ?? null); } catch { resolve(null); }
      if (err) console.error(`herdr ${args.join(' ')}: ${err.message}`);
    });
  });
}

export const listAgents = async () => (await herdr('agent', 'list'))?.agents ?? [];

// One call that tells us which pane the user is looking at, plus all agents.
export async function snapshot() {
  const snap = (await herdr('api', 'snapshot'))?.snapshot;
  return {
    focusedPane: snap?.focused_pane_id ?? null,
    focusedWorkspace: snap?.focused_workspace_id ?? null,
    agents: snap?.agents ?? [],
    panes: snap?.panes ?? [],
  };
}
