// Main UI controller.
import { parseEDF, toMicrovolts } from './edf.js';
import { bandpass } from './dsp.js';
import { METRICS } from './metrics.js';
import { BEAT_NORMAL, BEAT_ECTOPIC } from './beats.js';
import { t, setLang, getLang, applyI18n, metricLabel, metricDesc, fmtNumber, fmtDuration, fmtDateTime, fmtTime } from './i18n.js';
import * as store from './storage.js';
import * as plots from './plots.js';
import { renderTrends } from './trends.js';
import { exportMetricsJson, exportBeatsCsv, exportNnCsv } from './export.js';

const $ = (id) => document.getElementById(id);
const state = {
  current: null,        // { id, meta, result, ecg, settings, header }
  sessions: [],
  activeTab: 'summary',
  rendered: new Set(),
  ecgViewer: null,
  worker: null,
  jobId: 0,
};

// ---------------- worker ----------------
function getWorker() {
  if (!state.worker) state.worker = new Worker('./js/worker.js', { type: 'module' });
  return state.worker;
}
function runAnalysis(ecg, fs, physMax, settings) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = ++state.jobId;
    const handler = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') { setProgress(e.data.pct, t(`stage_${e.data.stage}`)); return; }
      w.removeEventListener('message', handler);
      if (e.data.type === 'error') reject(new Error(e.data.message));
      else resolve(e.data);
    };
    w.addEventListener('message', handler);
    w.addEventListener('error', (err) => { w.removeEventListener('message', handler); reject(err.error || new Error(err.message)); }, { once: true });
    w.postMessage({ id, ecg, fs, physMax, settings }, [ecg.buffer]);
  });
}

// ---------------- progress / errors ----------------
function setProgress(pct, label) {
  const p = $('progress');
  p.classList.remove('hidden');
  p.querySelector('.fill').style.width = `${pct}%`;
  p.querySelector('.label').textContent = label || '';
}
function hideProgress() { $('progress').classList.add('hidden'); }
function showError(msg) { const e = $('error'); e.textContent = `${t('errorPrefix')}: ${msg}`; e.classList.remove('hidden'); }
function clearError() { $('error').classList.add('hidden'); }

// ---------------- loading files ----------------
function effectiveSettings(header) {
  const s = store.loadSettings();
  const out = { ...s };
  if (!out.age && header && header.birthdate && header.startTime) {
    out.age = Math.max(1, Math.round((header.startTime - header.birthdate) / (365.25 * 86400000)));
  }
  if (!out.age) out.age = 30;
  if (!out.sex && header && header.sex) out.sex = header.sex;
  if (!out.hrMax) out.hrMax = null;
  return out;
}

async function analyseBuffer(buffer, fileName, existingId = null) {
  clearError();
  setProgress(2, t('stage_parse'));
  let edf;
  try { edf = parseEDF(buffer); }
  catch (err) { hideProgress(); showError(err.message); return; }
  const sig = edf.header.signals[edf.ecgIndex];
  const ecgUv = toMicrovolts(edf.ecg, edf.unit);
  const settings = effectiveSettings(edf.header);
  const physMax = /mv/i.test(edf.unit) ? sig.physMax * 1000 : sig.physMax;
  try {
    const msg = await runAnalysis(ecgUv === edf.ecg ? edf.ecg.slice() : ecgUv, edf.fs, physMax, settings);
    const result = msg.result;
    const ecg = msg.ecg;
    const startTime = edf.header.startTime ? edf.header.startTime.getTime() : Date.now();
    const id = existingId || store.makeId();
    const prev = existingId ? state.sessions.find((s) => s.id === existingId) : null;
    const meta = {
      id, name: prev ? prev.name : fileName.replace(/\.edf$/i, ''), fileName, startTime, duration: result.duration, fs: result.fs,
      device: sig.transducer, channel: sig.label, patient: edf.header.patient, recording: edf.header.recording, prefilter: sig.prefilter,
      summary: result.summary, settings, createdAt: prev ? prev.createdAt : Date.now(), analysedAt: Date.now(),
    };
    setProgress(97, t('stage_render'));
    // the filtered signal is cheap to recompute, don't persist it
    const { clean: _clean, ...storedResult } = result;
    await store.saveSession(meta, { edf: buffer, result: storedResult });
    state.sessions = await store.listSessions();
    setCurrent({ id, meta, result, ecg, settings, header: edf.header, edfBuffer: buffer });
    renderSessionList();
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  } finally {
    hideProgress();
  }
}

