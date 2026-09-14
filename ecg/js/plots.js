// Plotly wrappers. All functions take a `session` = { meta, result, ecg, settings }.
import { t, getLang } from './i18n.js';
import { minMaxDecimate } from './dsp.js';
import { BEAT_NORMAL, BEAT_ECTOPIC, BEAT_ARTIFACT } from './beats.js';

const COLORS = {
  normal: '#2563eb', ectopic: '#dc2626', artifact: '#9ca3af', line: '#111827', accent: '#e11d48',
  zones: ['rgba(148,163,184,0.15)', 'rgba(56,189,248,0.18)', 'rgba(34,197,94,0.18)', 'rgba(250,204,21,0.2)', 'rgba(239,68,68,0.2)'],
  vlf: 'rgba(148,163,184,0.5)', lf: 'rgba(59,130,246,0.5)', hf: 'rgba(16,185,129,0.5)',
};
const FONT = { family: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', size: 12, color: '#1f2937' };
const CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

export function baseLayout(over = {}) {
  return {
    font: FONT, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
    margin: { l: 60, r: 20, t: 40, b: 50 }, hovermode: 'closest',
    legend: { orientation: 'h', y: -0.2 },
    xaxis: { gridcolor: '#eef2f7', zeroline: false },
    yaxis: { gridcolor: '#eef2f7', zeroline: false },
    ...over,
  };
}
const dates = (t0, arr) => Array.from(arr, (s) => new Date(t0 + s * 1000));
const typeColor = (v) => (v === BEAT_NORMAL ? COLORS.normal : v === BEAT_ECTOPIC ? COLORS.ectopic : COLORS.artifact);

function attachJump(el, onJump, t0) {
  if (!onJump) return;
  el.on('plotly_click', (ev) => {
    const p = ev.points && ev.points[0];
    if (!p) return;
    let x = p.x;
    if (typeof x === 'string') x = new Date(x).getTime();
    else if (x instanceof Date) x = x.getTime();
    if (typeof x === 'number') onJump((x - t0) / 1000);
  });
}

// ---------------- heart rate ----------------
export function plotHR(el, session, onJump) {
  const { meta, result, settings } = session;
  const t0 = meta.startTime;
  const hr = result.series.hr;
  const x = dates(t0, hr.t);
  const traces = [];
  const groups = [[BEAT_NORMAL, t('legendNormal')], [BEAT_ECTOPIC, t('legendEctopic')]];
  for (const [ty, name] of groups) {
    const xs = [], ys = [];
    for (let k = 0; k < hr.v.length; k++) if (hr.type[k] === ty) { xs.push(x[k]); ys.push(hr.v[k]); }
    if (!xs.length) continue;
    traces.push({ type: 'scattergl', mode: 'markers', x: xs, y: ys, name, marker: { size: ty === BEAT_NORMAL ? 3 : 8, color: typeColor(ty), symbol: ty === BEAT_ECTOPIC ? 'x' : 'circle' }, hovertemplate: `%{x|%H:%M:%S}<br>${t('hrLabel')}: %{y:.0f} bpm<extra>${name}</extra>` });
  }
  if (result.series.hr1min && result.series.hr1min.length) {
    traces.push({ type: 'scatter', mode: 'lines', x: dates(t0, result.series.hr1min.map((p) => p[0] + 30)), y: result.series.hr1min.map((p) => p[1]), name: t('plotHr1min'), line: { color: COLORS.accent, width: 3 }, hovertemplate: '%{x|%H:%M:%S}<br>%{y:.0f} bpm<extra></extra>' });
  }
  const shapes = [], annotations = [];
  const zones = result.series.zones || [];
  const zoneNames = ['zone_rest', 'zone_recovery', 'zone_aerobic', 'zone_anaerobic', 'zone_maximum'];
  const finiteHr = hr.v.filter(Number.isFinite);
  const yLo = Math.max(0, Math.min(...finiteHr) - 10), yHi = Math.max(140, ...finiteHr) + 10;
  zones.forEach((z, i) => {
    const hi = Number.isFinite(z.hiBpm) ? z.hiBpm : Math.max(220, (result.summary.hrMaxUsed || 190) * 1.1);
    shapes.push({ type: 'rect', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: z.loBpm, y1: hi, fillcolor: COLORS.zones[i], line: { width: 0 }, layer: 'below' });
    const a = Math.max(z.loBpm, yLo), b = Math.min(hi, yHi);
    if (b - a > 6) annotations.push({ xref: 'paper', x: 1, xanchor: 'right', y: (a + b) / 2, yref: 'y', text: `${t(zoneNames[i])}: ${(z.seconds / 60).toFixed(0)} ${t('minutes')}`, showarrow: false, font: { size: 10, color: '#475569' }, bgcolor: 'rgba(255,255,255,0.6)' });
  });
  const layout = baseLayout({ title: { text: t('plotHrTitle'), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: t('bpm'), range: [yLo, yHi], gridcolor: '#eef2f7' }, shapes, annotations, height: 420 });
  Plotly.react(el, traces, layout, CONFIG);
  attachJump(el, onJump, t0);
}

export function plotTachogram(el, session, onJump) {
  const { meta, result } = session;
  const nn = result.series.nn;
  const traces = [{ type: 'scattergl', mode: 'lines+markers', x: dates(meta.startTime, nn.t), y: nn.v, name: t('nnMs'), line: { color: COLORS.normal, width: 1 }, marker: { size: 2 }, hovertemplate: `%{x|%H:%M:%S}<br>${t('rrLabel')}: %{y:.0f} ms<extra></extra>` }];
  Plotly.react(el, traces, baseLayout({ title: { text: t('plotTachogram'), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: t('nnMs'), gridcolor: '#eef2f7' }, height: 320, showlegend: false }), CONFIG);
  attachJump(el, onJump, meta.startTime);
}

export function plotHrHist(el, session) {
  const hr = session.result.series.hr;
  Plotly.react(el, [{ type: 'histogram', x: hr.v, xbins: { size: 2 }, marker: { color: COLORS.normal }, hovertemplate: '%{x} bpm: %{y}<extra></extra>' }],
    baseLayout({ title: { text: t('plotHrHist'), font: { size: 15 } }, xaxis: { title: t('bpm'), gridcolor: '#eef2f7' }, yaxis: { title: t('count'), gridcolor: '#eef2f7' }, height: 300, showlegend: false }), CONFIG);
}

export function plotZones(el, session) {
  const zones = session.result.series.zones || [];
  const names = ['zone_rest', 'zone_recovery', 'zone_aerobic', 'zone_anaerobic', 'zone_maximum'];
  Plotly.react(el, [{ type: 'bar', x: zones.map((z, i) => t(names[i])), y: zones.map((z) => z.seconds / 60), marker: { color: ['#94a3b8', '#38bdf8', '#22c55e', '#facc15', '#ef4444'] }, text: zones.map((z) => `${z.loBpm}–${Number.isFinite(z.hiBpm) ? z.hiBpm : '∞'} bpm`), textposition: 'auto', hovertemplate: '%{x}<br>%{y:.1f} min<extra></extra>' }],
    baseLayout({ title: { text: t('plotZones'), font: { size: 15 } }, yaxis: { title: t('minutes'), gridcolor: '#eef2f7' }, height: 300, showlegend: false }), CONFIG);
}

// ---------------- HRV ----------------
export function plotNnHist(el, session) {
  const h = session.result.series.hist;
  if (!h) { el.innerHTML = ''; return; }
  const x = h.counts.map((_, i) => h.lo + (i + 0.5) * h.bw);
  Plotly.react(el, [{ type: 'bar', x, y: h.counts, width: h.bw, marker: { color: COLORS.normal }, hovertemplate: '%{x:.0f} ms: %{y}<extra></extra>' }],
    baseLayout({ title: { text: `${t('plotNnHist')} (TINN ${Number.isFinite(session.meta.summary.tinn) ? session.meta.summary.tinn.toFixed(0) : '–'} ms)`, font: { size: 15 } }, xaxis: { title: t('nnMs'), gridcolor: '#eef2f7' }, yaxis: { title: t('count'), gridcolor: '#eef2f7' }, height: 320, showlegend: false, bargap: 0 }), CONFIG);
}

export function plotPoincare(el, session) {
  const nn = session.result.series.nn;
  const xs = [], ys = [];
  for (let k = 1; k < nn.v.length; k++) if (nn.adjacent[k]) { xs.push(nn.v[k - 1]); ys.push(nn.v[k]); }
  const S = session.meta.summary;
  const traces = [{ type: 'scattergl', mode: 'markers', x: xs, y: ys, marker: { size: 3, color: 'rgba(37,99,235,0.35)' }, name: 'NN', hovertemplate: '%{x:.0f} → %{y:.0f} ms<extra></extra>' }];
  const shapes = [];
  if (Number.isFinite(S.sd1) && Number.isFinite(S.sd2)) {
    const m = S.meanNN;
    // ellipse rotated 45°
    const pts = [];
    for (let a = 0; a <= 2 * Math.PI + 0.01; a += 0.05) {
      const ex = S.sd2 * Math.cos(a), ey = S.sd1 * Math.sin(a);
      pts.push([m + (ex - ey) / Math.SQRT2, m + (ex + ey) / Math.SQRT2]);
    }
    traces.push({ type: 'scatter', mode: 'lines', x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), line: { color: COLORS.accent, width: 2 }, name: `SD1 ${S.sd1.toFixed(1)} / SD2 ${S.sd2.toFixed(1)} ms`, hoverinfo: 'skip' });
    const lo = Math.min(...xs), hi = Math.max(...xs);
    shapes.push({ type: 'line', x0: lo, y0: lo, x1: hi, y1: hi, line: { color: '#9ca3af', dash: 'dot', width: 1 } });
  }
  Plotly.react(el, traces, baseLayout({ title: { text: t('plotPoincare'), font: { size: 15 } }, xaxis: { title: t('nnCur'), gridcolor: '#eef2f7', scaleanchor: 'y' }, yaxis: { title: t('nnNext'), gridcolor: '#eef2f7' }, shapes, height: 420 }), CONFIG);
}

