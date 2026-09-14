// Printable one-page summary to take to a doctor. Builds a self-contained HTML
// document (inline CSS, ECG strips as inline PNGs) in a new window and calls
// print(), so nothing depends on this site being reachable afterwards.
import { t, fmtNumber, fmtDuration, fmtDateTime, fmtTime, metricLabel } from './i18n.js';
import { findingTitle, findingValueText, findingRefText, findingExplanation, findingNotes, bannerText } from './findings.js';
import { baseLayout } from './plots.js';
import { minMaxDecimate } from './dsp.js';

const REPORT_METRICS = [
  'beats', 'meanHR', 'minHR', 'maxHR', 'sdnn', 'rmssd', 'pnn50',
  'qrsMean', 'prMean', 'qtMean', 'qtcMean', 'ectopicBeats', 'ectopicPct', 'artifactPct',
];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Pick up to `max` distinct moments worth printing: evidence from the most
// serious findings first, then the symptom matches.
function stripTimes(session, max = 6) {
  const times = [];
  const push = (tt) => {
    if (!Number.isFinite(tt)) return;
    if (times.some((x) => Math.abs(x - tt) < 4)) return;
    if (times.length < max) times.push(tt);
  };
  for (const sev of ['discuss', 'borderline']) {
    for (const f of session.findings || []) {
      if (f.severity !== sev || f.id === 'quality') continue;
      for (const e of f.evidence || []) push(e.t);
    }
  }
  for (const m of (session.symptoms && session.symptoms.matches) || []) if (m.matched) push(m.beatT);
  return times.sort((a, b) => a - b);
}

async function stripImage(session, tSec, holder, width = 900, windowSec = 8) {
  const { result, meta } = session;
  const fs = result.fs, sig = result.clean;
  if (!sig) return null;
  const a = Math.max(0, tSec - windowSec / 2), b = Math.min(result.duration, a + windowSec);
  const i0 = Math.floor(a * fs), i1 = Math.ceil(b * fs);
  const dec = minMaxDecimate(sig, i0, i1, 3000);
  const x = Array.from(dec.idx, (i) => new Date(meta.startTime + i / fs * 1000));
  let ymin = Infinity, ymax = -Infinity;
  for (const v of dec.val) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
  const pad = Math.max(150, (ymax - ymin) * 0.12);
  const beats = result.beats, bx = [], by = [];
  for (let k = 0; k < beats.rIdx.length; k++) {
    const r = beats.rIdx[k];
    if (r < i0) continue;
    if (r > i1) break;
    if (beats.type[k] === 1) { bx.push(new Date(meta.startTime + r / fs * 1000)); by.push(sig[r]); }
  }
  const traces = [{ type: 'scatter', mode: 'lines', x, y: dec.val, line: { color: '#111827', width: 1 }, hoverinfo: 'skip' }];
  if (bx.length) traces.push({ type: 'scatter', mode: 'markers', x: bx, y: by, marker: { size: 9, color: '#dc2626', symbol: 'x' }, hoverinfo: 'skip' });
  const layout = baseLayout({
    width, height: 200, showlegend: false, margin: { l: 50, r: 10, t: 24, b: 30 },
    title: { text: fmtTime(new Date(meta.startTime + tSec * 1000)), font: { size: 12 } },
    xaxis: { type: 'date', tickformat: '%H:%M:%S', gridcolor: '#f3c6c6', dtick: 1000, minor: { dtick: 200, showgrid: true, gridcolor: '#fbe4e4' } },
    yaxis: { title: 'µV', range: [ymin - pad, ymax + pad], gridcolor: '#f3c6c6', dtick: 500, minor: { dtick: 100, showgrid: true, gridcolor: '#fbe4e4' } },
    plot_bgcolor: '#fffafa',
  });
  await Plotly.newPlot(holder, traces, layout, { staticPlot: true });
  const url = await Plotly.toImage(holder, { format: 'png', width, height: 200, scale: 2 });
  Plotly.purge(holder);
  return url;
}

