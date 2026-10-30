// Picks where to cut a long recording: the middle of the silence closest to each
// nominal boundary (multiples of `target` seconds), within `window` seconds of it.

// ffmpeg silencedetect logs "silence_start: 12.3" and "silence_end: 14.1" on stderr.
export function parseSilences(log) {
  const starts = [...log.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return ends.map((end, i) => [Math.max(0, starts[i] ?? end), end]);
}

export function chooseCuts(silences, total, target = 300, window = 60) {
  const cuts = [];
  let last = 0;
  for (let t = target; t < total - window; t += target) {
    const mids = silences.map(([a, b]) => (a + b) / 2).filter((m) => m > last + 30 && Math.abs(m - t) <= window);
    const cut = mids.length ? mids.reduce((x, y) => (Math.abs(y - t) < Math.abs(x - t) ? y : x)) : t;
    cuts.push(Number(cut.toFixed(2)));
    last = cut;
    t = cut; // next boundary is one target after the actual cut
  }
  return cuts;
}