async function openSession(id) {
  clearError();
  const meta = state.sessions.find((s) => s.id === id);
  if (!meta) return;
  setProgress(10, t('stage_parse'));
  try {
    const data = await store.getSessionData(id);
    if (!data) throw new Error('Session data missing');
    const edf = parseEDF(data.edf);
    const ecg = toMicrovolts(edf.ecg, edf.unit);
    const result = data.result;
    if (!result.clean) result.clean = bandpass(ecg, result.fs, 0.5, 40, 2);
    setCurrent({ id, meta, result, ecg, settings: meta.settings, header: edf.header, edfBuffer: data.edf });
    renderSessionList();
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
  } finally {
    hideProgress();
  }
}

async function reanalyseCurrent() {
  if (!state.current) return;
  const data = state.current.edfBuffer ? { edf: state.current.edfBuffer } : await store.getSessionData(state.current.id);
  if (!data) return;
  // settings: user overrides win over header defaults
  await analyseBuffer(data.edf, state.current.meta.fileName, state.current.id);
}

function setCurrent(session) {
  if (state.ecgViewer) { state.ecgViewer.destroy(); state.ecgViewer = null; }
  state.current = session;
  state.rendered.clear();
  $('placeholder').classList.add('hidden');
  renderActiveTab(true);
}

// ---------------- session list ----------------
function renderSessionList() {
  const ul = $('sessionList');
  ul.innerHTML = '';
  if (!state.sessions.length) { ul.innerHTML = `<li class="muted small" style="cursor:default;border:none">${t('noSessions')}</li>`; return; }
  for (const s of [...state.sessions].reverse()) {
    const li = document.createElement('li');
    if (state.current && state.current.id === s.id) li.classList.add('active');
    const S = s.summary || {};
    li.innerHTML = `<div class="name">${escapeHtml(s.name)}</div>
      <div class="meta">${fmtDateTime(new Date(s.startTime))} · ${fmtDuration(s.duration)}</div>
      <div class="meta">HR ${fmtNumber(S.meanHR, 0)} bpm · RMSSD ${fmtNumber(S.rmssd, 0)} ms · ${t('legendEctopic')} ${fmtNumber(S.ectopicBeats, 0)}</div>
      <div class="row-actions"><button class="btn" data-act="rename">${t('rename')}</button><button class="btn" data-act="delete">${t('delete')}</button></div>`;
    li.addEventListener('click', (ev) => {
      const act = ev.target.dataset && ev.target.dataset.act;
      if (act === 'rename') { ev.stopPropagation(); renameSession(s); return; }
      if (act === 'delete') { ev.stopPropagation(); removeSession(s); return; }
      openSession(s.id);
    });
    ul.append(li);
  }
}
async function renameSession(s) {
  const name = prompt(t('newName'), s.name);
  if (!name || name === s.name) return;
  s.name = name;
  await store.updateSessionMeta(s);
  if (state.current && state.current.id === s.id) state.current.meta.name = name;
  state.sessions = await store.listSessions();
  renderSessionList();
  state.rendered.delete('summary'); state.rendered.delete('trends');
  renderActiveTab();
}
async function removeSession(s) {
  if (!confirm(t('confirmDelete'))) return;
  await store.deleteSession(s.id);
  state.sessions = await store.listSessions();
  if (state.current && state.current.id === s.id) {
    state.current = null;
    if (state.ecgViewer) { state.ecgViewer.destroy(); state.ecgViewer = null; }
    document.querySelectorAll('.tab').forEach((el) => el.classList.add('hidden'));
    $('placeholder').classList.remove('hidden');
  }
  renderSessionList();
  state.rendered.delete('trends');
  if (state.activeTab === 'trends') renderActiveTab(true);
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------- tabs ----------------
function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  renderActiveTab();
}
function renderActiveTab(force = false) {
  const name = state.activeTab;
  document.querySelectorAll('.tab').forEach((el) => el.classList.add('hidden'));
  const needsSession = !['trends', 'settings'].includes(name);
  if (needsSession && !state.current) { $('placeholder').classList.remove('hidden'); return; }
  $('placeholder').classList.add('hidden');
  $(`tab-${name}`).classList.remove('hidden');
  if (force) state.rendered.delete(name);
  if (state.rendered.has(name)) { if (name === 'ecg' && state.ecgViewer) state.ecgViewer.drawNav(); return; }
  const s = state.current;
  const jump = (sec) => { switchTab('ecg'); state.ecgViewer && state.ecgViewer.jumpTo(sec); };
  switch (name) {
    case 'summary': renderSummary(s); break;
    case 'ecg': renderEcg(s); break;
    case 'hr':
      plots.plotHR($('plotHR'), s, jump); plots.plotHrHist($('plotHrHist'), s); plots.plotZones($('plotZones'), s); plots.plotTachogram($('plotTachogram'), s, jump);
      break;
    case 'hrv':
      plots.plotNnHist($('plotNnHist'), s); plots.plotPoincare($('plotPoincare'), s); plots.plotPsd($('plotPsd'), s);
      plots.plotRolling($('plotRolling'), s, jump); plots.plotRollingFreq($('plotRollingFreq'), s, jump);
      plots.plotResp($('plotResp'), s, jump); plots.plotEdr($('plotEdr'), s); plots.plotIrregularity($('plotIrregularity'), s, jump);
      break;
    case 'morph':
      plots.plotTemplate($('plotTemplate'), s);
      plots.plotBeatSeries($('plotQtc'), s, 'qtc', 'plotQtc', 'QTc (ms)', jump, { unit: 'ms', yrange: [250, 550] });
      plots.plotBeatSeries($('plotQrs'), s, 'qrs', 'plotQrs', 'QRS (ms)', jump, { unit: 'ms', yrange: [40, 160] });
      plots.plotBeatSeries($('plotJ'), s, 'jpoint', 'plotJ', 'J (µV)', jump, { unit: 'µV' });
      plots.plotBeatSeries($('plotTamp'), s, 'tAmp', 'plotTamp', 'T (µV)', jump, { unit: 'µV' });
      break;
    case 'beats': renderBeatsTable(s, jump); break;
    case 'trends': renderTrends($('trendsRoot'), state.sessions, { onOpen: (id) => { openSession(id).then(() => switchTab('summary')); } }); break;
    case 'settings': fillSettingsForm(); break;
    default: break;
  }
  state.rendered.add(name);
}

