#!/usr/bin/env node
// Claude Code hook: records this session's state for the Claude Status deck plugin.
// Usage (from settings.json): node deck-hook.mjs <working|waiting|idle|end>
// Never fails the hook: any error exits 0 silently.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = path.join(os.homedir(), '.claude', 'deck-status');
const state = process.argv[2];

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input || '{}');
    const id = String(hook.session_id ?? '').replace(/[^\w-]/g, '');
    if (!id) return;
    const file = path.join(STATE_DIR, `${id}.json`);
    if (state === 'end') {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      state,
      event: hook.hook_event_name,
      cwd: hook.cwd,
      bundleId: process.env.__CFBundleIdentifier ?? null,
      herdrPane: process.env.HERDR_PANE_ID ?? null, // herdr reports these itself; the plugin skips them

      updatedAt: Date.now(),
    }));
    fs.renameSync(tmp, file);
  } catch { /* ignore */ }
});
