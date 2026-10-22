import assert from 'node:assert/strict';
import test from 'node:test';
import { micPng } from './png.mjs';

test('meeting reminder microphone has distinct animation frames', () => {
  const first = micPng(144, 0);
  const next = micPng(144, 0.5);
  assert.equal(first.subarray(1, 4).toString(), 'PNG');
  assert.notDeepEqual(first, next);
});