export function plotPsd(el, session) {
  const psd = session.result.series.psd;
  if (!psd) { el.innerHTML = ''; return; }
  const band = (lo, hi, color, name) => {
    const x = [], y = [];
    for (let k = 0; k < psd.f.length; k++) if (psd.f[k] >= lo && psd.f[k] < hi) { x.push(psd.f[k]); y.push(psd.p[k]); }
    return { type: 'scatter', mode: 'lines', x, y, fill: 'tozeroy', fillcolor: color, line: { width: 0 }, name, hovertemplate: '%{x:.3f} Hz<br>%{y:.0f} ms²/Hz<extra></extra>' };
  };
  const S = session.meta.summary;
  const traces = [
    band(0.0033, 0.04, COLORS.vlf, `${t('vlf')} ${Number.isFinite(S.vlfPower) ? S.vlfPower.toFixed(0) : ''} ms²`),
    band(0.04, 0.15, COLORS.lf, `${t('lf')} ${Number.isFinite(S.lfPower) ? S.lfPower.toFixed(0) : ''} ms²`),
    band(0.15, 0.4, COLORS.hf, `${t('hf')} ${Number.isFinite(S.hfPower) ? S.hfPower.toFixed(0) : ''} ms²`),
    { type: 'scatter', mode: 'lines', x: psd.f.filter((f) => f <= 0.5), y: psd.p.slice(0, psd.f.filter((f) => f <= 0.5).length), line: { color: COLORS.line, width: 1 }, name: 'PSD', hoverinfo: 'skip' },
  ];
  Plotly.react(el, traces, baseLayout({ title: { text: t('plotPsd'), font: { size: 15 } }, xaxis: { title: t('freqHz'), range: [0, 0.5], gridcolor: '#eef2f7' }, yaxis: { title: t('psdUnit'), gridcolor: '#eef2f7', rangemode: 'tozero' }, height: 360 }), CONFIG);
}

