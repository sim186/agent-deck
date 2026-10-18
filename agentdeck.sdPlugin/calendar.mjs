// Outlook calendar: reads the published ICS feed (no auth, no dependencies) and returns
// upcoming meetings. Handles recurring events (DAILY/WEEKLY/MONTHLY/YEARLY), EXDATE and
// modified/cancelled single occurrences. Exchange publishes local times with a Windows
// zone name, which we map to an IANA zone.
const ZONES = { 'W. Europe Standard Time': 'Europe/Berlin', 'UTC': 'UTC' };
const DAY_MS = 86400e3;
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const TTL = 5 * 60e3;

let cache = { at: 0, url: '', events: [] };

// Wall-clock time in an IANA zone -> epoch ms.
function zoned([y, mo, d, h, mi], zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (zone === 'UTC') return guess;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(guess)).reduce((a, p) => ({ ...a, [p.type]: Number(p.value) }), {});
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let t = guess - (shown - guess);
  return t;
}

const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseProps(ics) {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = { attendees: [] };
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const value = line.slice(i + 1);
      const p = Object.fromEntries(params.map((x) => x.split('=')).map(([k, ...v]) => [k, v.join('=')]));
      if (name === 'ATTENDEE') cur.attendees.push(p.CN?.replace(/^"|"$/g, '') ?? value.replace(/^mailto:/i, ''));
      else if (name === 'ORGANIZER') cur.organizer = p.CN?.replace(/^"|"$/g, '') ?? value.replace(/^mailto:/i, '');
      else if (name === 'EXDATE') (cur.exdates ??= []).push(...value.split(',').map((v) => stamp(v, p)));
      else cur[name] = { value, p };
    }
  }
  return events;
}

// "20261020T094500[Z]" or "20261020" -> { t: epoch ms, allDay, ymd }
function stamp(value, p = {}) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2})?(Z)?$/);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0] = m.slice(1, 6).map(Number);
  const zone = m[6] ? 'UTC' : ZONES[p.TZID] ?? 'Europe/Berlin';
  let t;
  try { t = zoned([y, mo, d, h, mi], zone); } catch { return null; }
  return { t, allDay: p.VALUE === 'DATE', ymd: [y, mo, d], hm: [h, mi], zone };
}

function parseRule(s) {
  const r = Object.fromEntries(s.split(';').map((x) => x.split('=')));
  return {
    freq: r.FREQ, interval: Number(r.INTERVAL ?? 1), count: r.COUNT ? Number(r.COUNT) : Infinity,
    until: r.UNTIL ? stamp(r.UNTIL)?.t : Infinity,
    byday: r.BYDAY?.split(',') ?? null, bymonthday: r.BYMONTHDAY?.split(',').map(Number) ?? null, bymonth: r.BYMONTH?.split(',').map(Number) ?? null,
  };
}

// Does the calendar day `day` (UTC midnight of the local date) match the rule anchored at `start`?
function matches(rule, startDay, day) {
  const days = Math.round((day - startDay) / DAY_MS);
  if (days < 0) return false;
  const sd = new Date(startDay), d = new Date(day);
  if (rule.bymonth && !rule.bymonth.includes(d.getUTCMonth() + 1)) return false;
  switch (rule.freq) {
    case 'DAILY': return days % rule.interval === 0;
    case 'WEEKLY': {
      const weekStart = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS; // weeks start Monday
      const weeks = Math.round((weekStart(day) - weekStart(startDay)) / (7 * DAY_MS));
      const wanted = rule.byday?.map((x) => x.slice(-2)) ?? [DOW[sd.getUTCDay()]];
      return weeks % rule.interval === 0 && wanted.includes(DOW[d.getUTCDay()]);
    }
    case 'MONTHLY': {
      const months = (d.getUTCFullYear() - sd.getUTCFullYear()) * 12 + d.getUTCMonth() - sd.getUTCMonth();
      if (months % rule.interval) return false;
      if (rule.byday) {
        const nth = Math.ceil(d.getUTCDate() / 7);
        const fromEnd = -Math.ceil((new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() - d.getUTCDate() + 1) / 7);
        return rule.byday.some((x) => {
          const n = parseInt(x, 10);
          return x.slice(-2) === DOW[d.getUTCDay()] && (Number.isNaN(n) || n === nth || n === fromEnd);
        });
      }
      return (rule.bymonthday ?? [sd.getUTCDate()]).includes(d.getUTCDate());
    }
    case 'YEARLY': return d.getUTCMonth() === sd.getUTCMonth() && d.getUTCDate() === sd.getUTCDate() && (d.getUTCFullYear() - sd.getUTCFullYear()) % rule.interval === 0;
    default: return false;
  }
}

