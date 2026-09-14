// R-peak detection: Pan-Tompkins style detector with adaptive thresholds,
// T-wave discrimination and search-back, followed by peak refinement on the
// clean (0.5-40 Hz) ECG.
import { bandpass, movingAverage } from './dsp.js';

function localMaxima(x, minDist) {
  const peaks = [];
  const n = x.length;
  let i = 1;
  while (i < n - 1) {
    if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] > 0) {
      // ensure it's the max within minDist
      let j = i + 1, isMax = true;
      const end = Math.min(n, i + minDist);
      for (; j < end; j++) if (x[j] > x[i]) { isMax = false; break; }
      if (isMax) { peaks.push(i); i = end; continue; }
      i = j;
    } else i++;
  }
  return peaks;
}

/**
 * @param {Float32Array} ecg raw ECG (uV)
 * @param {number} fs sampling rate
 * @param {Float32Array} clean bandpassed 0.5-40 Hz ECG used for refinement
 * @returns {{ rIdx: Int32Array, polarity: number, mwi: Float32Array }}
 */
export function detectRPeaks(ecg, fs, clean) {
  const n = ecg.length;
  const bp = bandpass(ecg, fs, 5, 15, 2);
  // derivative
  const der = new Float32Array(n);
  for (let i = 2; i < n - 2; i++) der[i] = (2 * bp[i + 1] + bp[i] - bp[i - 1] - 2 * bp[i - 2]) / 8;
  // square
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) sq[i] = der[i] * der[i];
  // moving window integration (150 ms)
  const W = Math.round(0.15 * fs);
  const mwi = movingAverage(sq, W);

  const refractory = Math.round(0.2 * fs);
  const tWaveWin = Math.round(0.36 * fs);
  const cands = localMaxima(mwi, Math.round(0.1 * fs));

  // learning phase
  const learnN = Math.min(n, Math.round(2 * fs));
  let mx = 0, sm = 0;
  for (let i = 0; i < learnN; i++) { if (mwi[i] > mx) mx = mwi[i]; sm += mwi[i]; }
  let SPKI = 0.5 * mx, NPKI = 0.5 * (sm / learnN);
  let thr1 = NPKI + 0.25 * (SPKI - NPKI);

  const qrs = [];
  const rrBuf = [];
  let rrAvg = 0;
  let lastQrs = -Infinity;
  let lastSlope = 0;
  let pendingNoise = []; // candidate peaks since last QRS, below threshold

  const slopeAt = (p) => {
    let m = 0;
    const a = Math.max(0, p - W), b = Math.min(n, p + 1);
    for (let i = a; i < b; i++) { const v = Math.abs(der[i]); if (v > m) m = v; }
    return m;
  };
  const acceptQrs = (p, val, searchback) => {
    if (searchback) SPKI = 0.25 * val + 0.75 * SPKI;
    else SPKI = 0.125 * Math.min(val, 4 * SPKI) + 0.875 * SPKI;
    if (lastQrs > -Infinity) {
      const rr = p - lastQrs;
      rrBuf.push(rr); if (rrBuf.length > 8) rrBuf.shift();
      rrAvg = rrBuf.reduce((a, b) => a + b, 0) / rrBuf.length;
    }
    lastQrs = p;
    lastSlope = slopeAt(p);
    qrs.push(p);
    pendingNoise = [];
    thr1 = NPKI + 0.25 * (SPKI - NPKI);
  };
  const acceptNoise = (val) => {
    NPKI = 0.125 * val + 0.875 * NPKI;
    thr1 = NPKI + 0.25 * (SPKI - NPKI);
  };

  for (let ci = 0; ci < cands.length; ci++) {
    const p = cands[ci];
    const val = mwi[p];
    // search-back if we've waited too long
    if (rrAvg > 0 && p - lastQrs > 1.66 * rrAvg && pendingNoise.length) {
      let best = -1, bestVal = 0.5 * thr1;
      for (const q of pendingNoise) {
        if (q - lastQrs > refractory && mwi[q] > bestVal) { best = q; bestVal = mwi[q]; }
      }
      if (best >= 0) acceptQrs(best, mwi[best], true);
    }
    if (p - lastQrs < refractory) continue;
    if (val > thr1) {
      // T-wave discrimination
      if (p - lastQrs < tWaveWin && lastSlope > 0) {
        const s = slopeAt(p);
        if (s < 0.5 * lastSlope) { acceptNoise(val); pendingNoise.push(p); continue; }
      }
      acceptQrs(p, val, false);
    } else {
      acceptNoise(val);
      pendingNoise.push(p);
    }
  }

  // ---- refine to R peaks on clean signal ----
  const back = W, fwd = Math.round(0.05 * fs);
  const rough = qrs.map((p) => {
    const a = Math.max(0, p - back), b = Math.min(n, p + fwd);
    let best = a, bv = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(clean[i]); if (v > bv) { bv = v; best = i; } }
    return best;
  });
  // dominant polarity from the first 300 detections
  let pos = 0, neg = 0;
  for (let i = 0; i < Math.min(rough.length, 300); i++) { if (clean[rough[i]] >= 0) pos++; else neg++; }
  const polarity = pos >= neg ? 1 : -1;
  const snap = Math.round(0.04 * fs);
  const refined = qrs.map((p, k) => {
    const a = Math.max(0, p - back), b = Math.min(n, p + fwd);
    let best = a, bv = -Infinity;
    for (let i = a; i < b; i++) { const v = polarity * clean[i]; if (v > bv) { bv = v; best = i; } }
    // if dominant-polarity extremum is tiny compared to opposite, fall back to abs extremum
    if (bv < 0.4 * Math.abs(clean[rough[k]])) best = rough[k];
    // snap to local extremum
    const a2 = Math.max(0, best - snap), b2 = Math.min(n, best + snap);
    let b3 = best, v3 = Math.abs(clean[best]);
    for (let i = a2; i < b2; i++) if (Math.abs(clean[i]) > v3 && Math.sign(clean[i]) === Math.sign(clean[best])) { v3 = Math.abs(clean[i]); b3 = i; }
    return b3;
  });
  refined.sort((a, b) => a - b);
  const out = [];
  for (const r of refined) {
    if (out.length && r - out[out.length - 1] < refractory) {
      // keep the larger
      if (Math.abs(clean[r]) > Math.abs(clean[out[out.length - 1]])) out[out.length - 1] = r;
      continue;
    }
    out.push(r);
  }
  return { rIdx: Int32Array.from(out), polarity, mwi };
}
