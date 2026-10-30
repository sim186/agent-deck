// Post-processing for Handy transcripts, modelled on Handy's own text pipeline:
// custom-word fuzzy correction, filler removal, stutter collapse, whitespace normalising.

const FILLERS = ['uh', 'uhm', 'um', 'umm', 'hmm', 'hm', 'mm', 'mhm', 'ah', 'eh', 'er', 'erm'];

// Levenshtein distance between two strings.
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

const SOUNDEX = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
function soundex(word) {
  let out = word[0].toUpperCase();
  let last = SOUNDEX[word[0]] ?? 0;
  for (const ch of word.slice(1)) {
    const code = SOUNDEX[ch] ?? 0;
    if (code && code !== last) out += code;
    if (ch !== 'h' && ch !== 'w') last = code;
  }
  return (out + '000').slice(0, 4);
}

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function matchCase(original, replacement) {
  if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) return replacement.toUpperCase();
  return replacement;
}

// Replaces 1-3 word spans that sound or look like a vocabulary term (names, product
// words) with the term itself. Lower score = closer; sound-alikes get a big boost.
export function applyCustomWords(text, vocabulary = [], threshold = 0.2) {
  const terms = vocabulary.map((term) => ({ term, key: key(term) })).filter((t) => t.key);
  if (!terms.length) return text;
  const words = text.split(/(\s+)/); // keeps whitespace tokens at odd indices
  const out = [];
  for (let i = 0; i < words.length; i += 2) {
    let best = null;
    for (let n = 3; n >= 1; n--) {
      const span = words.slice(i, i + 2 * n - 1);
      if (span.length < 2 * n - 1) continue;
      const tokens = span.filter((_, k) => k % 2 === 0);
      if (tokens.slice(0, -1).some((t) => /[.,;:!?]$/.test(t))) continue; // never merge across punctuation
      const lead = tokens[0].match(/^[^\p{L}\p{N}]*/u)[0];
      const trail = tokens[n - 1].match(/[^\p{L}\p{N}]*$/u)[0];
      const k = key(tokens.join(''));
      if (!k) continue;
      for (const t of terms) {
        const longer = Math.max(k.length, t.key.length);
        if (Math.abs(k.length - t.key.length) > Math.max(2, longer * 0.25)) continue;
        let score = distance(k, t.key) / longer;
        if (/^[a-z]+$/.test(k) && /^[a-z]+$/.test(t.key) && soundex(k) === soundex(t.key)) score *= 0.3;
        if (score < threshold && (!best || score < best.score)) {
          best = { score, n, text: lead + matchCase(tokens[0].replace(lead, ''), t.term) + trail };
        }
      }
    }
    if (best) {
      out.push(best.text, words[i + 2 * best.n - 1] ?? '');
      i += 2 * (best.n - 1);
    } else {
      out.push(words[i], words[i + 1] ?? '');
    }
  }
  return out.join('');
}

export function removeFillers(text, fillers = FILLERS) {
  const alt = fillers.join('|');
  // A filler opening a sentence hands its capital to the next word.
  const opener = new RegExp(`(^|[.!?]\\s+)(?:${alt})\\b[.,]?\\s+(\\p{L})`, 'giu');
  const inline = new RegExp(`\\s*\\b(?:${alt})\\b[.,]?(?=\\s|$)`, 'gi');
  return text.replace(opener, (_, pre, ch) => pre + ch.toUpperCase()).replace(inline, '').trim();
}

// Three or more identical words in a row become one; "no no" is left alone.
export function collapseStutters(text) {
  return text.replace(/\b(\p{L}+)(?:\s+\1\b){2,}/giu, '$1');
}

export function cleanTranscript(text, { vocabulary = [], fillers = true, threshold } = {}) {
  let out = text;
  out = applyCustomWords(out, vocabulary, threshold);
  if (fillers) out = removeFillers(out);
  return collapseStutters(out).replace(/\s+/g, ' ').trim();
}
