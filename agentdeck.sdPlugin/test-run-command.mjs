import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from './run-command.mjs';

test('background command captures output and reports failure', async () => {
  const command = `"${process.execPath}" -e "console.error('sync failed'); process.exit(7)"`;
  const result = await runCommand(command);
  assert.equal(result.code, 7);
  assert.match(fs.readFileSync(result.log, 'utf8'), /sync failed/);
  fs.rmSync(result.log, { force: true });
});

test('background command reports success', async () => {
  const result = await runCommand(`"${process.execPath}" -e "console.log('ok')"`);
  assert.equal(result.code, 0);
  assert.match(fs.readFileSync(result.log, 'utf8'), /ok/);
  fs.rmSync(result.log, { force: true });
});

test('background command reports progress and result markers', async () => {
  const script = path.join(os.tmpdir(), `agentdeck-markers-${process.pid}.js`);
  fs.writeFileSync(script, String.raw`console.log('::progress 1/2\\nCMS'); console.log('noise'); console.log('::progress 2/2\\nWeb'); process.stdout.write('::result 2 synced');`);
  const seen = [];
  const result = await runCommand(`"${process.execPath}" "${script}"`, { onProgress: (t) => seen.push(t) });
  fs.rmSync(script, { force: true });
  assert.equal(result.code, 0);
  assert.deepEqual(seen, ['1/2\nCMS', '2/2\nWeb']);
  assert.equal(result.result, '2 synced');
  fs.rmSync(result.log, { force: true });
});