export function plotRolling(el, session, onJump) {
  const { meta, result } = session;
  const r = result.series.rolling;
  if (!r || !r.t.length) { el.innerHTML = `<p class="muted">${t('metricValueNA')}</p>`; return; }
  const x = dates(meta.startTime, r.t);
  const traces = [
    { type: 'scatter', mode: 'lines+markers', x, y: r.sdnn, name: 'SDNN (ms)', line: { color: '#2563eb' } },
    { type: 'scatter', mode: 'lines+markers', x, y: r.rmssd, name: 'RMSSD (ms)', line: { color: '#16a34a' } },
    { type: 'scatter', mode: 'lines+markers', x, y: r.sd1, name: 'SD1 (ms)', line: { color: '#9333ea', dash: 'dot' }, visible: 'legendonly' },
    { type: 'scatter', mode: 'lines+markers', x, y: r.sd2, name: 'SD2 (ms)', line: { color: '#0891b2', dash: 'dot' }, visible: 'legendonly' },
    { type: 'scatter', mode: 'lines+markers', x, y: r.pnn50, name: 'pNN50 (%)', yaxis: 'y2', line: { color: '#f59e0b' } },
    { type: 'scatter', mode: 'lines', x, y: r.meanHR, name: `${t('hrLabel')} (bpm)`, yaxis: 'y2', line: { color: '#e11d48', width: 1, dash: 'dash' } },
  ];
  Plotly.react(el, traces, baseLayout({ title: { text: t('plotRolling'), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: t('ms'), gridcolor: '#eef2f7', rangemode: 'tozero' }, yaxis2: { title: '% / bpm', overlaying: 'y', side: 'right', rangemode: 'tozero' }, height: 380, margin: { l: 60, r: 60, t: 40, b: 50 } }), CONFIG);
  attachJump(el, onJump, meta.startTime);
}

