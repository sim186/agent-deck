import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { calendarContext, exportSummaryToVault, transcriptHeader } from './meeting.mjs';

test('copies the active calendar title and people into a recording transcript', () => {
  const calendarMeeting = {
    subject: '  Sprint   planning ', organizer: 'Alice Example',
    attendees: ['Bob Example', 'bob example', 'Carol Example'],
  };
  const header = transcriptHeader({
    dir: '/tmp/2026-03-20_0930', startedAt: 0, parts: ['part-000.wav'], calendarMeeting,
  }).join('\n');

  assert.equal(calendarContext(calendarMeeting).title, 'Sprint planning');
  assert.match(header, /^# Sprint planning$/m);
  assert.match(header, /- Organizer: Alice Example/);
  assert.match(header, /- Attendees: Bob Example, Carol Example/);
});

test('uses the timestamp-based title when no calendar event is matched', () => {
  const header = transcriptHeader({
    dir: '/tmp/2026-03-20_0930', startedAt: 0, parts: [], calendarMeeting: null,
  }).join('\n');

  assert.match(header, /^# Meeting 2026-03-20 0930$/m);
  assert.doesNotMatch(header, /^## Calendar$/m);
});

test('exports only the Markdown summary to the configured vault', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-vault-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recording = path.join(root, 'recording', '2026-03-20_0930');
  const vault = path.join(root, 'vault', 'Meetings');
  fs.mkdirSync(recording, { recursive: true });
  fs.writeFileSync(path.join(recording, 'summary.md'), '# Sprint planning\n\nConcise summary.\n');
  fs.writeFileSync(path.join(recording, 'part-000.wav'), 'audio');

  const note = exportSummaryToVault({ vault }, recording);
  assert.equal(path.basename(note), '2026-03-20 0930 - Sprint planning.md');
  assert.equal(fs.readFileSync(note, 'utf8'), '# Sprint planning\n\nConcise summary.\n');
  assert.equal(fs.existsSync(path.join(vault, 'part-000.wav')), false);
});
