/* Text extraction (PDF via pdf.js) and tokenisation. */
(function (global) {
  'use strict';

  const PDFJS_VERSION = '3.11.174';
  const MAX_TOKEN = 16;   // tokens longer than this get split
  const CHUNK = 12;       // ... into chunks of at most this many chars

  function configurePdfJs() {
    const lib = global.pdfjsLib;
    if (!lib) throw new Error('pdf.js failed to load (check your network connection).');
    lib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    return lib;
  }

  /**
   * Convert the text items of one page into plain text with line / paragraph breaks
   * inferred from item geometry.
   */
  function pageItemsToText(items) {
    let out = '';
    let lastX = null, lastY = null, lastH = 0;
    for (const it of items) {
      if (typeof it.str !== 'string') continue;
      const [a, b, , d, x, y] = it.transform || [1, 0, 0, 1, 0, 0];
      const h = Math.max(Math.abs(d), Math.abs(b), 1) || 1;
      if (lastY !== null) {
        const dy = Math.abs(y - lastY);
        if (dy > h * 0.5) {
          // new line; large gap -> paragraph (merge with a newline already emitted via hasEOL)
          if (dy > Math.max(h, lastH) * 1.8) out = out.replace(/\n*$/, '\n\n');
          else if (!out.endsWith('\n')) out += '\n';
        } else if (lastX !== null && x - lastX > h * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) {
          out += ' ';
        }
      }
      out += it.str;
      if (it.hasEOL) out += '\n';
      lastX = x + (it.width || 0) * Math.abs(a || 1);
      lastY = y;
      lastH = h;
    }
    return out;
  }

  /**
   * Extract text from a PDF File/Blob.
   * @param {File} file
   * @param {(done:number,total:number)=>void} [onProgress]
   * @returns {Promise<string>}
   */
  async function extractPdfText(file, onProgress) {
    const lib = configurePdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data }).promise;
    const total = doc.numPages;
    const pages = [];
    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(pageItemsToText(content.items));
      page.cleanup();
      if (onProgress) onProgress(p, total);
    }
    doc.destroy();
    return pages.join('\n\n');
  }

  /** Normalise raw text: fix hyphenation, whitespace, keep paragraph breaks. */
  function normalizeText(raw) {
    return raw
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00AD]/g, '')                              // soft hyphens
      .replace(/(\p{L})[-\u2010\u2011]\n[ \t]*(\p{Ll})/gu, '$1$2') // infor-\nmation -> information
      .replace(/[ \t\f\v\u00A0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function splitLong(word) {
    if (Array.from(word).length <= MAX_TOKEN) return [word];
    const chars = Array.from(word);
    const parts = [];
    for (let i = 0; i < chars.length; i += CHUNK) {
      const piece = chars.slice(i, i + CHUNK).join('');
      parts.push(i + CHUNK < chars.length ? piece + '-' : piece);
    }
    return parts;
  }

  /**
   * Text -> tokens: [{text, paraEnd}]
   */
  function tokenize(raw) {
    const text = normalizeText(raw);
    const tokens = [];
    const paragraphs = text.split(/\n\s*\n/);
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const start = tokens.length;
      for (const w of words) for (const piece of splitLong(w)) tokens.push({ text: piece, paraEnd: false });
      if (tokens.length > start) tokens[tokens.length - 1].paraEnd = true;
    }
    return tokens;
  }

  global.Extract = { extractPdfText, tokenize, normalizeText };
})(window);
