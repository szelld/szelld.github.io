// Signal processing helpers: IIR Butterworth filters (zero-phase), statistics,
// cubic spline resampling, FFT and Welch PSD, min/max decimation for plotting.

// ---------- statistics ----------
export function mean(x) {
  let s = 0;
  const n = x.length;
  if (!n) return NaN;
  for (let i = 0; i < n; i++) s += x[i];
  return s / n;
}
export function std(x, ddof = 1) {
  const n = x.length;
  if (n <= ddof) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) { const d = x[i] - m; s += d * d; }
  return Math.sqrt(s / (n - ddof));
}
export function rms(x) {
  const n = x.length;
  if (!n) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}
export function sorted(x) {
  const a = Array.from(x);
  a.sort((p, q) => p - q);
  return a;
}
export function quantileSorted(s, q) {
  const n = s.length;
  if (!n) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export function median(x) { return quantileSorted(sorted(x), 0.5); }
export function quantile(x, q) { return quantileSorted(sorted(x), q); }
export function min(x) { let m = Infinity; for (let i = 0; i < x.length; i++) if (x[i] < m) m = x[i]; return m; }
export function max(x) { let m = -Infinity; for (let i = 0; i < x.length; i++) if (x[i] > m) m = x[i]; return m; }
export function argmax(x, from = 0, to = x.length) {
  let m = -Infinity, idx = from;
  for (let i = from; i < to; i++) if (x[i] > m) { m = x[i]; idx = i; }
  return idx;
}
export function argmin(x, from = 0, to = x.length) {
  let m = Infinity, idx = from;
  for (let i = from; i < to; i++) if (x[i] < m) { m = x[i]; idx = i; }
  return idx;
}
export function diff(x) {
  const out = new Float64Array(Math.max(0, x.length - 1));
  for (let i = 0; i < out.length; i++) out[i] = x[i + 1] - x[i];
  return out;
}
export function movingAverage(x, w) {
  const n = x.length, out = new Float32Array(n);
  const half = Math.floor(w / 2);
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + w - half);
    out[i] = (cs[b] - cs[a]) / (b - a);
  }
  return out;
}
export function linearDetrend(x) {
  const n = x.length, out = new Float64Array(n);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const den = n * sxx - sx * sx;
  const b = den ? (n * sxy - sx * sy) / den : 0;
  const a = (sy - b * sx) / n;
  for (let i = 0; i < n; i++) out[i] = x[i] - (a + b * i);
  return out;
}

// ---------- Butterworth IIR (cascaded biquads, zero-phase via filtfilt) ----------
function biquadCoeffs(type, fc, fs, Q) {
  const w0 = 2 * Math.PI * fc / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  let b0, b1, b2;
  if (type === 'low') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
  else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function butterSections(type, fc, fs, order) {
  const sections = [];
  const nPairs = Math.floor(order / 2);
  for (let k = 0; k < nPairs; k++) {
    const phi = Math.PI * (2 * k + 1) / (2 * order);
    const Q = 1 / (2 * Math.cos(phi));
    sections.push(biquadCoeffs(type, fc, fs, Q));
  }
  if (order % 2 === 1) {
    // first-order section
    const w = Math.tan(Math.PI * fc / fs);
    if (type === 'low') {
      const a0 = 1 + w;
      sections.push([w / a0, w / a0, 0, (w - 1) / a0, 0]);
    } else {
      const a0 = 1 + w;
      sections.push([1 / a0, -1 / a0, 0, (w - 1) / a0, 0]);
    }
  }
  return sections;
}
function applyBiquad(x, c, out) {
  const [b0, b1, b2, a1, a2] = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
function reverseInPlace(a) {
  for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]; a[i] = a[j]; a[j] = t; }
}
function filtfiltSections(x, sections, padlen) {
  const n = x.length;
  const p = Math.min(padlen, n - 1);
  const ext = new Float64Array(n + 2 * p);
  for (let i = 0; i < p; i++) ext[i] = 2 * x[0] - x[p - i];
  for (let i = 0; i < n; i++) ext[p + i] = x[i];
  for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  let buf = ext, tmp = new Float64Array(ext.length);
  for (const c of sections) {
    applyBiquad(buf, c, tmp); reverseInPlace(tmp);
    applyBiquad(tmp, c, buf); reverseInPlace(buf);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[p + i];
  return out;
}
export function lowpass(x, fs, fc, order = 4) {
  return filtfiltSections(x, butterSections('low', fc, fs, order), Math.round(3 * fs));
}
export function highpass(x, fs, fc, order = 2) {
  return filtfiltSections(x, butterSections('high', fc, fs, order), Math.round(Math.min(10 * fs, 3 * fs / fc)));
}
export function bandpass(x, fs, lo, hi, order = 2) {
  const sections = butterSections('high', lo, fs, order).concat(butterSections('low', hi, fs, order));
  return filtfiltSections(x, sections, Math.round(Math.min(10 * fs, 3 * fs / lo)));
}

// ---------- cubic spline interpolation / resampling ----------
export function cubicSpline(xs, ys) {
  const n = xs.length;
  if (n < 3) {
    return (x) => {
      if (n === 0) return NaN;
      if (n === 1) return ys[0];
      const t = (x - xs[0]) / (xs[1] - xs[0]);
      return ys[0] + t * (ys[1] - ys[0]);
    };
  }
  const h = new Float64Array(n - 1), alpha = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
  for (let i = 1; i < n - 1; i++) alpha[i] = 3 / h[i] * (ys[i + 1] - ys[i]) - 3 / h[i - 1] * (ys[i] - ys[i - 1]);
  const l = new Float64Array(n), mu = new Float64Array(n), z = new Float64Array(n);
  l[0] = 1;
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }
  l[n - 1] = 1;
  const c = new Float64Array(n), b = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  return (x) => {
    let lo = 0, hi = n - 2;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid - 1; }
    const dx = x - xs[lo];
    return ys[lo] + b[lo] * dx + c[lo] * dx * dx + d[lo] * dx * dx * dx;
  };
}
// Resample irregular series (t, v) onto uniform grid at fs Hz.
export function resampleUniform(t, v, fs, method = 'spline') {
  if (t.length < 2) return { t: new Float64Array(0), v: new Float64Array(0), fs };
  const t0 = t[0], t1 = t[t.length - 1];
  const n = Math.floor((t1 - t0) * fs) + 1;
  const tt = new Float64Array(n), vv = new Float64Array(n);
  if (method === 'spline' && t.length >= 4) {
    const f = cubicSpline(t, v);
    for (let i = 0; i < n; i++) { tt[i] = t0 + i / fs; vv[i] = f(tt[i]); }
  } else {
    let j = 0;
    for (let i = 0; i < n; i++) {
      const x = t0 + i / fs;
      while (j < t.length - 2 && t[j + 1] < x) j++;
      const w = (x - t[j]) / (t[j + 1] - t[j]);
      tt[i] = x; vv[i] = v[j] + w * (v[j + 1] - v[j]);
    }
  }
  return { t: tt, v: vv, fs };
}

