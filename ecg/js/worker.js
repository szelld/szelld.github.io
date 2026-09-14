// Web Worker: runs the analysis pipeline off the main thread.
import { analyze } from './pipeline.js';

self.onmessage = (e) => {
  const { id, ecg, fs, physMax, settings } = e.data;
  try {
    const result = analyze(ecg, fs, {
      physMax, settings,
      onProgress: (stage, pct) => self.postMessage({ id, type: 'progress', stage, pct }),
    });
    const transfer = [result.clean.buffer, ecg.buffer];
    for (const v of Object.values(result.beats)) if (v && v.buffer && !transfer.includes(v.buffer)) transfer.push(v.buffer);
    for (const v of Object.values(result.nn)) if (v && v.buffer && !transfer.includes(v.buffer)) transfer.push(v.buffer);
    self.postMessage({ id, type: 'result', result, ecg }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err && err.message ? err.message : String(err), stack: err && err.stack });
  }
};