// ---------------- summary ----------------
function renderSummary(s) {
  const { meta, header, result } = s;
  const info = $('sessionInfo');
  const rows = [
    [t('fileName'), meta.fileName], [t('start'), fmtDateTime(new Date(meta.startTime))], [t('duration'), fmtDuration(meta.duration)],
    [t('samplingRate'), `${meta.fs} Hz`], [t('device'), meta.device || '–'], [t('channel'), `${meta.channel || '–'}${meta.prefilter ? ` · ${meta.prefilter}` : ''}`],
    [t('patient'), meta.patient || '–'],
  ];
  info.innerHTML = `<dl class="session-info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;

  const S = meta.summary;
  const groups = ['hr', 'time', 'freq', 'nonlinear', 'morph', 'resp', 'rhythm'];
  const highlight = new Set(['meanHR', 'minHR', 'maxHR', 'sdnn', 'rmssd', 'pnn50', 'lfHf', 'sd1', 'qrsMean', 'qtcMean', 'ectopicBeats', 'beats']);
  const root = $('summaryGroups');
  root.innerHTML = '';
  for (const g of groups) {
    const items = METRICS.filter((m) => m.group === g);
    const div = document.createElement('div');
    div.className = 'metric-group';
    div.innerHTML = `<h3>${t(`group_${g}`)}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'metric-grid';
    for (const m of items) {
      const v = S[m.key];
      const card = document.createElement('div');
      card.className = `metric-card${highlight.has(m.key) ? ' highlight' : ''}`;
      card.title = metricDesc(m.key);
      let valueHtml = m.key === 'duration' ? fmtDuration(v) : fmtNumber(v, m.dec);
      let timeHtml = '';
      if (m.time && Number.isFinite(S[m.time])) {
        const d = new Date(meta.startTime + S[m.time] * 1000);
        timeHtml = `<div class="time">${t('at')} ${fmtTime(d)}${m.key.includes('1min') ? ` (${t('window')} 60 s)` : ''}</div>`;
      }
      card.innerHTML = `<div class="label">${metricLabel(m.key)}</div><div class="value">${valueHtml}<span class="unit">${m.key === 'duration' ? '' : m.unit}</span></div>${timeHtml}`;
      grid.append(card);
    }
    div.append(grid);
    if (g === 'hr' && result.series.zones) {
      const zones = result.series.zones;
      const total = zones.reduce((a, z) => a + z.seconds, 0) || 1;
      const colors = ['#cbd5e1', '#7dd3fc', '#86efac', '#fde047', '#fca5a5'];
      const names = ['zone_rest', 'zone_recovery', 'zone_aerobic', 'zone_anaerobic', 'zone_maximum'];
      const bar = document.createElement('div');
      bar.innerHTML = `<h3 style="border:none;margin-top:.75rem">${t('zonesTitle')} (HRmax ${S.hrMaxUsed} bpm)</h3>`;
      const zb = document.createElement('div');
      zb.className = 'zone-bars';
      zones.forEach((z, i) => {
        const pct = 100 * z.seconds / total;
        const seg = document.createElement('div');
        seg.style.width = `${pct}%`; seg.style.background = colors[i];
        seg.title = `${t(names[i])}: ${(z.seconds / 60).toFixed(1)} ${t('minutes')} (${pct.toFixed(1)} %) · ${z.loBpm}–${Number.isFinite(z.hiBpm) ? z.hiBpm : '∞'} bpm`;
        seg.textContent = pct > 8 ? `${(z.seconds / 60).toFixed(0)} ${t('minutes')}` : '';
        zb.append(seg);
      });
      bar.append(zb);
      div.append(bar);
    }
    root.append(div);
  }
}

