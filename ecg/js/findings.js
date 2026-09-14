// Screening layer: turns the stored beat table into named rhythm events, then
// compares those events and the summary metrics against standard reference
// ranges. This is deliberately a screening aid, not a diagnosis: rules only
// ever say "inside the reference range" or "worth discussing with a doctor",
// and every rule degrades to `unreliable` when the signal quality cannot
// support it.
//
// Runs on the main thread at render time (it is a few passes over ~14k beats),
// so results always reflect the current settings and work on sessions that
// were analysed before this module existed.
import { median } from './dsp.js';
import { BEAT_NORMAL, BEAT_ECTOPIC, BEAT_ARTIFACT, SQ_FLAT, SQ_CLIP, SQ_NOISE } from './beats.js';
import { t, fmtNumber } from './i18n.js';

export const SEVERITY = { normal: 0, unreliable: 1, borderline: 2, discuss: 3 };
export const severityRank = (s) => SEVERITY[s] ?? 0;
export function worstSeverity(findings) {
  let worst = 'normal';
  for (const f of findings) if (severityRank(f.severity) > severityRank(worst)) worst = f.severity;
  return worst;
}

// All numeric thresholds in one place so they can be audited and adjusted.
export const THRESHOLDS = {
  ectopicBurden: { borderline: 1, discuss: 10 },      // percent of all beats
  pauseSec: { borderline: 2.0, discuss: 3.0 },
  pauseRatio: 1.8,                                    // x local median RR
  pauseMinMs: 1500,
  wideQrsMs: 120,                                     // ectopic classified ventricular-like
  wideQrsRatio: 1.4,                                  // or this multiple of the normal median
  qrsMs: { borderline: 120, discuss: 150 },
  prMs: { borderline: 200, discuss: 300, short: 120 },
  qtcMs: { m: { borderline: 450, discuss: 470 }, f: { borderline: 460, discuss: 480 }, high: 500, short: 340 },
  hrHighSustainedBpm: 150, hrHighSustainedSec: 30,
  restingTachyMinutes: 30,
  hrLowDiscussBpm: 40, hrLowSustainedBpm: 50, hrLowSustainedSec: 30,
  irregularPct: 5,                                    // share of 30 s windows
  irregularPLowPct: 50,                               // P detected in fewer than this share
  qualityUnreliablePct: 5,                            // artifact + noisy share
  symptomWindowSec: 3,
};

const finite = (v) => Number.isFinite(v);
const clampSeverity = (sev, cap) => (severityRank(sev) > severityRank(cap) ? cap : sev);

function rollingMedianRR(rrPrev, half = 10) {
  const n = rrPrev.length, out = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    const w = [];
    for (let k = a; k < b; k++) if (finite(rrPrev[k]) && rrPrev[k] > 0) w.push(rrPrev[k]);
    if (w.length) out[i] = median(w);
  }
  return out;
}

/**
 * Detect rhythm events from the stored beat table.
 * @param {object} result the analysis result (result.beats, result.quality, result.series)
 * @param {object} settings user settings (tachyBpm, bradyBpm)
 */