export function plotRollingFreq(el, session, onJump) {
  const { meta, result } = session;
  const r = result.series.rolling;
  if (!r || !r.t.length) { el.innerHTML = ''; return; }
  const x = dates(meta.startTime, r.t);
  const traces = [
    { type: 'scatter', mode: 'lines+markers', x, y: r.lf, name: `${t('lf')} (ms²)`, line: { color: '#3b82f6' } },
    { type: 'scatter', mode: 'lines+markers', x, y: r.hf, name: `${t('hf')} (ms²)`, line: { color: '#10b981' } },
    { type: 'scatter', mode: 'lines+markers', x, y: r.lfhf, name: 'LF/HF', yaxis: 'y2', line: { color: '#e11d48', dash: 'dot' } },
  ];
  Plotly.react(el, traces, baseLayout({ title: { text: t('plotRollingFreq'), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: 'ms²', type: 'log', gridcolor: '#eef2f7' }, yaxis2: { title: 'LF/HF', overlaying: 'y', side: 'right', rangemode: 'tozero' }, height: 340, margin: { l: 60, r: 60, t: 40, b: 50 } }), CONFIG);
  attachJump(el, onJump, meta.startTime);
}

export function plotResp(el, session, onJump) {
  const { meta, result } = session;
  const r = result.series.rolling;
  if (!r || !r.t.length) { el.innerHTML = ''; return; }
  const x = dates(meta.startTime, r.t);
  Plotly.react(el, [
    { type: 'scatter', mode: 'lines+markers', x, y: r.respEDR, name: t('edrLegend'), line: { color: '#0ea5e9' } },
    { type: 'scatter', mode: 'lines+markers', x, y: r.respRSA, name: t('rsaLegend'), line: { color: '#8b5cf6' } },
  ], baseLayout({ title: { text: t('plotResp'), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: '/min', gridcolor: '#eef2f7', range: [0, 35] }, height: 300 }), CONFIG);
  attachJump(el, onJump, meta.startTime);
}

