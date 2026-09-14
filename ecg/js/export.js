// CSV / JSON export of the current session.
import { METRICS, qtcCorrect } from './metrics.js';
import { BEAT_NORMAL, BEAT_ECTOPIC } from './beats.js';

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const typeName = (v) => (v === BEAT_NORMAL ? 'normal' : v === BEAT_ECTOPIC ? 'ectopic' : 'artifact');
const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '');

export function exportMetricsJson(session) {
  const { meta, result, settings } = session;
  const summary = {};
  for (const m of METRICS) if (meta.summary[m.key] !== undefined) summary[m.key] = { value: meta.summary[m.key], unit: m.unit };
  for (const k of ['minHRtime', 'maxHRtime', 'hi1minTime', 'lo1minTime']) if (Number.isFinite(meta.summary[k])) summary[k] = { value: meta.summary[k], unit: 's' };
  const out = {
    session: { name: meta.name, fileName: meta.fileName, startTime: new Date(meta.startTime).toISOString(), duration: meta.duration, fs: meta.fs, device: meta.device, channel: meta.channel },
    settings,
    summary,
    zones: result.series.zones,
    rolling: result.series.rolling,
  };
  download(`${meta.name.replace(/[^\w.-]+/g, '_')}_metrics.json`, JSON.stringify(out, null, 2), 'application/json');
}

export function exportBeatsCsv(session) {
  const { meta, result, settings } = session;
  const b = result.beats, fs = result.fs, t0 = meta.startTime;
  const formula = settings.qtcFormula || 'bazett';
  const rows = ['index,time_iso,t_s,type,rr_prev_ms,rr_next_ms,hr_bpm,template_corr,qrs_ms,qt_ms,qtc_ms,pr_ms,p_dur_ms,p_amp_uV,q_amp_uV,r_amp_uV,s_amp_uV,qrs_pp_uV,j_amp_uV,st60_uV,t_amp_uV,noise_uV'];
  for (let i = 0; i < b.rIdx.length; i++) {
    const ts = b.rIdx[i] / fs;
    const rr = b.rrPrev[i];
    const qtc = Number.isFinite(b.qt[i]) && rr >= 300 ? qtcCorrect(b.qt[i], rr / 1000, formula) : NaN;
    rows.push([
      i, new Date(t0 + ts * 1000).toISOString(), ts.toFixed(4), typeName(b.type[i]), num(rr, 1), num(b.rrNext[i], 1),
      num(Number.isFinite(rr) ? 60000 / rr : NaN, 1), num(b.corr[i], 3), num(b.qrsDur[i], 1), num(b.qt[i], 1), num(qtc, 1),
      num(b.pr[i], 1), num(b.pDur[i], 1), num(b.pAmp[i], 0), num(b.qAmp[i], 0), num(b.rAmp[i], 0), num(b.sAmp[i], 0), num(b.ppAmp[i], 0),
      num(b.jAmp[i], 0), num(b.st60[i], 0), num(b.tAmp[i], 0), num(b.noise[i], 1),
    ].join(','));
  }
  download(`${meta.name.replace(/[^\w.-]+/g, '_')}_beats.csv`, rows.join('\n'), 'text/csv');
}

export function exportNnCsv(session) {
  const { meta, result } = session;
  const rows = ['t_s,time_iso,nn_ms'];
  const { t, v } = result.nn;
  for (let k = 0; k < t.length; k++) rows.push(`${t[k].toFixed(4)},${new Date(meta.startTime + t[k] * 1000).toISOString()},${v[k].toFixed(1)}`);
  download(`${meta.name.replace(/[^\w.-]+/g, '_')}_nn.csv`, rows.join('\n'), 'text/csv');
}
