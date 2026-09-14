// Minimal EDF / EDF+ reader. Works in browsers and Node (ESM).
// Returns header info, one Float32Array per ordinary signal (physical units)
// and the index of the most likely ECG channel.

const ASCII = (bytes, start, len) => {
  let s = '';
  for (let i = start; i < start + len; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

function parseStart(dateStr, timeStr) {
  // dd.mm.yy and hh.mm.ss ; EDF spec: yy 85-99 -> 1985-1999, 00-84 -> 2000-2084
  const [d, m, y] = dateStr.trim().split('.').map(Number);
  const [hh, mm, ss] = timeStr.trim().split('.').map(Number);
  if ([d, m, y, hh, mm, ss].some((v) => Number.isNaN(v))) return null;
  const year = y >= 85 ? 1900 + y : 2000 + y;
  return new Date(year, m - 1, d, hh, mm, ss);
}

function parseBirthdate(patientField) {
  // EDF+ patient field: code sex birthdate name. Birthdate like 01-JAN-2003 or 01-01-2003
  const parts = patientField.trim().split(/\s+/);
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  for (const p of parts) {
    let m = p.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (m && months[m[2].toUpperCase()] !== undefined) return new Date(+m[3], months[m[2].toUpperCase()], +m[1]);
    m = p.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  }
  return null;
}

function parseSex(patientField) {
  const parts = patientField.trim().split(/\s+/);
  for (const p of parts) {
    if (p === 'M' || p === 'F') return p;
  }
  return null;
}

export function parseEDF(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 256) throw new Error('File too small to be an EDF file');

  const version = ASCII(bytes, 0, 8).trim();
  const patient = ASCII(bytes, 8, 80).trim();
  const recording = ASCII(bytes, 88, 80).trim();
  const startDate = ASCII(bytes, 168, 8);
  const startTime = ASCII(bytes, 176, 8);
  const headerBytes = parseInt(ASCII(bytes, 184, 8), 10);
  const reserved = ASCII(bytes, 192, 44).trim();
  let nRecords = parseInt(ASCII(bytes, 236, 8), 10);
  const recordDuration = parseFloat(ASCII(bytes, 244, 8));
  const nSignals = parseInt(ASCII(bytes, 252, 4), 10);

  if (version !== '0' || !Number.isFinite(nSignals) || nSignals <= 0) {
    throw new Error('Not a valid EDF file (bad header)');
  }
  if (bytes.length < headerBytes) throw new Error('Truncated EDF header');

  const fields = [
    ['label', 16], ['transducer', 80], ['unit', 8], ['physMin', 8], ['physMax', 8],
    ['digMin', 8], ['digMax', 8], ['prefilter', 80], ['nSamples', 8], ['reserved', 32],
  ];
  const signals = Array.from({ length: nSignals }, () => ({}));
  let off = 256;
  for (const [name, len] of fields) {
    for (let i = 0; i < nSignals; i++) {
      const raw = ASCII(bytes, off, len).trim();
      off += len;
      if (['physMin', 'physMax', 'digMin', 'digMax'].includes(name)) signals[i][name] = parseFloat(raw);
      else if (name === 'nSamples') signals[i][name] = parseInt(raw, 10);
      else signals[i][name] = raw;
    }
  }

  const recordSize = signals.reduce((s, sig) => s + sig.nSamples, 0) * 2;
  const available = Math.floor((bytes.length - headerBytes) / recordSize);
  if (!Number.isFinite(nRecords) || nRecords < 0 || nRecords > available) nRecords = available;

  const view = new DataView(arrayBuffer);
  const out = [];
  for (let i = 0; i < nSignals; i++) {
    const sig = signals[i];
    sig.isAnnotation = /EDF Annotations/i.test(sig.label);
    sig.fs = sig.nSamples / recordDuration;
    sig.gain = (sig.physMax - sig.physMin) / (sig.digMax - sig.digMin);
    sig.offset = sig.physMax - sig.gain * sig.digMax;
    out.push(sig.isAnnotation ? null : new Float32Array(sig.nSamples * nRecords));
  }

  let pos = headerBytes;
  for (let r = 0; r < nRecords; r++) {
    for (let i = 0; i < nSignals; i++) {
      const sig = signals[i];
      const n = sig.nSamples;
      if (sig.isAnnotation) { pos += n * 2; continue; }
      const dst = out[i];
      const base = r * n;
      const g = sig.gain, o = sig.offset;
      for (let k = 0; k < n; k++) {
        dst[base + k] = view.getInt16(pos, true) * g + o;
        pos += 2;
      }
    }
  }

  // pick ECG channel: label containing ECG/EKG, else first ordinary signal
  let ecgIndex = signals.findIndex((s) => !s.isAnnotation && /ecg|ekg/i.test(s.label));
  if (ecgIndex < 0) ecgIndex = signals.findIndex((s) => !s.isAnnotation);
  if (ecgIndex < 0) throw new Error('EDF has no ordinary signal channel');

  const start = parseStart(startDate, startTime);
  return {
    header: {
      version, patient, recording, reserved, headerBytes, nRecords, recordDuration, nSignals,
      startTime: start,
      birthdate: parseBirthdate(patient),
      sex: parseSex(patient),
      signals: signals.map(({ label, transducer, unit, physMin, physMax, digMin, digMax, prefilter, nSamples, fs, isAnnotation }) =>
        ({ label, transducer, unit, physMin, physMax, digMin, digMax, prefilter, nSamples, fs, isAnnotation })),
    },
    signals: out,
    ecgIndex,
    ecg: out[ecgIndex],
    fs: signals[ecgIndex].fs,
    unit: signals[ecgIndex].unit,
    duration: nRecords * recordDuration,
  };
}

// Convert an ECG signal to microvolts if the unit says mV or V.
export function toMicrovolts(signal, unit) {
  const u = (unit || '').toLowerCase();
  let f = 1;
  if (u === 'mv') f = 1000;
  else if (u === 'v') f = 1e6;
  if (f === 1) return signal;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * f;
  return out;
}
