// Provider usage limits for the limit tiles. Same sources as the open-source Token Monitor:
//   - claude:   api.anthropic.com/api/oauth/usage with the Claude Code OAuth token
//   - codex:    chatgpt.com/backend-api/wham/usage with the Codex CLI token
//   - opencode: opencode.ai/zen/go/v1/usage with the Go key from opencode's auth.json. If that is
//               unavailable, the cost of Go assistant messages is summed from the local opencode.db
//               and compared with the published plan limits (misses usage from other machines).
// Tokens are read from the CLIs' own credential files and only ever sent to their own vendor.
// Nothing here refreshes a token: the CLIs do that themselves, until then the tile shows "login".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TTL = 5 * 60e3;
const BACKOFF = 15 * 60e3; // after a 429 or an error
const HOUR = 3600e3;
const DAY = 24 * HOUR;
// OpenCode Go plan limits in USD (https://opencode.ai/docs/go/). Override with `opencodeLimits`.
const GO_LIMITS = { session: 12, weekly: 30, monthly: 60 };

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const home = os.homedir();

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw Object.assign(new Error(`${url} -> ${res.status}`), { status: res.status });
  return res.json();
}

const asMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

// ---------- claude ----------

async function claude(window) {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), '.credentials.json');
  const oauth = readJson(file).claudeAiOauth;
  if (!oauth?.accessToken || (oauth.expiresAt && oauth.expiresAt < Date.now())) throw Object.assign(new Error('login'), { status: 401 });
  const usage = await getJson('https://api.anthropic.com/api/oauth/usage', {
    authorization: `Bearer ${oauth.accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'user-agent': 'claude-cli/2.1.280 (external, cli)',
  });
  const w = usage[window === 'session' ? 'five_hour' : 'seven_day'];
  if (!w) throw new Error('no window');
  return { used: w.utilization ?? w.used_percent, resetsAt: asMs(w.resets_at) };
}

// ---------- codex ----------

async function codex(window) {
  const auth = readJson(path.join(process.env.CODEX_HOME ?? path.join(home, '.codex'), 'auth.json'));
  const token = auth.tokens?.access_token;
  if (!token) throw Object.assign(new Error('login'), { status: 401 });
  const headers = { authorization: `Bearer ${token}`, 'user-agent': 'agent-deck' };
  if (auth.tokens.account_id) headers['chatgpt-account-id'] = auth.tokens.account_id;
  const usage = await getJson('https://chatgpt.com/backend-api/wham/usage', headers);
  const rl = usage.rate_limit ?? usage.rateLimit ?? {};
  const wins = [rl.primary_window, rl.secondary_window].filter(Boolean);
  const secs = (w) => Number(w.limit_window_seconds ?? 0);
  const w = window === 'session'
    ? wins.find((x) => secs(x) && secs(x) <= DAY / 1000) ?? wins[0]
    : wins.find((x) => secs(x) >= 7 * DAY / 1000) ?? rl.secondary_window;
  if (!w) throw new Error('no window');
  return { used: w.used_percent, resetsAt: asMs(w.reset_at ?? w.resets_at) };
}

// ---------- opencode go ----------

function goRows() {
  const dir = path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'opencode');
  let files = [];
  try { files = fs.readdirSync(dir).filter((n) => /^opencode(-[\w.-]+)?\.db$/.test(n)); } catch { /* none */ }
  const rows = [];
  // Loaded lazily: node:sqlite is only needed (and only available on Node >= 22.5) for this provider.
  return import('node:sqlite').then(({ DatabaseSync }) => {
    for (const name of files) {
      const db = new DatabaseSync(path.join(dir, name), { readOnly: true });
      try {
        db.exec('PRAGMA busy_timeout = 250');
        rows.push(...db.prepare(`
          SELECT CAST(COALESCE(json_extract(data,'$.time.created'), time_created) AS INTEGER) AS at,
                 CAST(json_extract(data,'$.cost') AS REAL) AS cost
          FROM message
          WHERE json_valid(data) AND json_extract(data,'$.providerID') = 'opencode-go'
            AND json_extract(data,'$.role') = 'assistant' AND json_type(data,'$.cost') IN ('integer','real')`).all());
      } finally { db.close(); }
    }
    return rows.filter((r) => r.at > 0 && r.cost >= 0);
  });
}

// Billing month: starts on the day-of-month of the first recorded usage.
function monthBounds(now, anchor) {
  const a = new Date(anchor);
  const at = (y, m) => Date.UTC(y, m, Math.min(a.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds());
  const n = new Date(now);
  let y = n.getUTCFullYear();
  let m = n.getUTCMonth();
  if (at(y, m) > now) { m--; if (m < 0) { m = 11; y--; } }
  const end = m === 11 ? at(y + 1, 0) : at(y, m + 1);
  return [at(y, m), end];
}

// Official usage endpoint, authenticated with the key `opencode` stores for the Go plan.
async function goApi(window) {
  const file = path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'opencode', 'auth.json');
  const entry = readJson(file)['opencode-go'];
  if (entry?.type !== 'api' || !entry.key) throw Object.assign(new Error('no key'), { status: 'empty' });
  const usage = (await getJson('https://opencode.ai/zen/go/v1/usage', { authorization: `Bearer ${entry.key}` })).usage;
  const w = usage?.[window === 'session' ? 'rolling' : window];
  if (!w || !Number.isFinite(Number(w.percent))) throw new Error('no window');
  return { used: Number(w.percent), resetsAt: asMs(w.resetsAt) };
}

async function opencode(window, opts) {
  try {
    return await goApi(window);
  } catch (err) {
    if (err.status === 401) throw err; // a rejected key is not a reason to guess
  }
  // No key or the API is down: estimate from what this machine recorded.
  const rows = await goRows();
  if (!rows.length) throw Object.assign(new Error('no usage'), { status: 'empty' });
  const limits = { ...GO_LIMITS, ...opts.opencodeLimits };
  const now = Date.now();
  let from;
  let to;
  if (window === 'session') {
    from = now - 5 * HOUR;
    to = now + 1;
  } else if (window === 'weekly') {
    const d = new Date(now);
    from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    to = from + 7 * DAY;
  } else {
    [from, to] = monthBounds(now, Math.min(...rows.map((r) => r.at)));
  }
  const spent = rows.filter((r) => r.at >= from && r.at < to).reduce((s, r) => s + r.cost, 0);
  const oldest = Math.min(now, ...rows.filter((r) => r.at >= from && r.at < to).map((r) => r.at));
  return { used: (spent / limits[window]) * 100, resetsAt: window === 'session' ? oldest + 5 * HOUR : to };
}

// ---------- cache ----------

const PROVIDERS = { claude, codex, opencode };
const cache = new Map(); // "provider|window" -> { at, value, error, pending }

// Last known reading for a tile, refreshed in the background when stale.
// Returns { used (percent), resetsAt (ms), error } - any may be missing before the first fetch.
export function limit(provider, window, opts = {}) {
  const id = `${provider}|${window}`;
  const entry = cache.get(id) ?? { at: 0 };
  cache.set(id, entry);
  const age = Date.now() - entry.at;
  if (!entry.pending && age > (entry.error ? BACKOFF : TTL)) {
    entry.pending = PROVIDERS[provider]?.(window, opts)
      .then((value) => { entry.value = value; entry.error = null; })
      .catch((err) => { entry.error = err.status === 401 ? 'login' : err.status === 'empty' ? 'none' : 'n/a'; })
      .finally(() => { entry.at = Date.now(); entry.pending = null; opts.onChange?.(); });
  }
  return { ...entry.value, error: entry.error };
}

// Force the next read of every limit to refetch (key press).
export const refreshLimits = () => { for (const e of cache.values()) e.at = 0; };