// ---------------- ECG viewer ----------------
function renderEcg(s) {
  if (!state.ecgViewer) {
    state.ecgViewer = new plots.EcgViewer($('ecgPlot'), $('ecgNav'), s);
    state.ecgViewer.dur = +$('ecgDur').value;
    state.ecgViewer.filtered = $('ecgFiltered').checked;
    state.ecgViewer.showBeats = $('ecgBeats').checked;
    state.ecgViewer.showHR = $('ecgHR').checked;
    state.ecgViewer.showFid = $('ecgFid').checked;
    state.ecgViewer.onWindowChange = (start) => {
      const d = new Date(s.meta.startTime + start * 1000);
      $('ecgJumpTime').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    };
  }
  // start at the first ectopic beat if any, else at 60 s
  let start = Math.min(60, Math.max(0, s.result.duration - state.ecgViewer.dur));
  const b = s.result.beats;
  for (let i = 0; i < b.type.length; i++) if (b.type[i] === BEAT_ECTOPIC) { start = b.rIdx[i] / s.result.fs - state.ecgViewer.dur / 2; break; }
  state.ecgViewer.setStart(start);
}
function bindEcgControls() {
  const v = () => state.ecgViewer;
  $('ecgDur').addEventListener('change', () => v() && v().setDuration(+$('ecgDur').value));
  $('ecgPrev').addEventListener('click', () => v() && v().setStart(v().start - v().dur * 0.9));
  $('ecgNext').addEventListener('click', () => v() && v().setStart(v().start + v().dur * 0.9));
  $('ecgJumpTime').addEventListener('change', () => {
    if (!v() || !state.current) return;
    const [hh, mm, ss] = $('ecgJumpTime').value.split(':').map(Number);
    const d0 = new Date(state.current.meta.startTime);
    const target = new Date(d0); target.setHours(hh, mm, ss || 0, 0);
    let sec = (target - d0) / 1000;
    if (sec < 0) sec += 86400;
    v().setStart(sec);
  });
  for (const [id, prop] of [['ecgFiltered', 'filtered'], ['ecgBeats', 'showBeats'], ['ecgHR', 'showHR'], ['ecgFid', 'showFid']]) {
    $(id).addEventListener('change', () => { if (v()) { v()[prop] = $(id).checked; v().render(true); } });
  }
}