export function plotIrregularity(el, session, onJump) {
  const { meta, result } = session;
  const w = result.series.irregularity || [];
  if (!w.length) { el.innerHTML = ''; return; }
  const x = dates(meta.startTime, w.map((q) => q.t + 15));
  Plotly.react(el, [
    { type: 'scatter', mode: 'lines', x, y: w.map((q) => q.nrmssd), name: 'RMSSD / mean NN', line: { color: '#2563eb', width: 1 } },
    { type: 'scatter', mode: 'markers', x: x.filter((_, i) => w[i].irregular), y: w.filter((q) => q.irregular).map((q) => q.nrmssd), name: t('irregular'), marker: { color: COLORS.ectopic, size: 8, symbol: 'diamond' } },
  ], baseLayout({ title: { text: t('plotIrregularity'), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: 'nRMSSD', gridcolor: '#eef2f7', rangemode: 'tozero' }, shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0.1, y1: 0.1, line: { color: '#9ca3af', dash: 'dot' } }], height: 280 }), CONFIG);
  attachJump(el, onJump, meta.startTime);
}

export function plotEdr(el, session) {
  const p = session.result.series.edrPsd;
  if (!p) { el.innerHTML = ''; return; }
  const n = p.f.filter((f) => f <= 0.7).length;
  Plotly.react(el, [{ type: 'scatter', mode: 'lines', x: p.f.slice(0, n), y: p.p.slice(0, n), line: { color: '#0ea5e9' }, fill: 'tozeroy', name: t('edrLegend') }],
    baseLayout({ title: { text: t('plotEdr'), font: { size: 15 } }, xaxis: { title: t('freqHz'), gridcolor: '#eef2f7' }, yaxis: { title: 'µV²/Hz', gridcolor: '#eef2f7' }, height: 280, showlegend: false }), CONFIG);
}

// ---------------- morphology ----------------
export function plotTemplate(el, session) {
  const tpl = session.result.series.template;
  if (!tpl) { el.innerHTML = ''; return; }
  const traces = [{ type: 'scatter', mode: 'lines', x: tpl.t, y: tpl.v, line: { color: COLORS.line, width: 2 }, name: `n=${tpl.nBeats}`, hovertemplate: '%{x:.0f} ms: %{y:.0f} µV<extra></extra>' }];
  const at = (ms) => { let best = 0; for (let i = 1; i < tpl.t.length; i++) if (Math.abs(tpl.t[i] - ms) < Math.abs(tpl.t[best] - ms)) best = i; return tpl.v[best]; };
  const fid = tpl.fiducials;
  const marks = [['pOn', 'P on', '#0891b2'], ['pPk', 'P', '#0891b2'], ['pOff', 'P off', '#0891b2'], ['qrsOn', 'QRS on', '#dc2626'], ['rPk', 'R', '#dc2626'], ['sPk', 'S', '#dc2626'], ['qrsOff', 'J', '#dc2626'], ['tPk', 'T', '#16a34a'], ['tEnd', 'T end', '#16a34a']];
  const annotations = [];
  for (const [k, label, color] of marks) {
    const ms = fid[k];
    if (!Number.isFinite(ms)) continue;
    traces.push({ type: 'scatter', mode: 'markers', x: [ms], y: [at(ms)], marker: { size: 9, color, symbol: 'circle' }, name: label, hovertemplate: `${label}: %{x:.0f} ms<extra></extra>`, showlegend: false });
    annotations.push({ x: ms, y: at(ms), text: label, showarrow: true, arrowhead: 0, ax: 0, ay: -25, font: { size: 10, color } });
  }
  const S = session.meta.summary;
  const sub = [`QRS ${Number.isFinite(S.qrsMedian) ? S.qrsMedian.toFixed(0) : '–'} ms`, `QT ${Number.isFinite(S.qtMean) ? S.qtMean.toFixed(0) : '–'} ms`, `QTc ${Number.isFinite(S.qtcMean) ? S.qtcMean.toFixed(0) : '–'} ms`, `PR ${Number.isFinite(S.prMean) ? S.prMean.toFixed(0) : '–'} ms`].join(' · ');
  Plotly.react(el, traces, baseLayout({ title: { text: `${t('plotTemplate')}<br><span style="font-size:12px;color:#6b7280">${sub}</span>`, font: { size: 15 } }, xaxis: { title: 'ms', gridcolor: '#f3d4d4', dtick: 100, minor: { dtick: 20, showgrid: true, gridcolor: '#fbeaea' } }, yaxis: { title: t('amplitude'), gridcolor: '#f3d4d4', dtick: 500, minor: { dtick: 100, showgrid: true, gridcolor: '#fbeaea' } }, annotations, height: 420, showlegend: false }), CONFIG);
}

