import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Output lines `::progress <text>` and `::result <text>` are reported to the key
// (a literal `\n` in the text becomes a line break); everything is also written to the log.
const MARKER = /^::(progress|result)\s?(.*)$/;

export function runCommand(command, { onProgress } = {}) {
  const log = path.join(os.tmpdir(), `agentdeck-command-${randomUUID()}.log`);
  const fd = fs.openSync(log, 'wx');
  let result;
  let pending = '';
  const scan = (text, flush = false) => {
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = flush ? '' : lines.pop();
    for (const line of lines) {
      const m = MARKER.exec(line.trim());
      if (!m) continue;
      const value = m[2].replace(/\\n/g, '\n');
      if (m[1] === 'result') result = value;
      else onProgress?.(value);
    }
  };
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => { fs.writeSync(fd, chunk); scan(chunk.toString()); });
    }
    let error;
    child.on('error', (err) => { error = err.message; });
    child.on('close', (code, signal) => {
      scan('', true);
      if (error || code !== 0) fs.writeSync(fd, `\n${error ?? (signal ? `Stopped by ${signal}` : `Exit code: ${code}`)}\n`);
      fs.closeSync(fd);
      resolve({ code: error || signal ? 1 : code, log, result });
    });
  });
}
