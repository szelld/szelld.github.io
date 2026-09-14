// Full analysis pipeline (pure; used by the worker and by test scripts).
import { bandpass, lowpass } from './dsp.js';
import { detectRPeaks } from './detect.js';
import { delineate } from './delineate.js';
import { assessQuality, classifyBeats, buildNN } from './beats.js';
import { computeMetrics } from './metrics.js';

/**
 * @param {Float32Array} ecg raw ECG in uV
 * @param {number} fs
 * @param {object} opts { physMax, settings, onProgress(stage, pct) }
 */
export function analyze(ecg, fs, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const settings = opts.settings || {};
  const duration = ecg.length / fs;

  progress('filter', 5);
  const clean = bandpass(ecg, fs, 0.5, 40, 2);
  const lp = lowpass(clean, fs, 15, 4);

  progress('detect', 20);
  const { rIdx, polarity } = detectRPeaks(ecg, fs, clean);

  progress('delineate', 40);
  const delin = delineate(clean, fs, rIdx, { lp });

  progress('classify', 60);
  const quality = assessQuality(ecg, clean, lp, fs, rIdx, opts.physMax);
  const cls = classifyBeats(clean, fs, rIdx, delin, quality);
  const nnData = buildNN(rIdx, fs, cls.type, cls.rrPrev, cls.localMed);

  progress('metrics', 75);
  const { summary, series } = computeMetrics({
    fs, duration, rIdx, type: cls.type, rrPrev: cls.rrPrev, delin, nnData, quality, settings, clean, corr: cls.corr,
  });
  progress('done', 100);

  // strip the lp copy from delin to reduce transfer size
  const { lp: _lp, ...delinOut } = delin;
  return {
    fs, duration, polarity,
    clean,
    beats: {
      rIdx, type: cls.type, corr: cls.corr, ampRatio: cls.ampRatio, rrPrev: cls.rrPrev, rrNext: cls.rrNext,
      template: cls.template, templateHalf: cls.templateHalf,
      ...delinOut,
    },
    quality: { segLen: quality.segLen, flags: quality.flags, noisyPct: quality.noisyPct },
    nn: { t: nnData.t, v: nnData.nn, idx: nnData.idx },
    summary, series,
  };
}