export function analyseRhythm(result, settings = {}) {
  const b = result.beats, fs = result.fs, n = b.rIdx.length;
  const q = result.quality || {};
  const tachyBpm = settings.tachyBpm ?? 100, bradyBpm = settings.bradyBpm ?? 60;
  const localMed = rollingMedianRR(b.rrPrev, 10);
  const tOf = (i) => b.rIdx[i] / fs;

  const segBad = (i) => {
    if (!q.flags || !q.segLen) return false;
    const s = Math.min(q.flags.length - 1, Math.floor(b.rIdx[i] / q.segLen));
    return (q.flags[s] & (SQ_FLAT | SQ_CLIP | SQ_NOISE)) !== 0;
  };

  // ---- normal QRS width, used to call an ectopic beat wide ----
  const normalQrs = [];
  for (let i = 0; i < n; i++) if (b.type[i] === BEAT_NORMAL && finite(b.qrsDur[i])) normalQrs.push(b.qrsDur[i]);
  const normalQrsMedian = normalQrs.length ? median(normalQrs) : NaN;
  const wideLimit = finite(normalQrsMedian)
    ? Math.min(THRESHOLDS.wideQrsMs, THRESHOLDS.wideQrsRatio * normalQrsMedian)
    : THRESHOLDS.wideQrsMs;

  // ---- pauses and dropped beats ----
  // Only trust an RR gap when both bounding beats are real and the segment is clean,
  // otherwise a missed detection looks exactly like a pause.
  const pauses = [];
  for (let i = 1; i < n; i++) {
    const rr = b.rrPrev[i];
    if (!finite(rr)) continue;
    if (b.type[i] === BEAT_ARTIFACT || b.type[i - 1] === BEAT_ARTIFACT) continue;
    if (segBad(i) || segBad(i - 1)) continue;
    const lm = localMed[i];
    const isPause = rr >= THRESHOLDS.pauseSec.borderline * 1000;
    const isDropped = finite(lm) && rr >= THRESHOLDS.pauseRatio * lm && rr >= THRESHOLDS.pauseMinMs;
    // a compensatory pause after an ectopic beat is expected, not a conduction problem
    const afterEctopic = b.type[i - 1] === BEAT_ECTOPIC;
    if (isPause || (isDropped && !afterEctopic)) {
      pauses.push({ t: tOf(i), rr, localMed: finite(lm) ? lm : null, kind: isPause ? 'pause' : 'dropped', afterEctopic });
    }
  }
  const longestRR = (() => {
    let mx = 0, at = NaN;
    for (let i = 1; i < n; i++) {
      if (b.type[i] === BEAT_ARTIFACT || b.type[i - 1] === BEAT_ARTIFACT || segBad(i)) continue;
      if (finite(b.rrPrev[i]) && b.rrPrev[i] > mx) { mx = b.rrPrev[i]; at = tOf(i); }
    }
    return { rr: mx || NaN, t: at };
  })();

  // ---- ectopic grouping ----
  const groups = [];
  for (let i = 0; i < n; i++) {
    if (b.type[i] !== BEAT_ECTOPIC) continue;
    let j = i;
    while (j + 1 < n && b.type[j + 1] === BEAT_ECTOPIC) j++;
    const idx = [];
    for (let k = i; k <= j; k++) idx.push(k);
    const widths = idx.map((k) => b.qrsDur[k]).filter(finite);
    const wide = widths.length ? median(widths) >= wideLimit : false;
    const len = idx.length;
    groups.push({
      t: tOf(i), endT: tOf(j), beats: idx, length: len, wide,
      qrsDur: widths.length ? median(widths) : NaN,
      kind: len === 1 ? 'single' : len === 2 ? 'couplet' : len === 3 ? 'triplet' : 'run',
      rrPrev: b.rrPrev[i], rrNext: b.rrNext[j],
    });
    i = j;
  }
  const counts = { single: 0, couplet: 0, triplet: 0, run: 0, wide: 0, narrow: 0 };
  for (const g of groups) { counts[g.kind]++; if (g.wide) counts.wide++; else counts.narrow++; }
  const runs = groups.filter((g) => g.length >= 3);
  const longestRun = groups.reduce((m, g) => Math.max(m, g.length), 0);

  // ---- bigeminy / trigeminy ----
  // period 2 = every other beat ectopic, period 3 = every third beat.
  const patterns = [];
  for (const period of [2, 3]) {
    let i = 0;
    while (i < n) {
      if (b.type[i] !== BEAT_ECTOPIC) { i++; continue; }
      let cycles = 0, k = i;
      while (k + period < n && b.type[k + period] === BEAT_ECTOPIC) {
        let gapNormal = true;
        for (let m = k + 1; m < k + period; m++) if (b.type[m] !== BEAT_NORMAL) { gapNormal = false; break; }
        if (!gapNormal) break;
        cycles++; k += period;
      }
      if (cycles >= 3) {
        patterns.push({ kind: period === 2 ? 'bigeminy' : 'trigeminy', t: tOf(i), endT: tOf(k), cycles: cycles + 1 });
        i = k + 1;
      } else i++;
    }
  }

  // ---- sustained rate episodes ----
  const hr = result.series && result.series.hr ? result.series.hr : { t: [], v: [], idx: [] };
  // `peak` means the most extreme rate in the episode: fastest above, slowest below.
  const episodes = (test, direction) => {
    const out = [];
    let start = -1, sum = 0, cnt = 0, peak = NaN;
    const close = (endIdx) => {
      if (start < 0) return;
      const t0 = hr.t[start], t1 = hr.t[endIdx];
      out.push({ t: t0, endT: t1, seconds: t1 - t0, meanHR: sum / cnt, peakHR: peak, beats: cnt });
      start = -1; sum = 0; cnt = 0; peak = NaN;
    };
    for (let k = 0; k < hr.v.length; k++) {
      const v = hr.v[k];
      if (test(v)) {
        if (start < 0) { start = k; peak = v; }
        sum += v; cnt++;
        peak = direction === 'above' ? Math.max(peak, v) : Math.min(peak, v);
      } else if (start >= 0) close(k - 1);
    }
    if (start >= 0) close(hr.v.length - 1);
    return out;
  };
  const tachyEpisodes = episodes((v) => v > tachyBpm, 'above');
  const bradyEpisodes = episodes((v) => v < bradyBpm, 'below');
  const highRateEpisodes = tachyEpisodes.filter((e) => e.peakHR > THRESHOLDS.hrHighSustainedBpm && e.seconds >= THRESHOLDS.hrHighSustainedSec);
  const tachySeconds = tachyEpisodes.reduce((a, e) => a + e.seconds, 0);
  const lowRateEpisodes = bradyEpisodes.filter((e) => e.seconds >= THRESHOLDS.hrLowSustainedSec);
  let minHR = Infinity;
  for (const v of hr.v) if (v < minHR) minHR = v;

  // ---- P-wave presence inside the irregular windows ----
  const irregularWindows = (result.series && result.series.irregularity) || [];
  const pRateIn = (t0, t1) => {
    let total = 0, withP = 0;
    for (let i = 0; i < n; i++) {
      const tt = tOf(i);
      if (tt < t0) continue;
      if (tt > t1) break;
      if (b.type[i] !== BEAT_NORMAL) continue;
      total++;
      if (b.pPk[i] >= 0) withP++;
    }
    return total ? 100 * withP / total : NaN;
  };
  const irregular = irregularWindows.filter((w) => w.irregular).map((w) => ({ ...w, pPct: pRateIn(w.t, w.t + 30) }));
  const summaryIrr = result.summary && result.summary.irregularPct;
  const irregularPct = finite(summaryIrr) ? summaryIrr
    : (irregularWindows.length ? 100 * irregular.length / irregularWindows.length : NaN);
  const irregularPLow = irregular.filter((w) => finite(w.pPct) && w.pPct < THRESHOLDS.irregularPLowPct);

  return {
    normalQrsMedian, wideLimit,
    pauses, longestRR,
    ectopicGroups: groups, ectopicCounts: counts, ectopicRuns: runs, longestRun, patterns,
    tachyEpisodes, bradyEpisodes, highRateEpisodes, lowRateEpisodes, tachySeconds,
    minHR: finite(minHR) && minHR !== Infinity ? minHR : NaN,
    irregular, irregularPct, irregularPLow,
    tachyBpm, bradyBpm,
  };
}

