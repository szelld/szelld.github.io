// Beat classification (normal / ectopic / artifact), signal-quality
// segmentation and NN interval construction.
import { median } from './dsp.js';

export const BEAT_NORMAL = 0;
export const BEAT_ECTOPIC = 1;
export const BEAT_ARTIFACT = 2;

// segment quality flags (bit mask)
export const SQ_FLAT = 1, SQ_CLIP = 2, SQ_NOISE = 4, SQ_NOBEAT = 8;

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  const den = Math.sqrt(saa * sbb);
  return den > 0 ? sab / den : 0;
}

function localMedianRR(rr, half = 10) {
  const n = rr.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    const w = [];
    for (let k = a; k < b; k++) if (Number.isFinite(rr[k]) && rr[k] > 0) w.push(rr[k]);
    out[i] = w.length ? median(w) : NaN;
  }
  return out;
}

/**
 * Segment quality assessment.
 * @returns {{ segLen: number, flags: Uint8Array, noisyPct: number }}
 */
export function assessQuality(raw, clean, lp, fs, rIdx, physMax, segSeconds = 5) {
  const n = raw.length;
  const segLen = Math.round(segSeconds * fs);
  const nSeg = Math.ceil(n / segLen);
  const flags = new Uint8Array(nSeg);
  // beats per segment
  const beatsIn = new Uint16Array(nSeg);
  for (let i = 0; i < rIdx.length; i++) beatsIn[Math.min(nSeg - 1, Math.floor(rIdx[i] / segLen))]++;
  // median QRS peak-to-peak for scaling noise
  const clipLevel = physMax ? 0.98 * Math.abs(physMax) : Infinity;
  const hfRms = new Float32Array(nSeg);
  for (let s = 0; s < nSeg; s++) {
    const a = s * segLen, b = Math.min(n, a + segLen);
    let sum = 0, sum2 = 0, clip = 0, hf2 = 0;
    for (let k = a; k < b; k++) {
      const v = clean[k]; sum += v; sum2 += v * v;
      if (Math.abs(raw[k]) >= clipLevel) clip++;
      const h = clean[k] - lp[k]; hf2 += h * h;
    }
    const cnt = b - a;
    const sd = Math.sqrt(Math.max(0, sum2 / cnt - (sum / cnt) ** 2));
    hfRms[s] = Math.sqrt(hf2 / cnt);
    if (sd < 5) flags[s] |= SQ_FLAT;
    if (clip / cnt > 0.02) flags[s] |= SQ_CLIP;
    const expectedMin = Math.floor(segSeconds * 0.4); // < 24 bpm => missing beats
    if (beatsIn[s] < expectedMin && !(flags[s] & SQ_FLAT) && s > 0 && s < nSeg - 1) flags[s] |= SQ_NOBEAT;
  }
  const hfMed = median(hfRms);
  const hfThr = Math.max(40, 4 * hfMed);
  for (let s = 0; s < nSeg; s++) if (hfRms[s] > hfThr) flags[s] |= SQ_NOISE;
  let bad = 0; for (let s = 0; s < nSeg; s++) if (flags[s]) bad++;
  return { segLen, flags, hfRms, noisyPct: nSeg ? 100 * bad / nSeg : 0 };
}

/**
 * Classify beats.
 * @returns {{ type: Uint8Array, corr: Float32Array, ampRatio: Float32Array, rrPrev: Float32Array, rrNext: Float32Array, localMed: Float32Array }}
 */