// ---------- FFT / Welch ----------
export function fft(re, im) {
  const n = re.length;
  if (n & (n - 1)) throw new Error('FFT size must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
export function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return w;
}
// Welch PSD, one-sided, units^2/Hz. x uniform at fs.
export function welch(x, fs, nperseg, noverlap = null, nfft = null) {
  const n = x.length;
  nperseg = Math.min(nperseg, n);
  if (nperseg < 8) return { f: new Float64Array(0), p: new Float64Array(0) };
  if (noverlap === null) noverlap = Math.floor(nperseg / 2);
  nfft = nfft || nextPow2(nperseg);
  const step = nperseg - noverlap;
  const w = hann(nperseg);
  let wsum = 0; for (let i = 0; i < nperseg; i++) wsum += w[i] * w[i];
  const half = nfft / 2 + 1;
  const acc = new Float64Array(half);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let segs = 0;
  for (let s = 0; s + nperseg <= n; s += step) {
    re.fill(0); im.fill(0);
    let m = 0; for (let i = 0; i < nperseg; i++) m += x[s + i]; m /= nperseg;
    for (let i = 0; i < nperseg; i++) re[i] = (x[s + i] - m) * w[i];
    fft(re, im);
    for (let k = 0; k < half; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    segs++;
  }
  const f = new Float64Array(half), p = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    f[k] = k * fs / nfft;
    let v = acc[k] / (segs * fs * wsum);
    if (k > 0 && k < half - 1) v *= 2;
    p[k] = v;
  }
  return { f, p };
}
export function bandPower(f, p, lo, hi) {
  let s = 0;
  for (let k = 1; k < f.length; k++) {
    if (f[k] >= lo && f[k] < hi) s += p[k] * (f[k] - f[k - 1]);
  }
  return s;
}
export function bandPeak(f, p, lo, hi) {
  let best = -1, bf = NaN;
  for (let k = 0; k < f.length; k++) if (f[k] >= lo && f[k] < hi && p[k] > best) { best = p[k]; bf = f[k]; }
  return bf;
}

// ---------- decimation for plotting ----------
// Returns {idx, val} arrays with at most ~2*buckets points, preserving min/max of each bucket.
export function minMaxDecimate(x, start, end, buckets) {
  start = Math.max(0, start); end = Math.min(x.length, end);
  const n = end - start;
  if (n <= buckets * 2) {
    const idx = new Float64Array(n), val = new Float32Array(n);
    for (let i = 0; i < n; i++) { idx[i] = start + i; val[i] = x[start + i]; }
    return { idx, val };
  }
  const size = n / buckets;
  const idx = [], val = [];
  for (let b = 0; b < buckets; b++) {
    const a = start + Math.floor(b * size), e = Math.min(end, start + Math.floor((b + 1) * size));
    if (e <= a) continue;
    let mi = a, ma = a;
    for (let i = a; i < e; i++) { if (x[i] < x[mi]) mi = i; if (x[i] > x[ma]) ma = i; }
    if (mi < ma) { idx.push(mi, ma); val.push(x[mi], x[ma]); }
    else if (mi > ma) { idx.push(ma, mi); val.push(x[ma], x[mi]); }
    else { idx.push(mi); val.push(x[mi]); }
  }
  return { idx: Float64Array.from(idx), val: Float32Array.from(val) };
}
