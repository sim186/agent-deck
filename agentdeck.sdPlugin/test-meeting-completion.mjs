import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { notifySummaryReady } from './meeting.mjs';

test('notifies the caller only after summary.md exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-meeting-'));
  let opened = null;
  const settings = { onSummaryReady: (file) => { opened = file; } };
  try {
    assert.equal(notifySummaryReady(settings, dir), false);
    assert.equal(opened, null);

    const summary = path.join(dir, 'summary.md');
    fs.writeFileSync(summary, '# Summary');
    assert.equal(notifySummaryReady(settings, dir), true);
    assert.equal(opened, summary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