const clean = (s = '') => unescapeText(s)
  .split('\n').filter((l) => !/^[_\-=\s]*$/.test(l)).join('\n').split(/\n(?=Microsoft Teams|Join (the )?meeting|Besprechung beitreten|Teams-Besprechung)/)[0].trim().slice(0, 1500);

// Expand every event into concrete occurrences inside [from, to).
export function expand(ics, from, to) {
  const all = parseProps(ics).filter((e) => e.DTSTART && e.UID && e.STATUS?.value !== 'CANCELLED' && e['X-MICROSOFT-CDO-BUSYSTATUS']?.value !== 'FREE');
  const overrides = new Map(); // uid -> Set of original start times replaced by a single occurrence
  for (const e of all) if (e['RECURRENCE-ID']) {
    const id = stamp(e['RECURRENCE-ID'].value, e['RECURRENCE-ID'].p);
    if (id) (overrides.get(e.UID.value) ?? overrides.set(e.UID.value, new Set()).get(e.UID.value)).add(id.t);
  }
  const out = [];
  const push = (e, start, end) => {
    if (end <= from || start >= to) return;
    out.push({
      subject: unescapeText(e.SUMMARY?.value ?? '(no title)'), start, end,
      location: unescapeText(e.LOCATION?.value ?? ''), organizer: e.organizer, attendees: e.attendees,
      description: clean(e.DESCRIPTION?.value),
    });
  };
  for (const e of all) {
    const s = stamp(e.DTSTART.value, e.DTSTART.p);
    const en = e.DTEND && stamp(e.DTEND.value, e.DTEND.p);
    if (!s || s.allDay) continue; // all-day entries are not meetings
    const len = en ? en.t - s.t : 0;
    if (!e.RRULE) { push(e, s.t, s.t + len); continue; }
    if (e['RECURRENCE-ID']) { push(e, s.t, s.t + len); continue; }
    const rule = parseRule(e.RRULE.value);
    const skip = new Set([...(e.exdates ?? []).map((x) => x?.t), ...(overrides.get(e.UID.value) ?? [])]);
    const startDay = Date.UTC(...s.ymd.map((v, i) => (i === 1 ? v - 1 : v)));
    let n = 0;
    const last = to + DAY_MS;
    for (let day = startDay; day < last && n < rule.count; day += DAY_MS) {
      if (!matches(rule, startDay, day)) continue;
      const dt = new Date(day);
      const t = zoned([dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), ...s.hm], s.zone);
      if (t > rule.until) break;
      n++;
      if (!skip.has(t)) push(e, t, t + len);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Upcoming (not yet ended) meetings in the next `days` days, cached for a few minutes.
export async function upcoming(url, days = 7) {
  if (!url) return [];
  const now = Date.now();
  if (cache.url !== url || now - cache.at > TTL) {
    try {
      const res = await fetch(url.replace(/calendar\.html$/, 'calendar.ics'), { signal: AbortSignal.timeout(20e3) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache = { at: now, url, ics: await res.text() };
    } catch (err) {
      console.error(`calendar: ${err.message}`);
      cache.at = now - TTL + 30e3; // retry in 30 s, keep serving the old data
      cache.url = url;
    }
  }
  return cache.ics ? expand(cache.ics, now, now + days * DAY_MS).slice(0, 30) : [];
}

export const hhmm = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// The details the agent needs to brief the user on one meeting.
export function describe(m) {
  const when = `${new Date(m.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${hhmm(m.start)}-${hhmm(m.end)}`;
  return [
    `Subject: ${m.subject}`, `When: ${when}`,
    m.location && `Location: ${m.location}`, m.organizer && `Organizer: ${m.organizer}`,
    m.attendees.length && `Attendees: ${m.attendees.join(', ')}`, m.description && `Description:\n${m.description}`,
  ].filter(Boolean).join('\n');
}