/**
 * Match symptom markers from the export XML against abnormal beats.
 */
export function correlateSymptoms(result, events, windowSec = THRESHOLDS.symptomWindowSec) {
  const b = result.beats, fs = result.fs;
  const abnormal = [];
  for (let i = 0; i < b.rIdx.length; i++) if (b.type[i] === BEAT_ECTOPIC) abnormal.push({ i, t: b.rIdx[i] / fs });
  const matches = (events || []).map((ev) => {
    let best = null, bestD = Infinity;
    for (const a of abnormal) {
      const d = Math.abs(a.t - ev.t);
      if (d < bestD) { bestD = d; best = a; }
    }
    const matched = best && bestD <= windowSec;
    return {
      event: ev,
      matched: !!matched,
      deltaSec: matched ? best.t - ev.t : null,
      beatIndex: matched ? best.i : null,
      beatT: matched ? best.t : null,
      qrsDur: matched ? b.qrsDur[best.i] : null,
    };
  });
  const matchedCount = matches.filter((m) => m.matched).length;
  return { matches, matchedCount, total: matches.length };
}

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------
// Each rule returns { id, severity, group, value, reference, args, evidence }.
// `value` and `reference` are argument bags rendered by i18n so both languages
// stay in sync; `args` feeds the explanation string.

