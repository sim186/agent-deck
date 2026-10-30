import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseCuts, parseSilences } from './silence-split.mjs';

test('parses silencedetect output', () => {
  const log = '[silencedetect] silence_start: 10.5\n[silencedetect] silence_end: 12.5 | silence_duration: 2\n';
  assert.deepEqual(parseSilences(log), [[10.5, 12.5]]);
});

test('cuts in the silence closest to each boundary', () => {
  assert.deepEqual(chooseCuts([[290, 296], [320, 321]], 700), [293, 593]);
});

test('falls back to the nominal boundary when no silence is near', () => {
  assert.deepEqual(chooseCuts([], 700), [300, 600]);
});

test('short recordings are not cut', () => {
  assert.deepEqual(chooseCuts([[100, 101]], 200), []);
});
