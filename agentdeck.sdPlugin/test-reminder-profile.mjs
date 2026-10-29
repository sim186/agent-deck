import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../deck.config.mjs';

test('reminder profile provides one record key and dismiss actions on every other key', () => {
  for (const device of [{ cols: 6, rows: 3, screenCols: [5] }, { cols: 2, rows: 2, screenCols: [] }]) {
    const { profiles } = config({ device, meetings: { mic: 'test mic' } });
    const keys = profiles.RecordingReminder;
    assert.equal(keys.length, (device.cols - device.screenCols.length) * device.rows);
    assert.equal(keys.filter((key) => key.mode === 'reminder-record').length, 1);
    assert.equal(keys.filter((key) => key.mode === 'reminder-dismiss').length, keys.length - 1);
    assert.ok(keys.every((key) => key.type === 'meeting' && key.mic === 'test mic'));
  }
});