/**
 * @param {object} ctx { summary, rhythm, symptoms, settings, duration }
 * @returns {Array<object>} findings, ordered worst first
 */
export function evaluateFindings(ctx) {
  const { summary: S, rhythm: R, symptoms, settings = {}, duration = 0 } = ctx;
  const out = [];
  const add = (f) => out.push(f);

  // ---- signal quality gate -------------------------------------------------
  const badPct = (finite(S.artifactPct) ? S.artifactPct : 0) + (finite(S.noisyPct) ? S.noisyPct : 0);
  const unreliable = badPct > THRESHOLDS.qualityUnreliablePct;
  const cap = unreliable ? 'borderline' : 'discuss';
  add({
    id: 'quality',
    group: 'quality',
    severity: unreliable ? 'unreliable' : 'normal',
    value: { n: badPct, unit: '%' },
    reference: { text: 'refUnder', n: THRESHOLDS.qualityUnreliablePct, unit: '%' },
    args: { artifact: S.artifactPct, noisy: S.noisyPct, rejected: S.nnRejectedPct, limit: THRESHOLDS.qualityUnreliablePct },
    evidence: [],
  });

  // ---- ectopic burden ------------------------------------------------------
  const burden = finite(S.ectopicPct) ? S.ectopicPct : 0;
  let burdenSev = 'normal';
  if (burden > THRESHOLDS.ectopicBurden.discuss) burdenSev = 'discuss';
  else if (burden >= THRESHOLDS.ectopicBurden.borderline) burdenSev = 'borderline';
  const perHour = duration > 0 ? (S.ectopicBeats || 0) / (duration / 3600) : NaN;
  add({
    id: 'ectopicBurden',
    group: 'rhythm',
    severity: clampSeverity(burdenSev, cap),
    value: { n: burden, unit: '%' },
    reference: { text: 'refUnder', n: THRESHOLDS.ectopicBurden.borderline, unit: '%' },
    args: {
      count: S.ectopicBeats || 0, perHour, value: burden, limit: THRESHOLDS.ectopicBurden.borderline,
      wide: R.ectopicCounts.wide, narrow: R.ectopicCounts.narrow,
      singles: R.ectopicCounts.single, couplets: R.ectopicCounts.couplet,
    },
    evidence: R.ectopicGroups.slice(0, 20).map((g, i) => ({ t: g.t, label: `#${i + 1}` })),
  });

  // ---- ectopic grouping: couplets and runs --------------------------------
  const runs = R.ectopicRuns;
  const couplets = R.ectopicCounts.couplet;
  if (runs.length || couplets) {
    const wideRuns = runs.filter((g) => g.wide);
    let sev = 'borderline';
    if (wideRuns.length) sev = 'discuss';
    add({
      id: 'ectopicPattern',
      group: 'rhythm',
      severity: clampSeverity(sev, cap),
      value: { text: 'valueRuns', couplets, runs: runs.length, longest: R.longestRun },
      reference: { text: 'refNoRuns' },
      args: { couplets, runs: runs.length, wideRuns: wideRuns.length, longest: R.longestRun, singles: R.ectopicCounts.single },
      evidence: [...runs, ...R.ectopicGroups.filter((g) => g.length === 2)].slice(0, 20).map((g) => ({ t: g.t, label: `${g.length}x` })),
    });
  } else if ((S.ectopicBeats || 0) > 0) {
    add({
      id: 'ectopicPattern',
      group: 'rhythm',
      severity: 'normal',
      value: { text: 'valueAllSingles', n: R.ectopicCounts.single },
      reference: { text: 'refNoRuns' },
      args: { couplets: 0, runs: 0, wideRuns: 0, longest: R.longestRun, singles: R.ectopicCounts.single },
      evidence: [],
    });
  }

  // ---- bigeminy / trigeminy ------------------------------------------------
  if (R.patterns.length) {
    add({
      id: 'ectopicRhythmPattern',
      group: 'rhythm',
      severity: clampSeverity('borderline', cap),
      value: { text: 'valuePatterns', n: R.patterns.length },
      reference: { text: 'refNone' },
      args: {
        bigeminy: R.patterns.filter((p) => p.kind === 'bigeminy').length,
        trigeminy: R.patterns.filter((p) => p.kind === 'trigeminy').length,
      },
      evidence: R.patterns.slice(0, 10).map((p) => ({ t: p.t, label: p.kind })),
    });
  }

  // ---- pauses and dropped beats -------------------------------------------
  const longestPauseSec = R.pauses.reduce((m, p) => Math.max(m, p.rr / 1000), 0);
  let pauseSev = 'normal';
  if (longestPauseSec >= THRESHOLDS.pauseSec.discuss) pauseSev = 'discuss';
  else if (R.pauses.length) pauseSev = 'borderline';
  add({
    id: 'pauses',
    group: 'rhythm',
    severity: clampSeverity(pauseSev, cap),
    value: { n: R.pauses.length, unit: '' },
    reference: { text: 'refNone' },
    args: {
      count: R.pauses.length,
      longestSec: longestPauseSec || (finite(R.longestRR.rr) ? R.longestRR.rr / 1000 : NaN),
      dropped: R.pauses.filter((p) => p.kind === 'dropped').length,
      limitSec: THRESHOLDS.pauseSec.borderline,
    },
    evidence: R.pauses.slice(0, 20).map((p) => ({ t: p.t, label: `${(p.rr / 1000).toFixed(2)} s` })),
  });

  // ---- fast rates ----------------------------------------------------------
  const highRate = R.highRateEpisodes;
  const tachyMinutes = R.tachySeconds / 60;
  let rateHighSev = 'normal';
  if (highRate.length) rateHighSev = 'discuss';
  else if (tachyMinutes > THRESHOLDS.restingTachyMinutes) rateHighSev = 'borderline';
  add({
    id: 'fastRate',
    group: 'rate',
    severity: clampSeverity(rateHighSev, cap),
    value: { n: finite(S.maxHR) ? S.maxHR : NaN, unit: 'bpm' },
    reference: { text: 'refUnder', n: THRESHOLDS.hrHighSustainedBpm, unit: 'bpm' },
    args: {
      maxHR: S.maxHR, minutes: tachyMinutes, threshold: R.tachyBpm,
      sustained: highRate.length, longestSec: highRate.reduce((m, e) => Math.max(m, e.seconds), 0),
    },
    evidence: (highRate.length ? highRate : R.tachyEpisodes.slice().sort((a, b) => b.seconds - a.seconds).slice(0, 5))
      .map((e) => ({ t: e.t, label: `${Math.round(e.peakHR)} bpm` })),
  });

  // ---- slow rates ----------------------------------------------------------
  // The NN-based minimum is the trustworthy one: the raw beat-to-beat series
  // also contains compensatory pauses after ectopics, which are not bradycardia.
  const minHR = finite(S.minHR) ? S.minHR : R.minHR;
  let rateLowSev = 'normal';
  if (finite(minHR) && minHR < THRESHOLDS.hrLowDiscussBpm) rateLowSev = 'discuss';
  else if (R.lowRateEpisodes.length) rateLowSev = 'borderline';
  add({
    id: 'slowRate',
    group: 'rate',
    severity: clampSeverity(rateLowSev, cap),
    value: { n: minHR, unit: 'bpm' },
    reference: { text: 'refOver', n: THRESHOLDS.hrLowDiscussBpm, unit: 'bpm' },
    args: { minHR, threshold: R.bradyBpm, sustained: R.lowRateEpisodes.length },
    evidence: R.lowRateEpisodes.slice(0, 10).map((e) => ({ t: e.t, label: `${Math.round(e.peakHR)} bpm` })),
  });

  // ---- irregular rhythm screening -----------------------------------------
  const irrPct = finite(R.irregularPct) ? R.irregularPct : 0;
  const pLowCount = R.irregularPLow.length;
  let irrSev = 'normal';
  if (irrPct > THRESHOLDS.irregularPct && pLowCount) irrSev = 'discuss';
  else if (irrPct > THRESHOLDS.irregularPct) irrSev = 'borderline';
  add({
    id: 'irregularRhythm',
    group: 'rhythm',
    severity: clampSeverity(irrSev, cap),
    value: { n: irrPct, unit: '%' },
    reference: { text: 'refUnder', n: THRESHOLDS.irregularPct, unit: '%' },
    args: { pct: irrPct, windows: R.irregular.length, pLow: pLowCount, pDetect: S.pDetectPct },
    evidence: R.irregular.slice(0, 10).map((w) => ({ t: w.t, label: `${Math.round(w.pPct || 0)}% P` })),
  });

  // ---- QRS width -----------------------------------------------------------
  const qrs = finite(S.qrsMedian) ? S.qrsMedian : S.qrsMean;
  let qrsSev = 'normal';
  if (finite(qrs)) {
    if (qrs >= THRESHOLDS.qrsMs.discuss) qrsSev = 'discuss';
    else if (qrs >= THRESHOLDS.qrsMs.borderline) qrsSev = 'borderline';
  }
  add({
    id: 'qrsWidth',
    group: 'intervals',
    severity: clampSeverity(qrsSev, cap),
    value: { n: qrs, unit: 'ms' },
    reference: { text: 'refUnder', n: THRESHOLDS.qrsMs.borderline, unit: 'ms' },
    args: { qrs },
    singleLead: true,
    evidence: [],
  });

  // ---- PR interval ---------------------------------------------------------
  const pr = finite(S.prMean) ? S.prMean : NaN;
  let prSev = 'normal', prShort = false;
  if (finite(pr)) {
    if (pr >= THRESHOLDS.prMs.discuss || (pr > THRESHOLDS.prMs.borderline && R.pauses.some((p) => p.kind === 'dropped'))) prSev = 'discuss';
    else if (pr > THRESHOLDS.prMs.borderline) prSev = 'borderline';
    else if (pr < THRESHOLDS.prMs.short) { prSev = 'borderline'; prShort = true; }
  }
  add({
    id: 'prInterval',
    group: 'intervals',
    severity: finite(pr) ? clampSeverity(prSev, cap) : 'normal',
    value: { n: pr, unit: 'ms' },
    reference: { text: 'refBetween', lo: THRESHOLDS.prMs.short, hi: THRESHOLDS.prMs.borderline, unit: 'ms' },
    args: { pr, short: prShort, detected: S.pDetectPct },
    singleLead: true,
    evidence: [],
  });

  // ---- QTc -----------------------------------------------------------------
  const sex = settings.sex === 'F' ? 'f' : 'm';
  const qtcLimits = THRESHOLDS.qtcMs[sex];
  const qtc = finite(S.qtcMean) ? S.qtcMean : NaN;
  let qtcSev = 'normal', qtcShort = false;
  if (finite(qtc)) {
    if (qtc >= THRESHOLDS.qtcMs.high || qtc >= qtcLimits.discuss) qtcSev = 'discuss';
    else if (qtc >= qtcLimits.borderline) qtcSev = 'borderline';
    else if (qtc < THRESHOLDS.qtcMs.short) { qtcSev = 'borderline'; qtcShort = true; }
  }
  add({
    id: 'qtc',
    group: 'intervals',
    severity: clampSeverity(qtcSev, cap),
    value: { n: qtc, unit: 'ms' },
    reference: { text: 'refUnder', n: qtcLimits.borderline, unit: 'ms' },
    args: {
      qtc, short: qtcShort,
      formula: settings.qtcFormula || 'bazett',
      sexAssumed: settings.sex ? null : 'm',
      fridericia: S.qtcFridericia,
    },
    singleLead: true,
    evidence: [],
  });

  // ---- symptom correlation -------------------------------------------------
  if (symptoms && symptoms.total > 0) {
    const { matchedCount, total } = symptoms;
    // Symptoms landing on abnormal beats is the most actionable thing here,
    // even when the burden itself is low.
    const sev = matchedCount > 0 ? 'discuss' : 'normal';
    add({
      id: 'symptoms',
      group: 'symptoms',
      severity: clampSeverity(sev, cap),
      value: { text: 'valueMatched', matched: matchedCount, total },
      reference: { text: 'refNotApplicable' },
      args: { matched: matchedCount, total, unmatched: total - matchedCount, window: THRESHOLDS.symptomWindowSec },
      evidence: symptoms.matches.filter((m) => m.matched).slice(0, 20).map((m, i) => ({ t: m.beatT, label: `#${i + 1}` })),
    });
  }

  const order = { discuss: 0, borderline: 1, unreliable: 2, normal: 3 };
  out.sort((a, b2) => (order[a.severity] - order[b2.severity]) || 0);
  return out;
}

