import assert from 'node:assert/strict';
import test from 'node:test';
import { expand } from './calendar.mjs';

function dates(rule, { start = '20251226T090000Z', from = '2026-01-01', to = '2026-02-01', extra = '' } = {}) {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:monthly-test',
    `DTSTART:${start}`, `DTEND:${start.replace('T090000', 'T100000')}`,
    `RRULE:FREQ=MONTHLY;${rule}`, 'SUMMARY:Monthly meeting', extra,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return expand(ics, Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T00:00:00Z`))
    .map((meeting) => new Date(meeting.start).toISOString().slice(0, 10));
}

for (const [name, rule, expected] of [
  ['last Friday', 'BYDAY=FR;BYSETPOS=-1', ['2026-01-30']],
  ['first Friday', 'BYDAY=FR;BYSETPOS=1', ['2026-01-02']],
  ['second and last Fridays', 'BYDAY=FR;BYSETPOS=2,-1', ['2026-01-09', '2026-01-30']],
  ['last weekday across the combined set', 'BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', ['2026-01-30']],
  ['second date across multiple weekdays', 'BYDAY=MO,FR;BYSETPOS=2', ['2026-01-05']],
  ['out-of-range positions', 'BYDAY=FR;BYSETPOS=6,-6', []],
  ['overlapping positions without duplicates', 'BYDAY=FR;BYSETPOS=5,-1', ['2026-01-30']],
  ['month-day candidates', 'BYMONTHDAY=5,15,25;BYSETPOS=-1', ['2026-01-25']],
  ['negative month-day candidates', 'BYMONTHDAY=-3,-2,-1;BYSETPOS=1', ['2026-01-29']],
  ['ordinal weekday candidates', 'BYDAY=1FR,-1FR;BYSETPOS=-1', ['2026-01-30']],
  ['intersected weekday and month-day candidates', 'BYDAY=FR;BYMONTHDAY=2,9,16;BYSETPOS=-1', ['2026-01-16']],
  ['all Fridays without BYSETPOS', 'BYDAY=FR', ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30']],
  ['existing ordinal weekday', 'BYDAY=-1FR', ['2026-01-30']],
]) {
  test(`monthly recurrence: ${name}`, () => {
    assert.deepEqual(dates(rule), expected);
  });
}

test('positions use the whole month, not just dates after DTSTART', () => {
  assert.deepEqual(dates('BYDAY=FR;BYSETPOS=1', { start: '20260109T090000Z' }), []);
});

test('positions reset each month, including leap February', () => {
  assert.deepEqual(dates('BYDAY=FR;BYSETPOS=-1', {
    start: '20231229T090000Z', from: '2024-01-01', to: '2024-04-01',
  }), ['2024-01-26', '2024-02-23', '2024-03-29']);
});

test('COUNT counts selected occurrences, not every candidate weekday', () => {
  assert.deepEqual(dates('BYDAY=FR;BYSETPOS=-1;COUNT=3', { to: '2026-04-01' }),
    ['2026-01-30', '2026-02-27']);
});

test('EXDATE removes a selected occurrence without selecting a replacement', () => {
  assert.deepEqual(dates('BYDAY=FR;BYSETPOS=-1', { extra: 'EXDATE:20260130T090000Z' }), []);
});

test('INTERVAL and UNTIL still constrain selected occurrences', () => {
  assert.deepEqual(dates('BYDAY=FR;BYSETPOS=-1;INTERVAL=2;UNTIL=20260401T000000Z', {
    to: '2026-07-01',
  }), ['2026-02-27']);
});