export function plotBeatSeries(el, session, key, titleKey, yTitle, onJump, extra = {}) {
  const { meta, result } = session;
  const s = result.series[key];
  if (!s || !s.t.length) { el.innerHTML = ''; return; }
  const traces = [{ type: 'scattergl', mode: 'markers', x: dates(meta.startTime, s.t), y: s.v, marker: { size: 3, color: 'rgba(37,99,235,0.5)' }, name: yTitle, hovertemplate: `%{x|%H:%M:%S}<br>%{y:.0f} ${extra.unit || ''}<extra></extra>` }];
  // running median (window 61)
  if (s.v.length > 200) {
    const w = 60, xs = [], ys = [];
    for (let i = w; i < s.v.length - w; i += Math.max(1, Math.floor(s.v.length / 800))) {
      const win = s.v.slice(i - w, i + w).sort((a, b) => a - b);
      xs.push(new Date(meta.startTime + s.t[i] * 1000)); ys.push(win[w]);
    }
    traces.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, line: { color: COLORS.accent, width: 2 }, name: 'median', hoverinfo: 'skip' });
  }
  const layout = baseLayout({ title: { text: t(titleKey), font: { size: 15 } }, xaxis: { title: t('timeAxis'), gridcolor: '#eef2f7' }, yaxis: { title: yTitle, gridcolor: '#eef2f7', ...(extra.yrange ? { range: extra.yrange } : {}) }, height: 300, showlegend: false });
  Plotly.react(el, traces, layout, CONFIG);
  attachJump(el, onJump, meta.startTime);
}

