// Per-beat wave delineation on a single ECG lead.
// Inputs: clean = 0.5-40 Hz ECG (uV), lp = 0.5-15 Hz ECG, fs, R fiducials.
// Outputs typed arrays per beat (sample indexes as Int32 with -1 = invalid,
// measurements as Float32 with NaN = invalid).
import { lowpass, movingAverage } from './dsp.js';

function medianOf(arr) {
  const a = Array.from(arr).sort((p, q) => p - q);
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[n >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

export function smoothDerivative(x, fs) {
  const n = x.length, d = new Float32Array(n);
  const k = fs / 10; // 5-point derivative -> uV/s
  for (let i = 2; i < n - 2; i++) d[i] = (-2 * x[i - 2] - x[i - 1] + x[i + 1] + 2 * x[i + 2]) * k;
  return d;
}

export function delineate(clean, fs, rIdx, opts = {}) {
  const n = clean.length;
  const nb = rIdx.length;
  const lp = opts.lp || lowpass(clean, fs, 15, 4);
  const sm = movingAverage(clean, Math.max(3, Math.round(0.012 * fs)));
  const d = smoothDerivative(clean, fs);
  const ms = (v) => Math.round(v * fs / 1000);

  const qrsOn = new Int32Array(nb).fill(-1), qrsOff = new Int32Array(nb).fill(-1);
  const rPk = new Int32Array(nb).fill(-1), sPk = new Int32Array(nb).fill(-1), qPk = new Int32Array(nb).fill(-1);
  const tPk = new Int32Array(nb).fill(-1), tEnd = new Int32Array(nb).fill(-1);
  const pOn = new Int32Array(nb).fill(-1), pPk = new Int32Array(nb).fill(-1), pOff = new Int32Array(nb).fill(-1);
  const baseline = new Float32Array(nb).fill(NaN);
  const qrsDur = new Float32Array(nb).fill(NaN);
  const rAmp = new Float32Array(nb).fill(NaN), sAmp = new Float32Array(nb).fill(NaN), qAmp = new Float32Array(nb).fill(NaN);
  const ppAmp = new Float32Array(nb).fill(NaN);
  const jAmp = new Float32Array(nb).fill(NaN), st60 = new Float32Array(nb).fill(NaN);
  const tAmp = new Float32Array(nb).fill(NaN), qt = new Float32Array(nb).fill(NaN);
  const pAmp = new Float32Array(nb).fill(NaN), pr = new Float32Array(nb).fill(NaN), pDur = new Float32Array(nb).fill(NaN);
  const noise = new Float32Array(nb).fill(NaN);

  // slope thresholds relative to the max QRS slope; the S-wave tail returns slowly,
  // so the offset uses a slightly higher threshold than the onset
  const onFrac = opts.slopeThrFrac ?? opts.onsetFrac ?? 0.1;
  const offFrac = opts.slopeThrFrac ?? opts.offsetFrac ?? 0.15;
  const sustain = Math.max(3, ms(15));
  const w60 = ms(60), w120 = ms(120), w150 = ms(150);

  for (let i = 0; i < nb; i++) {
    const r = rIdx[i];
    const prevR = i > 0 ? rIdx[i - 1] : -1;
    const nextR = i < nb - 1 ? rIdx[i + 1] : n;
    if (r < w150 + 5 || r > n - w150 - 5) continue;

    // --- noise: HF residual (15-40 Hz) outside the QRS complex ---
    {
      let s = 0, s2 = 0, c = 0;
      const wins = [[r - ms(320), r - ms(90)], [r + ms(130), r + ms(420)]];
      for (const [a0, b0] of wins) {
        const a = Math.max(0, a0), b = Math.min(n, b0);
        for (let k = a; k < b; k++) { const v = clean[k] - lp[k]; s += v; s2 += v * v; c++; }
      }
      noise[i] = c > 1 ? Math.sqrt(Math.max(0, s2 / c - (s / c) * (s / c))) : NaN;
    }

    // --- max slope around R ---
    let M = 0;
    for (let k = Math.max(0, r - w60); k < Math.min(n, r + w60); k++) { const v = Math.abs(d[k]); if (v > M) M = v; }
    if (M <= 0) continue;
    const thrOn = onFrac * M, thrOff = offFrac * M;

    // --- QRS onset: walk backwards until slope stays low for `sustain` samples ---
    let on = -1, cnt = 0;
    const onLimit = Math.max(prevR + ms(80), r - w120, 0);
    for (let k = r - 1; k >= onLimit; k--) {
      if (Math.abs(d[k]) < thrOn) { cnt++; if (cnt >= sustain) { on = k + sustain - 1; break; } }
      else cnt = 0;
    }
    if (on < 0) on = onLimit;
    // --- QRS offset (J point) ---
    let off = -1; cnt = 0;
    const offLimit = Math.min(nextR - ms(80), r + w150, n - 1);
    for (let k = r + 1; k <= offLimit; k++) {
      if (Math.abs(d[k]) < thrOff) { cnt++; if (cnt >= sustain) { off = k - sustain + 1; break; } }
      else cnt = 0;
    }
    if (off < 0) off = offLimit;
    qrsOn[i] = on; qrsOff[i] = off;
    qrsDur[i] = (off - on) * 1000 / fs;

    // --- baseline from PR segment (just before onset) ---
    {
      const a = Math.max(0, on - w60), b = Math.max(a + 1, on - ms(10));
      baseline[i] = medianOf(clean.subarray(a, b));
    }
    const base = baseline[i];

    // --- Q, R, S ---
    let rmax = on, smin = on;
    for (let k = on; k <= off; k++) { if (clean[k] > clean[rmax]) rmax = k; if (clean[k] < clean[smin]) smin = k; }
    rPk[i] = rmax; rAmp[i] = clean[rmax] - base;
    // S: minimum after R peak; Q: minimum before R peak
    let s = rmax; for (let k = rmax; k <= off; k++) if (clean[k] < clean[s]) s = k;
    let q = rmax; for (let k = on; k <= rmax; k++) if (clean[k] < clean[q]) q = k;
    sPk[i] = s; sAmp[i] = clean[s] - base;
    qPk[i] = q; qAmp[i] = clean[q] - base;
    ppAmp[i] = clean[rmax] - Math.min(clean[s], clean[q]);
    jAmp[i] = clean[off] - base;
    if (off + w60 < n) st60[i] = clean[off + w60] - base;

    // --- T wave ---
    {
      const rrNext = (nextR - r) / fs;
      const rrRef = Number.isFinite(rrNext) && nextR < n ? rrNext : (prevR >= 0 ? (r - prevR) / fs : 0.8);
      const limit = Math.min(n - 2, r + ms(Math.min(1000 * 0.62 * rrRef, 700)), nextR - ms(120));
      const start = off + ms(50);
      if (limit - start > ms(80)) {
        let tp = start, tv = 0;
        for (let k = start; k <= limit; k++) { const v = Math.abs(lp[k] - base); if (v > tv) { tv = v; tp = k; } }
        const amp = lp[tp] - base;
        const noiseLvl = Number.isFinite(noise[i]) ? noise[i] : 20;
        if (Math.abs(amp) > Math.max(30, 2.5 * noiseLvl) && tp > start && tp < limit) {
          tPk[i] = tp; tAmp[i] = amp;
          // tangent method on descending limb
          const sgn = amp > 0 ? 1 : -1;
          let km = tp, sm = 0;
          for (let k = tp; k <= limit; k++) { const v = -sgn * d[k]; if (v > sm) { sm = v; km = k; } }
          if (sm > 0) {
            const slopePerSample = d[km] / fs; // uV per sample
            let te = km + (base - lp[km]) / slopePerSample;
            if (te > tp && te < limit + ms(60)) {
              tEnd[i] = Math.round(te);
              qt[i] = (te - on) * 1000 / fs;
            }
          }
        }
      }
    }

    // --- P wave (on lightly smoothed 40 Hz signal; the 15 Hz version smears the QRS into the PR segment) ---
    {
      const start = Math.max(prevR >= 0 ? prevR + ms(200) : 0, on - ms(260));
      const end = on - ms(25);
      if (end - start > ms(60)) {
        // baseline: PR segment (base) blended with the window start (TP segment)
        let pb = 0, c = 0;
        for (let k = start; k < Math.min(end, start + ms(30)); k++) { pb += sm[k]; c++; }
        pb = c ? pb / c : base;
        const pbase = 0.5 * (pb + base);
        let pp = start, pv = 0;
        for (let k = start + ms(20); k <= end; k++) { const v = Math.abs(sm[k] - pbase); if (v > pv) { pv = v; pp = k; } }
        const amp = sm[pp] - pbase;
        const noiseLvl = Number.isFinite(noise[i]) ? noise[i] : 20;
        if (Math.abs(amp) > Math.max(25, 2.5 * noiseLvl) && pp > start + ms(20) && pp < end) {
          const thrP = 0.3 * Math.abs(amp);
          let a = pp; while (a > start && Math.abs(sm[a] - pbase) > thrP && Math.sign(sm[a] - pbase) === Math.sign(amp)) a--;
          let b = pp; while (b < end && Math.abs(sm[b] - pbase) > thrP && Math.sign(sm[b] - pbase) === Math.sign(amp)) b++;
          const dur = (b - a) * 1000 / fs;
          if (dur >= 40 && dur <= 200) {
            pPk[i] = pp; pOn[i] = a; pOff[i] = b; pAmp[i] = amp;
            pDur[i] = dur; pr[i] = (on - a) * 1000 / fs;
          }
        }
      }
    }
  }

  return { qrsOn, qrsOff, rPk, sPk, qPk, tPk, tEnd, pOn, pPk, pOff, baseline, qrsDur, rAmp, sAmp, qAmp, ppAmp, jAmp, st60, tAmp, qt, pAmp, pr, pDur, noise, lp };
}
