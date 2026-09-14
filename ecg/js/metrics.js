// All HR / HRV / morphology / rhythm / quality metrics derived from the beat
// annotations. Pure functions; run inside the worker.
import {
  mean, std, median, quantile, sorted, quantileSorted, resampleUniform, linearDetrend,
  welch, bandPower, bandPeak,
} from './dsp.js';
import { BEAT_NORMAL, BEAT_ECTOPIC, BEAT_ARTIFACT } from './beats.js';

// Metric metadata: key, group, unit, decimals. Labels/descriptions live in i18n.
export const METRICS = [
  // heart rate
  { key: 'meanHR', group: 'hr', unit: 'bpm', dec: 0 },
  { key: 'meanHRfromNN', group: 'hr', unit: 'bpm', dec: 1 },
  { key: 'minHR', group: 'hr', unit: 'bpm', dec: 0, time: 'minHRtime' },
  { key: 'maxHR', group: 'hr', unit: 'bpm', dec: 0, time: 'maxHRtime' },
  { key: 'hi1minHR', group: 'hr', unit: 'bpm', dec: 0, time: 'hi1minTime' },
  { key: 'lo1minHR', group: 'hr', unit: 'bpm', dec: 0, time: 'lo1minTime' },
  { key: 'restingHR', group: 'hr', unit: 'bpm', dec: 0 },
  { key: 'tachyPct', group: 'hr', unit: '%', dec: 2 },
  { key: 'bradyPct', group: 'hr', unit: '%', dec: 2 },
  { key: 'tachyEpisodes', group: 'hr', unit: '', dec: 0 },
  { key: 'bradyEpisodes', group: 'hr', unit: '', dec: 0 },
  { key: 'hrMaxUsed', group: 'hr', unit: 'bpm', dec: 0 },
  { key: 'effortIndex', group: 'hr', unit: '', dec: 0 },
  { key: 'trimp', group: 'hr', unit: '', dec: 0 },
  // time domain
  { key: 'meanNN', group: 'time', unit: 'ms', dec: 1 },
  { key: 'medianNN', group: 'time', unit: 'ms', dec: 1 },
  { key: 'minNN', group: 'time', unit: 'ms', dec: 0 },
  { key: 'maxNN', group: 'time', unit: 'ms', dec: 0 },
  { key: 'sdnn', group: 'time', unit: 'ms', dec: 1 },
  { key: 'rmssd', group: 'time', unit: 'ms', dec: 1 },
  { key: 'lnRmssd', group: 'time', unit: '', dec: 2 },
  { key: 'sdsd', group: 'time', unit: 'ms', dec: 1 },
  { key: 'nn50', group: 'time', unit: '', dec: 0 },
  { key: 'pnn50', group: 'time', unit: '%', dec: 1 },
  { key: 'nn20', group: 'time', unit: '', dec: 0 },
  { key: 'pnn20', group: 'time', unit: '%', dec: 1 },
  { key: 'pnn200', group: 'time', unit: '%', dec: 2 },
  { key: 'cvnn', group: 'time', unit: '%', dec: 1 },
  { key: 'sdann', group: 'time', unit: 'ms', dec: 1 },
  { key: 'sdnnIndex', group: 'time', unit: 'ms', dec: 1 },
  { key: 'hrvTriIndex', group: 'time', unit: '', dec: 1 },
  { key: 'tinn', group: 'time', unit: 'ms', dec: 0 },
  { key: 'stressIndex', group: 'time', unit: '', dec: 1 },
  { key: 'pnn50Episodes', group: 'time', unit: '', dec: 0 },
  // frequency domain
  { key: 'vlfPower', group: 'freq', unit: 'ms²', dec: 0 },
  { key: 'lfPower', group: 'freq', unit: 'ms²', dec: 0 },
  { key: 'hfPower', group: 'freq', unit: 'ms²', dec: 0 },
  { key: 'totalPower', group: 'freq', unit: 'ms²', dec: 0 },
  { key: 'vlfPct', group: 'freq', unit: '%', dec: 1 },
  { key: 'lfPct', group: 'freq', unit: '%', dec: 1 },
  { key: 'hfPct', group: 'freq', unit: '%', dec: 1 },
  { key: 'lfNu', group: 'freq', unit: 'n.u.', dec: 1 },
  { key: 'hfNu', group: 'freq', unit: 'n.u.', dec: 1 },
  { key: 'lfHf', group: 'freq', unit: '', dec: 2 },
  { key: 'lnLf', group: 'freq', unit: '', dec: 2 },
  { key: 'lnHf', group: 'freq', unit: '', dec: 2 },
  { key: 'vlfPeak', group: 'freq', unit: 'Hz', dec: 4 },
  { key: 'lfPeak', group: 'freq', unit: 'Hz', dec: 3 },
  { key: 'hfPeak', group: 'freq', unit: 'Hz', dec: 3 },
  // nonlinear
  { key: 'sd1', group: 'nonlinear', unit: 'ms', dec: 1 },
  { key: 'sd2', group: 'nonlinear', unit: 'ms', dec: 1 },
  { key: 'sd1sd2', group: 'nonlinear', unit: '', dec: 3 },
  { key: 'ellipseArea', group: 'nonlinear', unit: 'ms²', dec: 0 },
  { key: 'sampEn', group: 'nonlinear', unit: '', dec: 3 },
  { key: 'apEn', group: 'nonlinear', unit: '', dec: 3 },
  { key: 'dfaAlpha1', group: 'nonlinear', unit: '', dec: 3 },
  { key: 'dfaAlpha2', group: 'nonlinear', unit: '', dec: 3 },
  { key: 'shannonEntropy', group: 'nonlinear', unit: 'bit', dec: 2 },
  // morphology
  { key: 'qrsMean', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qrsMedian', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qrsSd', group: 'morph', unit: 'ms', dec: 1 },
  { key: 'qtMean', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcMean', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcMedian', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcSd', group: 'morph', unit: 'ms', dec: 1 },
  { key: 'qtcP95', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcBazett', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcFridericia', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcFramingham', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'qtcHodges', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'tDetectPct', group: 'morph', unit: '%', dec: 0 },
  { key: 'tPositivePct', group: 'morph', unit: '%', dec: 0 },
  { key: 'tAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'rAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'sAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'qAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'qrsAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'jAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'st60Mean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'prMean', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'pDurMean', group: 'morph', unit: 'ms', dec: 0 },
  { key: 'pAmpMean', group: 'morph', unit: 'µV', dec: 0 },
  { key: 'pDetectPct', group: 'morph', unit: '%', dec: 0 },
  // respiration
  { key: 'respRateEDR', group: 'resp', unit: '/min', dec: 1 },
  { key: 'respRateRSA', group: 'resp', unit: '/min', dec: 1 },
  // rhythm & quality
  { key: 'beats', group: 'rhythm', unit: '', dec: 0 },
  { key: 'normalBeats', group: 'rhythm', unit: '', dec: 0 },
  { key: 'ectopicBeats', group: 'rhythm', unit: '', dec: 0 },
  { key: 'ectopicPct', group: 'rhythm', unit: '%', dec: 2 },
  { key: 'artifactBeats', group: 'rhythm', unit: '', dec: 0 },
  { key: 'artifactPct', group: 'rhythm', unit: '%', dec: 2 },
  { key: 'noisyPct', group: 'rhythm', unit: '%', dec: 1 },
  { key: 'nnRejectedPct', group: 'rhythm', unit: '%', dec: 1 },
  { key: 'meanCorr', group: 'rhythm', unit: '', dec: 3 },
  { key: 'irregularPct', group: 'rhythm', unit: '%', dec: 1 },
  { key: 'nnCv', group: 'rhythm', unit: '%', dec: 1 },
  { key: 'duration', group: 'rhythm', unit: 's', dec: 0 },
];

export const QTC_FORMULAS = ['bazett', 'fridericia', 'framingham', 'hodges'];
export function qtcCorrect(qt, rrSec, formula) {
  switch (formula) {
    case 'fridericia': return qt / Math.cbrt(rrSec);
    case 'framingham': return qt + 154 * (1 - rrSec);
    case 'hodges': return qt + 1.75 * (60 / rrSec - 60);
    default: return qt / Math.sqrt(rrSec);
  }
}

const finite = (arr) => { const o = []; for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) o.push(arr[i]); return o; };
const safe = (fn, ...a) => { try { const v = fn(...a); return Number.isFinite(v) ? v : NaN; } catch { return NaN; } };

// ---------- time domain ----------
export function timeDomain(nn, adjacent) {
  // adjacent[k] true if nn[k] and nn[k-1] are consecutive beats
  const n = nn.length;
  const out = {};
  if (n < 2) return out;
  out.meanNN = mean(nn); out.medianNN = median(nn);
  out.minNN = Math.min(...nn.length > 1e5 ? [NaN] : nn); out.maxNN = Math.max(...nn.length > 1e5 ? [NaN] : nn);
  if (!Number.isFinite(out.minNN)) { let mi = Infinity, ma = -Infinity; for (const v of nn) { if (v < mi) mi = v; if (v > ma) ma = v; } out.minNN = mi; out.maxNN = ma; }
  out.sdnn = std(nn);
  out.cvnn = 100 * out.sdnn / out.meanNN;
  const d = [];
  for (let k = 1; k < n; k++) if (!adjacent || adjacent[k]) d.push(nn[k] - nn[k - 1]);
  if (d.length) {
    let s2 = 0, n50 = 0, n20 = 0, n200 = 0;
    for (const v of d) { s2 += v * v; const a = Math.abs(v); if (a > 50) n50++; if (a > 20) n20++; if (a > 200) n200++; }
    out.rmssd = Math.sqrt(s2 / d.length);
    out.lnRmssd = Math.log(out.rmssd);
    out.sdsd = std(d);
    out.nn50 = n50; out.pnn50 = 100 * n50 / d.length;
    out.nn20 = n20; out.pnn20 = 100 * n20 / d.length;
    out.pnn200 = 100 * n200 / d.length;
    // pNN50 episodes: runs of >= 10 consecutive |dNN| > 50 ms
    let run = 0, ep = 0;
    for (const v of d) { if (Math.abs(v) > 50) { run++; if (run === 10) ep++; } else run = 0; }
    out.pnn50Episodes = ep;
  }
  // geometric: histogram with 1/128 s bins
  const bw = 1000 / 128;
  const s = sorted(nn);
  const lo = Math.floor(s[0] / bw) * bw;
  const nb = Math.floor((s[n - 1] - lo) / bw) + 1;
  const hist = new Float64Array(nb);
  for (const v of nn) hist[Math.min(nb - 1, Math.floor((v - lo) / bw))]++;
  let mode = 0; for (let i = 1; i < nb; i++) if (hist[i] > hist[mode]) mode = i;
  out.hrvTriIndex = n / hist[mode];
  out.tinn = tinn(hist, mode, bw);
  // Baevsky stress index: SI = sqrt(AMo / (2 * Mo * MxDMn)), Mo in s, MxDMn in s, AMo % in 50 ms bin
  {
    const bw50 = 50;
    const h50 = new Map();
    for (const v of nn) { const b = Math.floor(v / bw50); h50.set(b, (h50.get(b) || 0) + 1); }
    let best = 0, bestBin = 0; for (const [b, c] of h50) if (c > best) { best = c; bestBin = b; }
    const AMo = 100 * best / n;
    const Mo = (bestBin + 0.5) * bw50 / 1000;
    const MxDMn = (quantileSorted(s, 0.995) - quantileSorted(s, 0.005)) / 1000;
    out.stressIndex = Math.sqrt(AMo / (2 * Mo * Math.max(MxDMn, 1e-3)));
  }
  out.hist = { lo, bw, counts: Array.from(hist) };
  return out;
}

function tinn(hist, mode, bw) {
  // Find N (left) and M (right) minimizing squared error between histogram and triangle.
  const nb = hist.length, peak = hist[mode];
  let best = Infinity, bestN = 0, bestM = nb - 1;
  for (let N = 0; N < mode; N++) {
    for (let M = mode + 1; M < nb; M++) {
      let err = 0;
      for (let i = 0; i < nb; i++) {
        let tri = 0;
        if (i > N && i <= mode) tri = peak * (i - N) / (mode - N);
        else if (i > mode && i < M) tri = peak * (M - i) / (M - mode);
        const e = hist[i] - tri; err += e * e;
      }
      if (err < best) { best = err; bestN = N; bestM = M; }
    }
  }
  return (bestM - bestN) * bw;
}

export function sdannAndIndex(t, nn, segSec = 300) {
  if (!t.length) return {};
  const t0 = t[0];
  const buckets = new Map();
  for (let k = 0; k < t.length; k++) {
    const b = Math.floor((t[k] - t0) / segSec);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(nn[k]);
  }
  const means = [], sds = [];
  for (const arr of buckets.values()) if (arr.length >= 30) { means.push(mean(arr)); sds.push(std(arr)); }
  return { sdann: means.length > 1 ? std(means) : NaN, sdnnIndex: sds.length ? mean(sds) : NaN, segments: means.length };
}

// ---------- frequency domain ----------
export function frequencyDomain(t, nn, fsInterp = 4) {
  if (t.length < 20) return {};
  const rs = resampleUniform(t, nn, fsInterp, 'spline');
  const x = linearDetrend(rs.v);
  const nperseg = Math.min(x.length, 1024);
  const { f, p } = welch(x, fsInterp, nperseg, Math.floor(nperseg / 2), 2048);
  return { ...bandsFromPsd(f, p), psd: { f: Array.from(f), p: Array.from(p) }, interp: rs };
}
export function bandsFromPsd(f, p) {
  const vlf = bandPower(f, p, 0.0033, 0.04), lf = bandPower(f, p, 0.04, 0.15), hf = bandPower(f, p, 0.15, 0.4);
  const total = vlf + lf + hf;
  return {
    vlfPower: vlf, lfPower: lf, hfPower: hf, totalPower: total,
    vlfPct: 100 * vlf / total, lfPct: 100 * lf / total, hfPct: 100 * hf / total,
    lfNu: 100 * lf / (lf + hf), hfNu: 100 * hf / (lf + hf), lfHf: lf / hf,
    lnLf: Math.log(lf), lnHf: Math.log(hf),
    vlfPeak: bandPeak(f, p, 0.0033, 0.04), lfPeak: bandPeak(f, p, 0.04, 0.15), hfPeak: bandPeak(f, p, 0.15, 0.4),
  };
}

// ---------- nonlinear ----------
export function poincare(nn, adjacent) {
  const d = [];
  for (let k = 1; k < nn.length; k++) if (!adjacent || adjacent[k]) d.push(nn[k] - nn[k - 1]);
  if (d.length < 2) return {};
  const sd1 = std(d) / Math.SQRT2;
  const sdnn = std(nn);
  const sd2 = Math.sqrt(Math.max(0, 2 * sdnn * sdnn - sd1 * sd1));
  return { sd1, sd2, sd1sd2: sd1 / sd2, ellipseArea: Math.PI * sd1 * sd2 };
}
function sampEnChunk(x, m, r) {
  const n = x.length;
  let B = 0, A = 0;
  for (let i = 0; i < n - m; i++) {
    for (let j = i + 1; j < n - m; j++) {
      let match = true;
      for (let k = 0; k < m; k++) if (Math.abs(x[i + k] - x[j + k]) > r) { match = false; break; }
      if (match) { B++; if (Math.abs(x[i + m] - x[j + m]) <= r) A++; }
    }
  }
  return A > 0 && B > 0 ? -Math.log(A / B) : NaN;
}
export function sampleEntropy(nn, m = 2, rFrac = 0.2, chunk = 1500) {
  if (nn.length < 100) return NaN;
  const r = rFrac * std(nn);
  const vals = [];
  for (let s = 0; s + 100 <= nn.length; s += chunk) {
    const e = sampEnChunk(nn.subarray ? nn.subarray(s, Math.min(nn.length, s + chunk)) : nn.slice(s, s + chunk), m, r);
    if (Number.isFinite(e)) vals.push(e);
  }
  return vals.length ? mean(vals) : NaN;
}
function apEnChunk(x, m, r) {
  const n = x.length;
  const phi = (mm) => {
    const N = n - mm + 1;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      let c = 0;
      for (let j = 0; j < N; j++) {
        let match = true;
        for (let k = 0; k < mm; k++) if (Math.abs(x[i + k] - x[j + k]) > r) { match = false; break; }
        if (match) c++;
      }
      sum += Math.log(c / N);
    }
    return sum / N;
  };
  return phi(m) - phi(m + 1);
}
export function approximateEntropy(nn, m = 2, rFrac = 0.2, chunk = 1000) {
  if (nn.length < 100) return NaN;
  const r = rFrac * std(nn);
  const vals = [];
  for (let s = 0; s + 100 <= nn.length; s += chunk) {
    const e = apEnChunk(nn.subarray ? nn.subarray(s, Math.min(nn.length, s + chunk)) : nn.slice(s, s + chunk), m, r);
    if (Number.isFinite(e)) vals.push(e);
  }
  return vals.length ? mean(vals) : NaN;
}
export function dfa(nn, scalesA = [4, 16], scalesB = [16, 64]) {
  const n = nn.length;
  if (n < 200) return {};
  const m = mean(nn);
  const y = new Float64Array(n);
  let acc = 0; for (let i = 0; i < n; i++) { acc += nn[i] - m; y[i] = acc; }
  const fluct = (s) => {
    const nBox = Math.floor(n / s);
    let total = 0;
    // precompute sums for linear fit
    let sx = 0, sxx = 0; for (let i = 0; i < s; i++) { sx += i; sxx += i * i; }
    const den = s * sxx - sx * sx;
    for (let b = 0; b < nBox; b++) {
      const o = b * s;
      let sy = 0, sxy = 0;
      for (let i = 0; i < s; i++) { sy += y[o + i]; sxy += i * y[o + i]; }
      const slope = (s * sxy - sx * sy) / den, icpt = (sy - slope * sx) / s;
      for (let i = 0; i < s; i++) { const e = y[o + i] - (icpt + slope * i); total += e * e; }
    }
    return Math.sqrt(total / (nBox * s));
  };
  const fit = (lo, hi) => {
    const xs = [], ys = [];
    for (let s = lo; s <= hi; s = Math.max(s + 1, Math.round(s * 1.15))) {
      if (Math.floor(n / s) < 4) break;
      xs.push(Math.log(s)); ys.push(Math.log(fluct(s)));
    }
    if (xs.length < 3) return NaN;
    const mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return num / den;
  };
  return { dfaAlpha1: fit(scalesA[0], scalesA[1]), dfaAlpha2: fit(scalesB[0], scalesB[1]) };
}
export function shannonEntropy(nn, bw = 8) {
  if (!nn.length) return NaN;
  const h = new Map();
  for (const v of nn) { const b = Math.floor(v / bw); h.set(b, (h.get(b) || 0) + 1); }
  let e = 0;
  for (const c of h.values()) { const p = c / nn.length; e -= p * Math.log2(p); }
  return e;
}

// AF-like irregularity screening (Dash et al. 2009 style thresholds) over 30-s windows.
export function irregularity(t, nn, adjacent) {
  if (t.length < 40) return { irregularPct: NaN, windows: [] };
  const win = 30;
  const t0 = t[0], t1 = t[t.length - 1];
  let total = 0, irregular = 0;
  const windows = [];
  let k0 = 0;
  for (let ws = t0; ws + win <= t1; ws += win) {
    while (k0 < t.length && t[k0] < ws) k0++;
    let k1 = k0; while (k1 < t.length && t[k1] < ws + win) k1++;
    const seg = Array.from(nn.slice(k0, k1));
    if (seg.length < 20) continue;
    total++;
    const d = []; for (let k = k0 + 1; k < k1; k++) if (!adjacent || adjacent[k]) d.push(nn[k] - nn[k - 1]);
    if (d.length < 10) continue;
    let s2 = 0; for (const v of d) s2 += v * v;
    const nrmssd = Math.sqrt(s2 / d.length) / mean(seg);
    // turning point ratio
    let tp = 0; for (let k = 1; k < seg.length - 1; k++) if ((seg[k] > seg[k - 1] && seg[k] > seg[k + 1]) || (seg[k] < seg[k - 1] && seg[k] < seg[k + 1])) tp++;
    const tpr = tp / (seg.length - 2);
    // Shannon entropy of 16-bin histogram (normalized)
    const lo = Math.min(...seg), hi = Math.max(...seg);
    const bins = new Array(16).fill(0);
    for (const v of seg) bins[Math.min(15, Math.floor((v - lo) / ((hi - lo) / 16 || 1)))]++;
    let she = 0; for (const c of bins) if (c) { const p = c / seg.length; she -= p * Math.log(p) / Math.log(16); }
    const isIrr = nrmssd >= 0.1 && tpr >= 0.54 && tpr <= 0.77 && she >= 0.7;
    if (isIrr) irregular++;
    windows.push({ t: ws, nrmssd, tpr, she, irregular: isIrr });
  }
  return { irregularPct: total ? 100 * irregular / total : NaN, windows };
}

// ---------- main ----------
export function computeMetrics(ctx) {
  const { fs, duration, rIdx, type, rrPrev, delin, nnData, quality, settings, clean, corr } = ctx;
  const nb = rIdx.length;
  const S = {};
  const series = {};
  S.duration = duration;

  const age = settings.age ?? 30;
  const hrMax = settings.hrMax || Math.round(220 - age);
  S.hrMaxUsed = hrMax;
  const tachyBpm = settings.tachyBpm ?? 150, bradyBpm = settings.bradyBpm ?? 50;

  // ---- per-beat HR series (non-artifact beats with valid preceding beat) ----
  const hrT = [], hrV = [], hrType = [], hrIdx = [];
  for (let i = 1; i < nb; i++) {
    if (type[i] === BEAT_ARTIFACT || type[i - 1] === BEAT_ARTIFACT) continue;
    const rr = rrPrev[i];
    if (!(rr >= 250 && rr <= 3000)) continue;
    hrT.push(rIdx[i] / fs); hrV.push(60000 / rr); hrType.push(type[i]); hrIdx.push(i);
  }
  series.hr = { t: hrT, v: hrV, type: hrType, idx: hrIdx };

  const { t: nnT, nn, idx: nnIdx } = nnData;
  const adjacent = new Uint8Array(nn.length);
  for (let k = 1; k < nn.length; k++) adjacent[k] = nnIdx[k] === nnIdx[k - 1] + 1 ? 1 : 0;
  series.nn = { t: Array.from(nnT), v: Array.from(nn), adjacent: Array.from(adjacent) };

  // ---- HR stats ----
  if (hrV.length) {
    S.meanHR = mean(hrV);
    const hrNN = Array.from(nn, (v) => 60000 / v);
    S.meanHRfromNN = 60000 / mean(nn);
    if (hrNN.length) {
      let mi = 0, ma = 0;
      for (let k = 1; k < hrNN.length; k++) { if (hrNN[k] < hrNN[mi]) mi = k; if (hrNN[k] > hrNN[ma]) ma = k; }
      S.minHR = hrNN[mi]; S.minHRtime = nnT[mi];
      S.maxHR = hrNN[ma]; S.maxHRtime = nnT[ma];
      S.restingHR = quantile(hrNN, 0.05);
    }
    // 1-minute mean HR sliding (step 5 s)
    let hi = -Infinity, lo = Infinity, hiT = NaN, loT = NaN;
    const oneMin = [];
    let a = 0, b = 0;
    for (let ws = nnT[0]; ws + 60 <= nnT[nnT.length - 1]; ws += 5) {
      while (a < nnT.length && nnT[a] < ws) a++;
      while (b < nnT.length && nnT[b] < ws + 60) b++;
      if (b - a >= 20) {
        let s = 0; for (let k = a; k < b; k++) s += nn[k];
        const m = 60000 / (s / (b - a));
        oneMin.push([ws, m]);
        if (m > hi) { hi = m; hiT = ws; }
        if (m < lo) { lo = m; loT = ws; }
      }
    }
    S.hi1minHR = hi; S.hi1minTime = hiT; S.lo1minHR = lo; S.lo1minTime = loT;
    series.hr1min = oneMin;
    // tachy / brady
    let tachy = 0, brady = 0, tE = 0, bE = 0, runT = 0, runB = 0;
    for (const h of hrV) {
      if (h > tachyBpm) { tachy++; runT++; if (runT === 5) tE++; } else runT = 0;
      if (h < bradyBpm) { brady++; runB++; if (runB === 5) bE++; } else runB = 0;
    }
    S.tachyPct = 100 * tachy / hrV.length; S.bradyPct = 100 * brady / hrV.length;
    S.tachyEpisodes = tE; S.bradyEpisodes = bE;
    // zones
    const zoneDefs = [
      { key: 'rest', lo: 0, hi: 0.6 }, { key: 'recovery', lo: 0.6, hi: 0.7 }, { key: 'aerobic', lo: 0.7, hi: 0.8 },
      { key: 'anaerobic', lo: 0.8, hi: 0.9 }, { key: 'maximum', lo: 0.9, hi: 10 },
    ];
    const zones = zoneDefs.map((z) => ({ ...z, loBpm: Math.round(z.lo * hrMax), hiBpm: z.hi > 5 ? Infinity : Math.round(z.hi * hrMax), seconds: 0 }));
    let effortSum = 0, trimp = 0;
    const rest = S.restingHR || 60;
    for (let k = 0; k < hrV.length; k++) {
      const h = hrV[k], rrS = 60 / h;
      const frac = h / hrMax;
      const z = zones.find((zz) => frac >= zz.lo && frac < zz.hi) || zones[zones.length - 1];
      z.seconds += rrS;
      const hrr = Math.max(0, (h - rest) / (hrMax - rest));
      effortSum += hrr * rrS;
      // Banister TRIMP: duration(min) * HRr * 0.64 * e^(1.92*HRr)  (male coefficients)
      const k2 = settings.sex === 'F' ? [0.86, 1.67] : [0.64, 1.92];
      trimp += (rrS / 60) * hrr * k2[0] * Math.exp(k2[1] * hrr);
    }
    const totalSec = hrV.reduce((s, h) => s + 60 / h, 0);
    S.effortIndex = totalSec ? 100 * effortSum / totalSec : NaN;
    S.trimp = trimp;
    series.zones = zones;
  }

  // ---- time domain ----
  if (nn.length >= 2) {
    const td = timeDomain(nn, adjacent);
    series.hist = td.hist; delete td.hist;
    Object.assign(S, td);
    Object.assign(S, sdannAndIndex(nnT, nn));
    S.nnCv = S.cvnn;
  }

  // ---- frequency domain ----
  let interp = null;
  if (nn.length >= 20) {
    const fd = frequencyDomain(nnT, nn, 4);
    series.psd = fd.psd; interp = fd.interp; delete fd.psd; delete fd.interp;
    Object.assign(S, fd);
  }

  // ---- nonlinear ----
  if (nn.length >= 10) {
    Object.assign(S, poincare(nn, adjacent));
    S.sampEn = safe(sampleEntropy, nn);
    S.apEn = safe(approximateEntropy, nn);
    Object.assign(S, dfa(nn));
    S.shannonEntropy = shannonEntropy(nn);
    const irr = irregularity(nnT, nn, adjacent);
    S.irregularPct = irr.irregularPct;
    series.irregularity = irr.windows;
  }

  // ---- morphology (good normal beats) ----
  {
    const good = [];
    for (let i = 0; i < nb; i++) if (type[i] === BEAT_NORMAL && (!corr || corr[i] > 0.9)) good.push(i);
    const pick = (arr) => { const o = []; for (const i of good) if (Number.isFinite(arr[i])) o.push(arr[i]); return o; };
    const agg = (arr, prefix) => {
      const v = pick(arr);
      if (!v.length) return;
      S[prefix + 'Mean'] = mean(v);
      S[prefix + 'Median'] = median(v);
      S[prefix + 'Sd'] = std(v);
    };
    agg(delin.qrsDur, 'qrs');
    agg(delin.rAmp, 'rAmp'); agg(delin.sAmp, 'sAmp'); agg(delin.qAmp, 'qAmp'); agg(delin.ppAmp, 'qrsAmp');
    agg(delin.jAmp, 'jAmp'); agg(delin.st60, 'st60'); agg(delin.tAmp, 'tAmp');
    agg(delin.pr, 'pr'); agg(delin.pDur, 'pDur'); agg(delin.pAmp, 'pAmp');
    let tCount = 0, tPos = 0, pCount = 0;
    for (const i of good) { if (Number.isFinite(delin.tAmp[i])) { tCount++; if (delin.tAmp[i] > 0) tPos++; } if (Number.isFinite(delin.pr[i])) pCount++; }
    S.tDetectPct = good.length ? 100 * tCount / good.length : NaN;
    S.tPositivePct = tCount ? 100 * tPos / tCount : NaN;
    S.pDetectPct = good.length ? 100 * pCount / good.length : NaN;
    // QT / QTc per beat
    const formula = settings.qtcFormula || 'bazett';
    const qtcAll = { bazett: [], fridericia: [], framingham: [], hodges: [] };
    const qtcT = [], qtcV = [], qtV = [], qrsT = [], qrsV = [], jT = [], jV = [], tAmpT = [], tAmpV = [];
    for (const i of good) {
      const rr = rrPrev[i];
      if (!(rr >= 300 && rr <= 2000)) continue;
      const rrS = rr / 1000;
      if (Number.isFinite(delin.qt[i]) && delin.qt[i] > 200 && delin.qt[i] < 700) {
        for (const f of QTC_FORMULAS) qtcAll[f].push(qtcCorrect(delin.qt[i], rrS, f));
        qtcT.push(rIdx[i] / fs); qtcV.push(qtcCorrect(delin.qt[i], rrS, formula)); qtV.push(delin.qt[i]);
      }
      if (Number.isFinite(delin.qrsDur[i])) { qrsT.push(rIdx[i] / fs); qrsV.push(delin.qrsDur[i]); }
      if (Number.isFinite(delin.jAmp[i])) { jT.push(rIdx[i] / fs); jV.push(delin.jAmp[i]); }
      if (Number.isFinite(delin.tAmp[i])) { tAmpT.push(rIdx[i] / fs); tAmpV.push(delin.tAmp[i]); }
    }
    if (qtV.length) {
      S.qtMean = mean(qtV);
      S.qtcMean = mean(qtcV); S.qtcMedian = median(qtcV); S.qtcSd = std(qtcV); S.qtcP95 = quantile(qtcV, 0.95);
      S.qtcBazett = mean(qtcAll.bazett); S.qtcFridericia = mean(qtcAll.fridericia);
      S.qtcFramingham = mean(qtcAll.framingham); S.qtcHodges = mean(qtcAll.hodges);
    }
    series.qtc = { t: qtcT, v: qtcV, qt: qtV };
    series.qrs = { t: qrsT, v: qrsV };
    series.jpoint = { t: jT, v: jV };
    series.tAmp = { t: tAmpT, v: tAmpV };

    // average beat template (-300..+500 ms) with median fiducial offsets
    if (clean && good.length) {
      const pre = Math.round(0.3 * fs), post = Math.round(0.5 * fs), L = pre + post;
      const step = Math.max(1, Math.floor(good.length / 400));
      const chosen = [];
      for (let k = 0; k < good.length; k += step) { const r = rIdx[good[k]]; if (r - pre >= 0 && r + post < clean.length) chosen.push(r); }
      const tpl = new Float32Array(L);
      const col = new Float64Array(chosen.length);
      for (let s = 0; s < L; s++) {
        for (let j = 0; j < chosen.length; j++) col[j] = clean[chosen[j] - pre + s];
        tpl[s] = median(col);
      }
      const offs = (arr) => {
        const o = []; for (const i of good) if (arr[i] >= 0) o.push((arr[i] - rIdx[i]) * 1000 / fs);
        return o.length ? median(o) : NaN;
      };
      series.template = {
        t: Array.from({ length: L }, (_, s) => (s - pre) * 1000 / fs), v: Array.from(tpl),
        fiducials: {
          pOn: offs(delin.pOn), pPk: offs(delin.pPk), pOff: offs(delin.pOff),
          qrsOn: offs(delin.qrsOn), rPk: offs(delin.rPk), sPk: offs(delin.sPk), qrsOff: offs(delin.qrsOff),
          tPk: offs(delin.tPk), tEnd: offs(delin.tEnd),
        },
        nBeats: chosen.length,
      };
    }
  }

  // ---- ECG-derived respiration signal (R-S amplitude modulation), 4 Hz ----
  let edr = null;
  {
    const t = [], v = [];
    for (let i = 0; i < nb; i++) if (type[i] === BEAT_NORMAL && Number.isFinite(delin.ppAmp[i])) { t.push(rIdx[i] / fs); v.push(delin.ppAmp[i]); }
    if (t.length > 50) {
      edr = resampleUniform(Float64Array.from(t), Float64Array.from(v), 4, 'spline');
      const x = linearDetrend(edr.v);
      const nps = Math.min(x.length, 512);
      const { f, p } = welch(x, 4, nps, Math.floor(nps / 2), 1024);
      series.edrPsd = { f: Array.from(f), p: Array.from(p) };
    }
  }

  // ---- rolling 5-min windows ----
  {
    const win = 300, step = 60;
    const roll = { t: [], meanHR: [], sdnn: [], rmssd: [], pnn50: [], lf: [], hf: [], lfhf: [], sd1: [], sd2: [], respRSA: [], respEDR: [] };
    let a = 0, b = 0;
    const tEnd = duration;
    const windowPeak = (rs, ws, lo, hi) => {
      if (!rs) return { peak: NaN };
      const i0 = Math.max(0, Math.round((ws - rs.t[0]) * rs.fs)), i1 = Math.min(rs.v.length, Math.round((ws + win - rs.t[0]) * rs.fs));
      if (i1 - i0 <= 256) return { peak: NaN };
      const x = linearDetrend(rs.v.subarray(i0, i1));
      const nps = Math.min(x.length, 512);
      const { f, p } = welch(x, rs.fs, nps, Math.floor(nps / 2), 1024);
      return { peak: bandPeak(f, p, lo, hi), f, p };
    };
    for (let ws = 0; ws + win <= tEnd + 1e-6; ws += step) {
      while (a < nnT.length && nnT[a] < ws) a++;
      while (b < nnT.length && nnT[b] < ws + win) b++;
      const cnt = b - a;
      if (cnt < 60) continue;
      const seg = nn.subarray(a, b), segAdj = adjacent.subarray(a, b);
      const td = timeDomain(seg, segAdj);
      const pc = poincare(seg, segAdj);
      roll.t.push(ws + win / 2);
      roll.meanHR.push(60000 / td.meanNN); roll.sdnn.push(td.sdnn); roll.rmssd.push(td.rmssd); roll.pnn50.push(td.pnn50);
      roll.sd1.push(pc.sd1); roll.sd2.push(pc.sd2);
      const hrv = windowPeak(interp, ws, 0.1, 0.5);
      if (hrv.f) {
        const bd = bandsFromPsd(hrv.f, hrv.p);
        roll.lf.push(bd.lfPower); roll.hf.push(bd.hfPower); roll.lfhf.push(bd.lfHf);
        roll.respRSA.push(Number.isFinite(hrv.peak) ? hrv.peak * 60 : NaN);
      } else { roll.lf.push(NaN); roll.hf.push(NaN); roll.lfhf.push(NaN); roll.respRSA.push(NaN); }
      const e = windowPeak(edr, ws, 0.1, 0.5);
      roll.respEDR.push(Number.isFinite(e.peak) ? e.peak * 60 : NaN);
    }
    series.rolling = roll;
    const rsa = finite(roll.respRSA), ed = finite(roll.respEDR);
    S.respRateRSA = rsa.length ? median(rsa) : (Number.isFinite(S.hfPeak) ? S.hfPeak * 60 : NaN);
    S.respRateEDR = ed.length ? median(ed) : NaN;
  }

  // ---- rhythm & quality ----
  {
    let normal = 0, ect = 0, art = 0;
    for (let i = 0; i < nb; i++) { if (type[i] === BEAT_NORMAL) normal++; else if (type[i] === BEAT_ECTOPIC) ect++; else art++; }
    S.beats = nb; S.normalBeats = normal; S.ectopicBeats = ect; S.artifactBeats = art;
    S.ectopicPct = nb ? 100 * ect / nb : NaN; S.artifactPct = nb ? 100 * art / nb : NaN;
    S.noisyPct = quality.noisyPct;
    S.nnRejectedPct = nnData.rejectedPct;
    if (corr) S.meanCorr = mean(finite(corr));
  }

  return { summary: S, series };
}