export function classifyBeats(clean, fs, rIdx, delin, quality) {
  const nb = rIdx.length;
  const n = clean.length;
  const type = new Uint8Array(nb);
  const corr = new Float32Array(nb).fill(NaN);
  const ampRatio = new Float32Array(nb).fill(NaN);

  // RR arrays (ms)
  const rrPrev = new Float32Array(nb).fill(NaN), rrNext = new Float32Array(nb).fill(NaN);
  for (let i = 1; i < nb; i++) { rrPrev[i] = (rIdx[i] - rIdx[i - 1]) * 1000 / fs; rrNext[i - 1] = rrPrev[i]; }
  const localMed = localMedianRR(rrPrev, 10);

  // --- template correlation on QRS window ---
  const half = Math.round(0.1 * fs), L = 2 * half + 1;
  const win = (i) => {
    const r = rIdx[i];
    if (r - half < 0 || r + half >= n) return null;
    return clean.subarray(r - half, r + half + 1);
  };
  // initial template: element-wise median of first 60 usable beats
  const initBeats = [];
  for (let i = 0; i < nb && initBeats.length < 60; i++) { const w = win(i); if (w) initBeats.push(w); }
  const tpl = new Float64Array(L);
  if (initBeats.length) {
    const col = new Float64Array(initBeats.length);
    for (let k = 0; k < L; k++) {
      for (let j = 0; j < initBeats.length; j++) col[j] = initBeats[j][k];
      tpl[k] = median(col);
    }
  }
  let tplEnergy = 0; for (let k = 0; k < L; k++) tplEnergy += tpl[k] * tpl[k];
  const noiseMed = median(Array.from(delin.noise).filter(Number.isFinite)) || 10;
  const ppMed = median(Array.from(delin.ppAmp).filter(Number.isFinite)) || 1000;

  for (let i = 0; i < nb; i++) {
    const w = win(i);
    if (!w) { type[i] = BEAT_ARTIFACT; continue; }
    const c = pearson(w, tpl);
    corr[i] = c;
    let e = 0; for (let k = 0; k < L; k++) e += w[k] * w[k];
    ampRatio[i] = tplEnergy > 0 ? Math.sqrt(e / tplEnergy) : 1;
    if (c > 0.95 && ampRatio[i] > 0.7 && ampRatio[i] < 1.4) {
      for (let k = 0; k < L; k++) tpl[k] = 0.98 * tpl[k] + 0.02 * w[k];
      tplEnergy = 0; for (let k = 0; k < L; k++) tplEnergy += tpl[k] * tpl[k];
    }

    const seg = Math.min(quality.flags.length - 1, Math.floor(rIdx[i] / quality.segLen));
    const noisySeg = (quality.flags[seg] & (SQ_FLAT | SQ_CLIP | SQ_NOISE)) !== 0;
    const beatNoise = delin.noise[i];
    const highNoise = Number.isFinite(beatNoise) && beatNoise > Math.max(4 * noiseMed, 0.25 * ppMed);
    const rp = rrPrev[i], rn = rrNext[i], lm = localMed[i];

    const implausibleRR = (Number.isFinite(rp) && rp < 250) || (Number.isFinite(rn) && rn < 250);
    const premature = Number.isFinite(rp) && Number.isFinite(lm) && rp < 0.8 * lm;
    const compensatory = Number.isFinite(rn) && Number.isFinite(lm) && rn > 1.12 * lm;
    // premature beat followed by a pause that roughly restores the rhythm (rp + rn ~ 2 * lm)
    const coupled = premature && Number.isFinite(rn) && Math.abs(rp + rn - 2 * lm) < 0.25 * lm;
    const abnormalMorph = c < 0.85 || ampRatio[i] < 0.55 || ampRatio[i] > 1.8;

    if (noisySeg || highNoise || implausibleRR || ampRatio[i] < 0.3 || ampRatio[i] > 3) {
      type[i] = BEAT_ARTIFACT;
      continue;
    }
    if (c < 0.5 && !premature) {
      // very different morphology without rhythm disturbance: most likely noise detected as a beat
      type[i] = BEAT_ARTIFACT;
      continue;
    }
    if (coupled || (premature && (compensatory || abnormalMorph || rp < 0.7 * lm)) || abnormalMorph) {
      type[i] = BEAT_ECTOPIC;
    } else {
      type[i] = BEAT_NORMAL;
    }
  }
  return { type, corr, ampRatio, rrPrev, rrNext, localMed, template: Float32Array.from(tpl), templateHalf: half };
}

/**
 * Build NN intervals (normal-to-normal) with plausibility filtering.
 * @returns {{ t: Float64Array, nn: Float64Array, idx: Int32Array, rejectedPct: number }}
 *   t: time (s) of the interval end beat; nn: interval (ms); idx: beat index of interval end
 */
export function buildNN(rIdx, fs, type, rrPrev, localMed) {
  const t = [], nn = [], idx = [];
  let rejected = 0, total = 0;
  for (let i = 1; i < rIdx.length; i++) {
    total++;
    if (type[i] !== BEAT_NORMAL || type[i - 1] !== BEAT_NORMAL) { rejected++; continue; }
    const rr = rrPrev[i], lm = localMed[i];
    if (!(rr >= 300 && rr <= 2000)) { rejected++; continue; }
    if (Number.isFinite(lm) && Math.abs(rr - lm) > 0.35 * lm) { rejected++; continue; }
    t.push(rIdx[i] / fs); nn.push(rr); idx.push(i);
  }
  return { t: Float64Array.from(t), nn: Float64Array.from(nn), idx: Int32Array.from(idx), rejectedPct: total ? 100 * rejected / total : 0 };
}
