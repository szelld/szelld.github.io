// Cross-session trends: metric selector, trend chart, comparison table.
import { t, metricLabel, metricDesc, fmtNumber, fmtDuration } from './i18n.js';
import { METRICS } from './metrics.js';
import { baseLayout } from './plots.js';

const KEY = 'ecg.trendMetrics';
const DEFAULT = ['meanHR', 'rmssd', 'sdnn', 'qtcMean', 'ectopicPct'];
const PALETTE = ['#2563eb', '#16a34a', '#e11d48', '#f59e0b', '#9333ea', '#0891b2', '#dc2626', '#65a30d'];

export function getTrendMetrics() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v) && v.length) return v; } catch { /* noop */ }
  return [...DEFAULT];
}
export function setTrendMetrics(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

export function renderTrends(root, sessions, { onOpen } = {}) {
  root.innerHTML = '';
  if (!sessions.length) { root.innerHTML = `<p class="muted" data-i18n="noTrends">${t('noTrends')}</p>`; return; }
  const selected = getTrendMetrics();

  const controls = document.createElement('div');
  controls.className = 'trend-controls';
  const sel = document.createElement('select');
  sel.innerHTML = METRICS.filter((m) => !selected.includes(m.key)).map((m) => `<option value="${m.key}">${metricLabel(m.key)}${m.unit ? ` (${m.unit})` : ''}</option>`).join('');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn'; addBtn.textContent = t('trendAdd');
  addBtn.onclick = () => { if (!sel.value) return; selected.push(sel.value); setTrendMetrics(selected); renderTrends(root, sessions, { onOpen }); };
  controls.append(sel, addBtn);
  const chips = document.createElement('div');
  chips.className = 'chips';
  selected.forEach((k, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.style.borderColor = PALETTE[i % PALETTE.length];
    chip.title = metricDesc(k);
    chip.innerHTML = `${metricLabel(k)} <button aria-label="remove">×</button>`;
    chip.querySelector('button').onclick = () => { selected.splice(i, 1); setTrendMetrics(selected); renderTrends(root, sessions, { onOpen }); };
    chips.append(chip);
  });
  root.append(controls, chips);

  // chart: one subplot row per metric (shared x)
  const chart = document.createElement('div');
  chart.className = 'plot';
  root.append(chart);
  const n = selected.length || 1;
  const traces = [];
  const layout = baseLayout({ height: Math.max(300, 180 * n), grid: { rows: n, columns: 1, pattern: 'independent', roworder: 'top to bottom' }, showlegend: false, margin: { l: 70, r: 20, t: 30, b: 50 } });
  const x = sessions.map((s) => new Date(s.startTime));
  selected.forEach((k, i) => {
    const m = METRICS.find((mm) => mm.key === k) || { unit: '', dec: 1 };
    const ax = i === 0 ? '' : String(i + 1);
    traces.push({ type: 'scatter', mode: 'lines+markers', x, y: sessions.map((s) => (Number.isFinite(s.summary[k]) ? s.summary[k] : null)), text: sessions.map((s) => s.name), xaxis: `x${ax}`, yaxis: `y${ax}`, marker: { size: 9, color: PALETTE[i % PALETTE.length] }, line: { color: PALETTE[i % PALETTE.length] }, name: metricLabel(k), hovertemplate: `%{text}<br>%{x|%Y-%m-%d %H:%M}<br>${metricLabel(k)}: %{y:.${m.dec}f} ${m.unit}<extra></extra>` });
    layout[`xaxis${ax}`] = { type: 'date', gridcolor: '#eef2f7', showticklabels: i === n - 1, matches: i === 0 ? undefined : 'x' };
    if (sessions.length === 1) {
      const d = sessions[0].startTime;
      layout[`xaxis${ax}`].range = [new Date(d - 86400000 * 3), new Date(d + 86400000 * 3)];
    }
    layout[`yaxis${ax}`] = { title: { text: `${metricLabel(k)}${m.unit ? ` (${m.unit})` : ''}`, font: { size: 11 } }, gridcolor: '#eef2f7' };
  });
  Plotly.react(chart, traces, layout, { responsive: true, displaylogo: false });
  chart.on('plotly_click', (ev) => { const p = ev.points && ev.points[0]; if (p && onOpen) onOpen(sessions[p.pointIndex].id); });

  // comparison table
  const h = document.createElement('h3'); h.textContent = t('trendTable');
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const cols = ['meanHR', 'minHR', 'maxHR', 'sdnn', 'rmssd', 'pnn50', 'lfHf', 'sd1', 'sd2', 'qrsMedian', 'qtcMean', 'ectopicBeats', 'artifactPct', 'respRateRSA'];
  table.innerHTML = `<thead><tr><th>${t('sessionDate')}</th><th>${t('sessionName')}</th><th>${t('duration')}</th>${cols.map((c) => `<th title="${metricDesc(c)}">${metricLabel(c)}</th>`).join('')}</tr></thead>`;
  const tb = document.createElement('tbody');
  for (const s of sessions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(s.startTime).toLocaleString()}</td><td>${s.name}</td><td>${fmtDuration(s.duration)}</td>${cols.map((c) => { const m = METRICS.find((mm) => mm.key === c); return `<td>${fmtNumber(s.summary[c], m ? m.dec : 1)}</td>`; }).join('')}`;
    tr.onclick = () => onOpen && onOpen(s.id);
    tb.append(tr);
  }
  table.append(tb); wrap.append(table);
  root.append(h, wrap);
}