function findingsHtml(session) {
  const list = session.findings || [];
  if (!list.length) return `<p>${t('reportNothing')}</p>`;
  return list.map((f) => {
    const notes = findingNotes(f);
    return `<div class="finding sev-${f.severity}">
      <div class="fh"><strong>${esc(findingTitle(f))}</strong><span class="badge">${esc(t(`sev_${f.severity}`))}</span></div>
      <div class="fv"><span>${t('findingMeasured')}: <b>${esc(findingValueText(f))}</b></span><span>${t('findingReference')}: ${esc(findingRefText(f))}</span></div>
      <p>${esc(findingExplanation(f))}</p>
      ${notes.map((x) => `<p class="note">${esc(x)}</p>`).join('')}
    </div>`;
  }).join('');
}

function measurementsHtml(session) {
  const S = session.meta.summary;
  const rows = REPORT_METRICS.filter((k) => Number.isFinite(S[k]))
    .map((k) => `<tr><td>${esc(metricLabel(k))}</td><td class="num">${fmtNumber(S[k], k.endsWith('Pct') ? 2 : k === 'beats' ? 0 : 1)}</td></tr>`).join('');
  return `<table class="tbl"><tbody>${rows}</tbody></table>`;
}

function symptomsHtml(session) {
  const sy = session.symptoms;
  if (!sy || !sy.total) return `<p class="note">${t('noEvents')}</p>`;
  const rows = sy.matches.map((m, i) => `<tr>
    <td>${i + 1}</td>
    <td>${fmtTime(new Date(session.meta.startTime + m.event.t * 1000))}</td>
    <td>${m.matched ? `${fmtTime(new Date(session.meta.startTime + m.beatT * 1000))} (${fmtNumber(m.deltaSec, 2)} s)` : t('matchedNo')}</td>
    <td>${m.matched && Number.isFinite(m.qrsDur) ? fmtNumber(m.qrsDur, 0) : '–'}</td>
    <td>${m.event.wellbeing === null ? '–' : fmtNumber(m.event.wellbeing, 0)}</td>
    <td>${esc(m.event.note || '')}</td></tr>`).join('');
  return `<p>${esc(t('valueMatched', { matched: sy.matchedCount, total: sy.total }))}</p>
    <table class="tbl"><thead><tr><th>#</th><th>${t('colEvent')}</th><th>${t('colMatchedBeat')}</th><th>${t('colQrs')}</th><th>${t('colWellbeing')}</th><th>${t('colNote')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const CSS = `
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 24px 28px; line-height: 1.4; }
  h1 { font-size: 1.3rem; margin: 0 0 .2rem; }
  h2 { font-size: 1rem; margin: 1.1rem 0 .4rem; border-bottom: 1px solid #e2e8f0; padding-bottom: .15rem; }
  p { margin: .3rem 0; font-size: .86rem; }
  .sub, .note { color: #64748b; font-size: .78rem; }
  .meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: .1rem .8rem; font-size: .8rem; margin-top: .4rem; }
  .banner { border: 1px solid #cbd5e1; border-left: 5px solid #64748b; padding: .5rem .7rem; border-radius: 6px; margin: .6rem 0; }
  .banner.sev-discuss, .finding.sev-discuss { border-left-color: #dc2626; }
  .banner.sev-borderline, .finding.sev-borderline { border-left-color: #d97706; }
  .banner.sev-normal, .finding.sev-normal { border-left-color: #16a34a; }
  .banner.sev-unreliable, .finding.sev-unreliable { border-left-color: #64748b; }
  .banner strong { display: block; }
  .finding { border: 1px solid #e2e8f0; border-left: 5px solid #64748b; border-radius: 6px; padding: .4rem .6rem; margin-bottom: .4rem; page-break-inside: avoid; }
  .fh { display: flex; justify-content: space-between; gap: .5rem; font-size: .9rem; }
  .badge { font-size: .7rem; text-transform: uppercase; color: #475569; }
  .fv { display: flex; gap: 1.2rem; font-size: .8rem; color: #334155; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; align-items: start; }
  .tbl { border-collapse: collapse; width: 100%; font-size: .78rem; }
  .tbl th, .tbl td { border-bottom: 1px solid #e2e8f0; padding: .18rem .35rem; text-align: left; }
  .tbl th { color: #64748b; font-weight: 600; }
  .tbl td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .strips img { width: 100%; max-width: 720px; display: block; margin: .3rem 0; page-break-inside: avoid; }
  .redflags { border: 1px solid #fecaca; background: #fef2f2; color: #7f1d1d; padding: .4rem .6rem; border-radius: 6px; font-size: .78rem; margin-top: .8rem; }
  .toolbar { position: fixed; top: 8px; right: 12px; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
`;

/**
 * Open the printable summary in a new window.
 * @param {object} session state.current, with findings already computed
 */
export async function openReport(session) {
  const { meta } = session;
  const b = bannerText(session.findings || [], session.severity);

  // strips are rendered offscreen in this document, then inlined as PNGs
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:200px';
  document.body.append(holder);
  const images = [];
  try {
    for (const tt of stripTimes(session)) {
      const url = await stripImage(session, tt, holder);
      if (url) images.push({ t: tt, url });
    }
  } catch (err) {
    console.warn('Strip rendering failed', err);
  } finally {
    holder.remove();
  }

  const metaRows = [
    [t('fileName'), meta.fileName], [t('start'), fmtDateTime(new Date(meta.startTime))],
    [t('duration'), fmtDuration(meta.duration)], [t('samplingRate'), `${meta.fs} Hz`],
    [t('device'), meta.device || '–'], [t('channel'), meta.channel || '–'],
    [t('setAge'), meta.settings && meta.settings.age != null ? meta.settings.age : '–'],
    [t('setSex'), meta.settings && meta.settings.sex ? t(meta.settings.sex === 'F' ? 'sexF' : 'sexM') : t('sexU')],
    [t('setQtc'), (meta.settings && meta.settings.qtcFormula) || 'bazett'],
  ];

  const html = `<!DOCTYPE html><html lang="${document.documentElement.lang || 'en'}"><head>
<meta charset="utf-8"><title>${esc(t('reportTitle'))} – ${esc(meta.name)}</title><style>${CSS}</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">${esc(t('printNow'))}</button></div>
<h1>${esc(t('reportTitle'))}</h1>
<p class="sub">${esc(t('reportSubtitle'))}</p>
<div class="meta">${metaRows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>
<div class="banner sev-${b.key}"><strong>${esc(b.title)}</strong><span class="sub">${esc(b.text)}</span></div>
<h2>${esc(t('reportFindings'))}</h2>
${findingsHtml(session)}
<div class="cols">
  <div><h2>${esc(t('reportMeasurements'))}</h2>${measurementsHtml(session)}</div>
  <div><h2>${esc(t('reportSymptoms'))}</h2>${symptomsHtml(session)}</div>
</div>
${images.length ? `<h2>${esc(t('reportStrips'))}</h2><p class="note">${esc(t('reportStripsHint'))}</p>
<div class="strips">${images.map((im) => `<img alt="ECG ${fmtTime(new Date(meta.startTime + im.t * 1000))}" src="${im.url}">`).join('')}</div>` : ''}
<h2>${esc(t('reportMethod'))}</h2>
<p class="note">${esc(t('reportMethodText'))}</p>
<p class="note">${esc(t('screeningNote'))}</p>
<div class="redflags"><b>${esc(t('redFlagsTitle'))}</b> ${esc(t('redFlagsText'))}</div>
<p class="note">${esc(t('disclaimer'))}</p>
<p class="note">${esc(t('reportGenerated'))}: ${esc(fmtDateTime(new Date()))}</p>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // let layout settle (and images decode) before the print dialog
  setTimeout(() => { try { w.print(); } catch { /* user can use the button */ } }, 400);
  return w;
}
