/* RSVP reader: state, player loop, controls. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    inputPanel: $('inputPanel'), reader: $('reader'),
    dropzone: $('dropzone'), fileInput: $('fileInput'), textInput: $('textInput'), startTextBtn: $('startTextBtn'),
    progress: $('progress'), error: $('error'),
    docTitle: $('docTitle'), loadOtherBtn: $('loadOtherBtn'),
    stage: $('stage'), reticle: $('reticle'), wBefore: $('wBefore'), wOrp: $('wOrp'), wAfter: $('wAfter'), context: $('context'),
    seekBar: $('seekBar'), seekFill: $('seekFill'), posLabel: $('posLabel'), etaLabel: $('etaLabel'),
    restartBtn: $('restartBtn'), backBtn: $('backBtn'), playBtn: $('playBtn'), fwdBtn: $('fwdBtn'),
    backAmount: $('backAmount'), fwdAmount: $('fwdAmount'),
    wpmRange: $('wpmRange'), wpmOut: $('wpmOut'),
    rewindRange: $('rewindRange'), rewindOut: $('rewindOut'),
    fontRange: $('fontRange'), fontOut: $('fontOut'),
  };

  const SETTINGS_KEY = 'rsvp.settings';
  const state = {
    tokens: [],
    cum: [],          // cumulative delay multipliers (ms at 60 wpm) for ETA
    idx: 0,
    playing: false,
    timer: null,
    wpm: 300,
    rewindSec: 2,
    fontSize: 64,
    title: '',
  };

  /* ---------- settings ---------- */
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (s.wpm) state.wpm = clamp(+s.wpm, 100, 1000);
      if (s.rewindSec) state.rewindSec = clamp(+s.rewindSec, 1, 5);
      if (s.fontSize) state.fontSize = clamp(+s.fontSize, 28, 120);
    } catch (_) { /* ignore */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ wpm: state.wpm, rewindSec: state.rewindSec, fontSize: state.fontSize }));
    } catch (_) { /* ignore */ }
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, isFinite(v) ? v : lo)); }

  function applySettingsToUi() {
    els.wpmRange.value = state.wpm; els.wpmOut.value = state.wpm;
    els.rewindRange.value = state.rewindSec; els.rewindOut.value = state.rewindSec;
    els.fontRange.value = state.fontSize; els.fontOut.value = state.fontSize;
    els.stage.style.setProperty('--word-size', state.fontSize + 'px');
    updateJumpLabels();
  }

  /* ---------- helpers ---------- */
  function jumpWords() {
    return Math.max(1, Math.round((state.wpm / 60) * state.rewindSec));
  }
  function updateJumpLabels() {
    const n = jumpWords();
    els.backAmount.textContent = n;
    els.fwdAmount.textContent = n;
    els.backBtn.title = `Rewind ${n} words (Left arrow)`;
    els.fwdBtn.title = `Forward ${n} words (Right arrow)`;
  }
  function showError(msg) {
    els.error.textContent = msg;
    els.error.classList.remove('hidden');
  }
  function hideError() { els.error.classList.add('hidden'); }
  function setProgress(frac, label) {
    els.progress.classList.remove('hidden');
    els.progress.querySelector('.fill').style.width = Math.round(frac * 100) + '%';
    els.progress.querySelector('.label').textContent = label;
  }
  function hideProgress() { els.progress.classList.add('hidden'); }
  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ---------- document loading ---------- */
  function loadTokens(tokens, title) {
    if (!tokens.length) { showError('No readable text found.'); return; }
    stop();
    state.tokens = tokens;
    state.title = title;
    state.idx = 0;
    // cumulative multipliers, wpm independent (delay at 60 wpm == 1000 ms * mult)
    const cum = new Float64Array(tokens.length + 1);
    for (let i = 0; i < tokens.length; i++) cum[i + 1] = cum[i] + ORP.wordDelay(tokens[i], 60);
    state.cum = cum;

    els.docTitle.textContent = `${title} - ${tokens.length.toLocaleString()} words`;
    els.inputPanel.classList.add('hidden');
    els.reader.classList.remove('hidden');
    els.reticle.classList.remove('done');
    hideProgress();
    hideError();
    render();
    els.stage.focus({ preventScroll: true });
  }

  async function loadPdf(file) {
    hideError();
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('Please choose a PDF file.');
      return;
    }
    try {
      setProgress(0, 'Opening PDF...');
      const text = await Extract.extractPdfText(file, (p, total) => setProgress(p / total, `Extracting page ${p} / ${total}`));
      const tokens = Extract.tokenize(text);
      if (!tokens.length) {
        hideProgress();
        showError('This PDF contains no extractable text (it may be a scanned image).');
        return;
      }
      loadTokens(tokens, file.name);
    } catch (err) {
      console.error(err);
      hideProgress();
      showError('Could not read this PDF: ' + (err && err.message ? err.message : err));
    }
  }

  function loadPasted() {
    const text = els.textInput.value;
    const tokens = Extract.tokenize(text);
    if (!tokens.length) { showError('Paste some text first.'); return; }
    loadTokens(tokens, 'Pasted text');
  }

  /* ---------- rendering ---------- */
  function render() {
    const n = state.tokens.length;
    const i = state.idx;
    if (i >= n) {
      els.wBefore.textContent = '';
      els.wOrp.textContent = '';
      els.wAfter.textContent = 'End of text';
      els.reticle.classList.add('done');
    } else {
      els.reticle.classList.remove('done');
      const parts = ORP.orpParts(state.tokens[i].text);
      els.wBefore.textContent = parts.before;
      els.wOrp.textContent = parts.orp;
      els.wAfter.textContent = parts.after;
    }
    // progress + eta
    const frac = n ? Math.min(1, i / n) : 0;
    els.seekFill.style.width = (frac * 100) + '%';
    els.seekBar.setAttribute('aria-valuenow', Math.round(frac * 100));
    els.posLabel.textContent = `${Math.min(i + 1, n).toLocaleString()} / ${n.toLocaleString()}`;
    const remainingMs = (state.cum[n] - state.cum[Math.min(i, n)]) * (60 / state.wpm);
    els.etaLabel.textContent = i >= n ? 'done' : `${fmtTime(remainingMs)} left`;
    renderContext();
    fitWord();
  }

  /* Keep the chosen font size, but shrink a word that would run off the window. */
  function fitWord() {
    const preferred = state.fontSize;
    els.reticle.style.fontSize = preferred + 'px';
    const half = window.innerWidth / 2 - 16;
    const before = els.wBefore.getBoundingClientRect().width;
    const after = els.wAfter.getBoundingClientRect().width;
    const orp = els.wOrp.getBoundingClientRect().width;
    const need = Math.max(before, after) + orp / 2;
    if (need > half && need > 0) {
      els.reticle.style.fontSize = Math.max(18, preferred * half / need) + 'px';
    }
  }

  function renderContext() {
    const n = state.tokens.length;
    const i = Math.min(state.idx, n - 1);
    const from = Math.max(0, i - 8), to = Math.min(n, i + 9);
    els.context.textContent = '';
    for (let k = from; k < to; k++) {
      const span = document.createElement('span');
      span.textContent = state.tokens[k].text;
      if (k === i) span.className = 'cur';
      els.context.appendChild(span);
      if (k < to - 1) els.context.appendChild(document.createTextNode(' '));
    }
  }

  /* ---------- player ---------- */
  function schedule() {
    clearTimeout(state.timer);
    if (!state.playing) return;
    if (state.idx >= state.tokens.length) { stop(); render(); return; }
    const delay = ORP.wordDelay(state.tokens[state.idx], state.wpm);
    state.timer = setTimeout(() => {
      state.idx++;
      if (state.idx >= state.tokens.length) { stop(); render(); return; }
      render();
      schedule();
    }, delay);
  }

  function play() {
    if (!state.tokens.length) return;
    if (state.idx >= state.tokens.length) state.idx = 0;
    state.playing = true;
    els.playBtn.textContent = 'Pause';
    els.stage.classList.add('playing');
    render();
    schedule();
  }
  function stop() {
    state.playing = false;
    clearTimeout(state.timer);
    state.timer = null;
    els.playBtn.textContent = 'Play';
    els.stage.classList.remove('playing');
  }
  function toggle() { state.playing ? stop() : play(); if (!state.playing) render(); }

  function seekTo(i) {
    state.idx = clamp(Math.round(i), 0, state.tokens.length);
    render();
    if (state.playing) schedule();
  }
  function rewind(words) { seekTo(state.idx - (words || jumpWords())); }
  function forward(words) { seekTo(state.idx + (words || jumpWords())); }

  function setWpm(v) {
    state.wpm = clamp(Math.round(v), 100, 1000);
    els.wpmRange.value = state.wpm; els.wpmOut.value = state.wpm;
    updateJumpLabels();
    saveSettings();
    render();
    if (state.playing) schedule();
  }

  /* ---------- events ---------- */
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); } });
  els.fileInput.addEventListener('change', () => { loadPdf(els.fileInput.files[0]); els.fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    showInput();
    loadPdf(f);
  });
  els.startTextBtn.addEventListener('click', loadPasted);

  function showInput() {
    stop();
    els.reader.classList.add('hidden');
    els.inputPanel.classList.remove('hidden');
    hideError();
  }
  els.loadOtherBtn.addEventListener('click', showInput);

  els.playBtn.addEventListener('click', toggle);
  els.stage.addEventListener('click', toggle);
  els.restartBtn.addEventListener('click', () => { seekTo(0); });
  els.backBtn.addEventListener('click', () => rewind());
  els.fwdBtn.addEventListener('click', () => forward());

  els.seekBar.addEventListener('click', (e) => {
    const r = els.seekBar.getBoundingClientRect();
    const frac = clamp((e.clientX - r.left) / r.width, 0, 1);
    seekTo(frac * state.tokens.length);
  });

  els.wpmRange.addEventListener('input', () => setWpm(+els.wpmRange.value));
  els.rewindRange.addEventListener('input', () => {
    state.rewindSec = +els.rewindRange.value;
    els.rewindOut.value = state.rewindSec;
    updateJumpLabels();
    saveSettings();
  });
  els.fontRange.addEventListener('input', () => {
    state.fontSize = +els.fontRange.value;
    els.fontOut.value = state.fontSize;
    els.stage.style.setProperty('--word-size', state.fontSize + 'px');
    saveSettings();
    fitWord();
  });
  window.addEventListener('resize', fitWord);

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'BUTTON' && e.key === ' ')) return;
    if (els.reader.classList.contains('hidden')) return;
    switch (e.key) {
      case ' ': e.preventDefault(); toggle(); break;
      case 'ArrowLeft': e.preventDefault(); rewind(e.shiftKey ? 1 : 0); break;
      case 'ArrowRight': e.preventDefault(); forward(e.shiftKey ? 1 : 0); break;
      case 'ArrowUp': e.preventDefault(); setWpm(state.wpm + 25); break;
      case 'ArrowDown': e.preventDefault(); setWpm(state.wpm - 25); break;
      case 'Home': e.preventDefault(); seekTo(0); break;
      default: return;
    }
  });

  /* ---------- init ---------- */
  loadSettings();
  applySettingsToUi();
})();