// ---------------- ECG strip viewer ----------------
export class EcgViewer {
  constructor(plotEl, navCanvas, session) {
    this.el = plotEl; this.nav = navCanvas; this.session = session;
    this.start = 0; this.dur = 10;
    this.filtered = true; this.showBeats = true; this.showFid = true; this.showHR = true;
    this.renderedRange = null; this._busy = false;
    this.el.on && this.el.removeAllListeners && this.el.removeAllListeners('plotly_relayout');
    this._navClick = (ev) => {
      const rect = this.nav.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      this.setStart(frac * this.session.result.duration - this.dur / 2);
    };
    this.nav.addEventListener('click', this._navClick);
    this._resize = () => this.drawNav();
    window.addEventListener('resize', this._resize);
  }
  destroy() {
    this.nav.removeEventListener('click', this._navClick);
    window.removeEventListener('resize', this._resize);
    purge(this.el);
  }
  setSession(session) { this.session = session; this.renderedRange = null; this.setStart(0); }
  setStart(s) {
    const dur = this.session.result.duration;
    this.start = Math.max(0, Math.min(dur - this.dur, s));
    this.render(true);
  }
  setDuration(d) { const center = this.start + this.dur / 2; this.dur = d; this.setStart(center - d / 2); }
  jumpTo(tSec) { this.setStart(tSec - this.dur / 2); }
  render(force = false) {
    const { result, ecg, meta } = this.session;
    const fs = result.fs, t0 = meta.startTime;
    const sig = this.filtered ? result.clean : ecg;
    const pad = this.dur;
    const a = Math.max(0, this.start - pad), b = Math.min(result.duration, this.start + this.dur + pad);
    const needRender = force || !this.renderedRange || a < this.renderedRange[0] || b > this.renderedRange[1];
    if (!needRender) { this.drawNav(); return; }
    const i0 = Math.floor(a * fs), i1 = Math.ceil(b * fs);
    const dec = minMaxDecimate(sig, i0, i1, 6000);
    const x = Array.from(dec.idx, (i) => new Date(t0 + i / fs * 1000));
    const traces = [{ type: 'scattergl', mode: 'lines', x, y: dec.val, line: { color: COLORS.line, width: 1.2 }, name: 'ECG', hovertemplate: '%{x|%H:%M:%S.%L}<br>%{y:.0f} µV<extra></extra>' }];
    const beats = result.beats;
    if (this.showBeats || this.showFid) {
      // find beats in [i0, i1]
      let lo = 0, hi = beats.rIdx.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (beats.rIdx[m] < i0) lo = m + 1; else hi = m; }
      const first = lo;
      const bx = { 0: [], 1: [], 2: [] }, by = { 0: [], 1: [], 2: [] }, btxt = { 0: [], 1: [], 2: [] };
      const fid = { pOn: [[], []], pPk: [[], []], pOff: [[], []], qrsOn: [[], []], qrsOff: [[], []], tPk: [[], []], tEnd: [[], []] };
      for (let k = first; k < beats.rIdx.length && beats.rIdx[k] <= i1; k++) {
        const r = beats.rIdx[k], ty = beats.type[k];
        bx[ty].push(new Date(t0 + r / fs * 1000)); by[ty].push(sig[r]);
        const rr = beats.rrPrev[k];
        btxt[ty].push(this.showHR && Number.isFinite(rr) ? `${Math.round(60000 / rr)}` : '');
        if (this.showFid && ty !== BEAT_ARTIFACT) {
          for (const f of Object.keys(fid)) { const idx = beats[f][k]; if (idx >= 0 && idx < sig.length) { fid[f][0].push(new Date(t0 + idx / fs * 1000)); fid[f][1].push(sig[idx]); } }
        }
      }
      if (this.showBeats) {
        const names = { 0: t('legendNormal'), 1: t('legendEctopic'), 2: t('legendArtifact') };
        for (const ty of [0, 1, 2]) if (bx[ty].length) traces.push({ type: 'scatter', mode: 'markers+text', x: bx[ty], y: by[ty], text: btxt[ty], textposition: 'top center', textfont: { size: 11, color: typeColor(+ty) }, marker: { size: ty === 0 ? 7 : 11, color: typeColor(+ty), symbol: ty === 1 ? 'x' : ty === 2 ? 'square-open' : 'circle' }, name: names[ty], hovertemplate: `%{x|%H:%M:%S.%L}<br>${names[ty]}<extra></extra>` });
      }
      if (this.showFid) {
        const style = { pOn: ['triangle-right', '#0891b2', 'P on'], pPk: ['circle', '#0891b2', 'P'], pOff: ['triangle-left', '#0891b2', 'P off'], qrsOn: ['diamond', '#dc2626', 'QRS on'], qrsOff: ['diamond', '#f97316', 'J'], tPk: ['circle', '#16a34a', 'T'], tEnd: ['triangle-left', '#16a34a', 'T end'] };
        for (const f of Object.keys(fid)) if (fid[f][0].length) traces.push({ type: 'scatter', mode: 'markers', x: fid[f][0], y: fid[f][1], marker: { size: 6, color: style[f][1], symbol: style[f][0] }, name: style[f][2], hovertemplate: `${style[f][2]}<br>%{x|%H:%M:%S.%L}<extra></extra>`, showlegend: false });
      }
    }
    // y range from window content
    let ymin = Infinity, ymax = -Infinity;
    const w0 = Math.floor(this.start * fs), w1 = Math.min(sig.length, Math.ceil((this.start + this.dur) * fs));
    for (let i = w0; i < w1; i++) { const v = sig[i]; if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
    if (!Number.isFinite(ymin)) { ymin = -1000; ymax = 1000; }
    const padY = Math.max(200, (ymax - ymin) * 0.15);
    const layout = baseLayout({
      margin: { l: 60, r: 20, t: 10, b: 40 }, height: 420, dragmode: 'pan', showlegend: false,
      xaxis: { type: 'date', range: [new Date(t0 + this.start * 1000), new Date(t0 + (this.start + this.dur) * 1000)], gridcolor: '#f3c6c6', dtick: this.dur <= 20 ? 1000 : this.dur <= 60 ? 5000 : 15000, minor: { dtick: this.dur <= 20 ? 200 : 1000, showgrid: true, gridcolor: '#fbe4e4' }, tickformat: '%H:%M:%S', zeroline: false },
      yaxis: { title: t('amplitude'), range: [ymin - padY, ymax + padY], gridcolor: '#f3c6c6', dtick: 500, minor: { dtick: 100, showgrid: true, gridcolor: '#fbe4e4' }, zeroline: false, fixedrange: false },
      plot_bgcolor: '#fffafa',
    });
    this._busy = true;
    Plotly.react(this.el, traces, layout, { ...CONFIG, scrollZoom: true }).then(() => { this._busy = false; });
    this.renderedRange = [a, b];
    if (!this._relayoutBound) {
      this._relayoutBound = true;
      this.el.on('plotly_relayout', (ev) => {
        if (this._busy) return;
        const r0 = ev['xaxis.range[0]'] ?? (ev['xaxis.range'] && ev['xaxis.range'][0]);
        const r1 = ev['xaxis.range[1]'] ?? (ev['xaxis.range'] && ev['xaxis.range'][1]);
        if (r0 === undefined || r1 === undefined) return;
        const s = (new Date(r0).getTime() - this.session.meta.startTime) / 1000;
        const e = (new Date(r1).getTime() - this.session.meta.startTime) / 1000;
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;
        this.start = Math.max(0, s); this.dur = Math.min(600, Math.max(1, e - s));
        const need = !this.renderedRange || this.start < this.renderedRange[0] || this.start + this.dur > this.renderedRange[1] || this.dur > (this.renderedRange[1] - this.renderedRange[0]) / 2.5;
        if (need) this.render(true); else this.drawNav();
        if (this.onWindowChange) this.onWindowChange(this.start, this.dur);
      });
    }
    this.drawNav();
    if (this.onWindowChange) this.onWindowChange(this.start, this.dur);
  }
  drawNav() {
    const c = this.nav, ctx = c.getContext('2d');
    const W = c.clientWidth || 800, H = c.clientHeight || 70;
    if (c.width !== W * devicePixelRatio || c.height !== H * devicePixelRatio) { c.width = W * devicePixelRatio; c.height = H * devicePixelRatio; }
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
    const hr = this.session.result.series.hr, dur = this.session.result.duration;
    let lo = 40, hi = 140;
    const vals = hr.v; if (vals.length) { lo = Math.min(...vals) - 5; hi = Math.max(...vals) + 5; }
    const yOf = (v) => H - 4 - (v - lo) / (hi - lo) * (H - 8);
    // quality flags
    const q = this.session.result.quality;
    if (q && q.flags) {
      ctx.fillStyle = 'rgba(239,68,68,0.25)';
      const segSec = q.segLen / this.session.result.fs;
      for (let s = 0; s < q.flags.length; s++) if (q.flags[s]) ctx.fillRect(s * segSec / dur * W, 0, Math.max(1, segSec / dur * W), H);
    }
    for (let k = 0; k < hr.t.length; k++) {
      ctx.fillStyle = hr.type[k] === BEAT_ECTOPIC ? COLORS.ectopic : 'rgba(37,99,235,0.6)';
      const x = hr.t[k] / dur * W;
      const sz = hr.type[k] === BEAT_ECTOPIC ? 3 : 1;
      ctx.fillRect(x, yOf(hr.v[k]), sz, sz);
    }
    // window
    const x0 = this.start / dur * W, x1 = (this.start + this.dur) / dur * W;
    ctx.fillStyle = 'rgba(225,29,72,0.18)'; ctx.fillRect(x0, 0, Math.max(3, x1 - x0), H);
    ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, 0.5, Math.max(3, x1 - x0), H - 1);
    // time labels
    ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui';
    const t0 = this.session.meta.startTime;
    for (let f = 0; f <= 1.0001; f += 0.25) {
      const d = new Date(t0 + f * dur * 1000);
      const label = d.toLocaleTimeString(getLang() === 'hu' ? 'hu-HU' : 'en-GB');
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(W - tw - 2, Math.max(2, f * W - tw / 2)), H - 2);
    }
  }
}

export function purge(el) { try { Plotly.purge(el); } catch { /* noop */ } }