// ---------------- beats table ----------------
function renderBeatsTable(s, jump) {
  const b = s.result.beats, fs = s.result.fs, t0 = s.meta.startTime;
  const table = $('beatsTable');
  const rows = [];
  for (let i = 0; i < b.type.length; i++) if (b.type[i] !== BEAT_NORMAL) rows.push(i);
  if (!rows.length) { table.innerHTML = `<tbody><tr><td class="muted">${t('noAbnormalBeats')}</td></tr></tbody>`; return; }
  const head = `<thead><tr><th>#</th><th>${t('colTime')}</th><th>${t('colType')}</th><th>${t('colRRprev')}</th><th>${t('colRRnext')}</th><th>${t('colHR')}</th><th>${t('colCorr')}</th><th>${t('colQrs')}</th></tr></thead>`;
  const body = rows.slice(0, 2000).map((i) => {
    const ty = b.type[i] === BEAT_ECTOPIC ? 'ectopic' : 'artifact';
    const label = b.type[i] === BEAT_ECTOPIC ? t('legendEctopic') : t('legendArtifact');
    return `<tr data-t="${b.rIdx[i] / fs}"><td>${i}</td><td>${fmtTime(new Date(t0 + b.rIdx[i] / fs * 1000))}</td><td class="type-${ty}">${label}</td><td>${fmtNumber(b.rrPrev[i], 0)}</td><td>${fmtNumber(b.rrNext[i], 0)}</td><td>${fmtNumber(Number.isFinite(b.rrPrev[i]) ? 60000 / b.rrPrev[i] : NaN, 0)}</td><td>${fmtNumber(b.corr[i], 2)}</td><td>${fmtNumber(b.qrsDur[i], 0)}</td></tr>`;
  }).join('');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
  table.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => jump(+tr.dataset.t)));
}

// ---------------- settings ----------------
function fillSettingsForm() {
  const s = store.loadSettings();
  $('setAge').value = s.age ?? '';
  $('setSex').value = s.sex ?? '';
  $('setHrMax').value = s.hrMax ?? '';
  $('setQtc').value = s.qtcFormula || 'bazett';
  $('setTachy').value = s.tachyBpm ?? 150;
  $('setBrady').value = s.bradyBpm ?? 50;
  $('setLang').value = getLang();
}
function bindSettings() {
  $('settingsForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const s = {
      age: $('setAge').value ? +$('setAge').value : null,
      sex: $('setSex').value || null,
      hrMax: $('setHrMax').value ? +$('setHrMax').value : null,
      qtcFormula: $('setQtc').value,
      tachyBpm: +$('setTachy').value || 150,
      bradyBpm: +$('setBrady').value || 50,
    };
    store.saveSettings(s);
    if ($('setLang').value !== getLang()) changeLang($('setLang').value);
    switchTab('summary');
  });
}

// ---------------- language ----------------
function changeLang(l) {
  setLang(l);
  document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === l));
  state.rendered.clear();
  renderSessionList();
  renderActiveTab();
}

// ---------------- file input / drag & drop ----------------
function bindFileInputs() {
  const dz = $('dropzone'), input = $('fileInput');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.edf$/i.test(f.name)) loadFile(f); });
  $('demoBtn').addEventListener('click', async () => {
    clearError();
    $('demoBtn').disabled = true;
    try {
      setProgress(1, t('stage_parse'));
      const name = 'antivirus410_2026-01-01_14-49-46.edf';
      const resp = await fetch(`sample/${name}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      await analyseBuffer(buf, name);
    } catch (err) { hideProgress(); showError(err.message); }
    finally { $('demoBtn').disabled = false; }
  });
}
async function loadFile(file) {
  const buf = await file.arrayBuffer();
  await analyseBuffer(buf, file.name);
}

// ---------------- init ----------------
async function init() {
  applyI18n();
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLang());
    b.addEventListener('click', () => changeLang(b.dataset.lang));
  });
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  bindFileInputs(); bindEcgControls(); bindSettings();
  $('exportJsonBtn').addEventListener('click', () => state.current && exportMetricsJson(state.current));
  $('exportBeatsBtn').addEventListener('click', () => state.current && exportBeatsCsv(state.current));
  $('exportNnBtn').addEventListener('click', () => state.current && exportNnCsv(state.current));
  $('reanalyseBtn').addEventListener('click', reanalyseCurrent);
  try { state.sessions = await store.listSessions(); } catch (err) { console.warn('IndexedDB unavailable', err); }
  renderSessionList();
  if (state.sessions.length) await openSession(state.sessions[state.sessions.length - 1].id);
  else renderActiveTab();
}
init();