// ---------------------------------------------------------------------------
// Presentation: turns a finding into localised text. Lives here so both the
// Findings tab and the printable report render identical wording.
// ---------------------------------------------------------------------------
const ARG_DEC = {
  value: 2, artifact: 1, noisy: 1, pct: 1, longestSec: 2, limitSec: 1, minutes: 1,
  perHour: 0, qrs: 0, pr: 0, qtc: 0, fridericia: 0, detected: 0, maxHR: 0, minHR: 0,
};
const VALUE_DEC = { ectopicBurden: 2, quality: 1, irregularRhythm: 1 };

function fmtArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = typeof v === 'number'
      ? (finite(v) ? fmtNumber(v, ARG_DEC[k] ?? 0) : t('metricValueNA'))
      : v;
  }
  return out;
}

export function findingTitle(f) { return t(`f_${f.id}`); }
export function findingValueText(f) {
  const v = f.value;
  if (v.text) return t(v.text, fmtArgs(v));
  if (!finite(v.n)) return t('metricValueNA');
  return `${fmtNumber(v.n, VALUE_DEC[f.id] ?? 0)}${v.unit ? ` ${v.unit}` : ''}`;
}
export function findingRefText(f) { return t(f.reference.text, fmtArgs(f.reference)); }
export function findingExplanation(f) {
  const args = fmtArgs(f.args);
  if (f.id === 'prInterval' && f.args.short) return t('x_prInterval_short', args);
  if (f.id === 'qtc' && f.args.short) return t('x_qtc_short', args);
  return t(`x_${f.id}_${f.severity}`, args);
}
export function findingNotes(f) {
  const notes = [];
  if (f.singleLead) notes.push(t('singleLeadNote'));
  if (f.id === 'qtc' && f.args.sexAssumed) notes.push(t('qtcSexAssumed'));
  return notes;
}
export function bannerText(findings, severity) {
  const key = ['discuss', 'borderline', 'unreliable'].includes(severity) ? severity : 'normal';
  const n = findings.filter((f) => f.severity === key).length;
  return { key, title: t(`banner_${key}_title`, { n: fmtNumber(n, 0) }), text: t(`banner_${key}_text`) };
}
