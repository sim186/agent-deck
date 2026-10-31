import assert from 'node:assert/strict';
import test from 'node:test';
import { activeReminderId, reminderId, reminderPress, shouldShowReminder } from './rec-reminder.mjs';

test('dismisses the recording reminder for the current meeting only', () => {
  const now = 1_700_000_000_000;
  const current = { start: now - 60_000 };
  const currentId = reminderId(current);

  assert.equal(shouldShowReminder({ meeting: current, now, recorderIdle: true }), true);
  // Stopping Rec happens while the recorder is active, but must still dismiss its later reminder.
  assert.equal(activeReminderId({ meeting: current, now }), currentId);
  assert.equal(shouldShowReminder({ meeting: current, now, recorderIdle: true, dismissedId: currentId }), false);

  const next = { start: now - 1 };
  assert.equal(shouldShowReminder({ meeting: next, now, recorderIdle: true, dismissedId: currentId }), true);
});

test('the visible reminder starts only from a Rec key and otherwise dismisses', () => {
  assert.equal(reminderPress({ visible: true, action: 'meeting', recorderIdle: true }), 'record');
  assert.equal(reminderPress({ visible: true, action: 'meeting', mode: 'summary', recorderIdle: true }), 'dismiss');
  assert.equal(reminderPress({ visible: true, action: 'prompt', recorderIdle: true }), 'dismiss');
  assert.equal(reminderPress({ visible: false, action: 'meeting', recorderIdle: true }), 'pass');
});
