/* ORP (optimal recognition point) and per-word timing. Pure functions, no DOM. */
(function (global) {
  'use strict';

  // Leading / trailing characters that are not part of the "word body".
  const LEAD_RE = /^[\s"'“”‘’(\[{«‹„–—-]+/u;
  const TRAIL_RE = /[\s"'“”‘’)\]}»›.,;:!?…–—-]+$/u;

  /**
   * Split a token into [lead, body, trail] so the ORP is computed on the letters only.
   */
  function splitToken(token) {
    const lead = (token.match(LEAD_RE) || [''])[0];
    let rest = token.slice(lead.length);
    const trail = (rest.match(TRAIL_RE) || [''])[0];
    rest = rest.slice(0, rest.length - trail.length);
    if (!rest) return ['', token, ''];
    return [lead, rest, trail];
  }

  /**
   * Spritz-like ORP index by body length: 1 -> 0, 2-5 -> 1, 6-9 -> 2, 10-13 -> 3, 14+ -> 4.
   * Returns the index within the full token.
   */
  function orpIndex(token) {
    const [lead, body] = splitToken(token);
    const chars = Array.from(body);
    const n = chars.length;
    let i;
    if (n <= 1) i = 0;
    else if (n <= 5) i = 1;
    else if (n <= 9) i = 2;
    else if (n <= 13) i = 3;
    else i = 4;
    // Convert code-point index back to a string index (handles astral chars).
    return Array.from(lead).join('').length + chars.slice(0, i).join('').length;
  }

  /**
   * Split token into the three display parts around the ORP character.
   */
  function orpParts(token) {
    const chars = Array.from(token);
    const idx = orpIndex(token);
    // Map string index to code-point index.
    let cp = 0, s = 0;
    while (cp < chars.length && s < idx) { s += chars[cp].length; cp++; }
    return {
      before: chars.slice(0, cp).join(''),
      orp: chars[cp] || '',
      after: chars.slice(cp + 1).join(''),
    };
  }

  /**
   * Display time for a token in ms at the given WPM.
   * @param {{text:string, paraEnd?:boolean}} tok
   * @param {number} wpm
   */
  function wordDelay(tok, wpm) {
    const base = 60000 / Math.max(1, wpm);
    const text = tok.text;
    const [, body] = splitToken(text);
    let mult = 1;
    if (Array.from(body).length > 8) mult *= 1.3;
    if (tok.paraEnd) mult *= 2.5;
    else if (/[.!?…]["'”’)\]]*$/u.test(text)) mult *= 2.0;
    else if (/[,;:]["'”’)\]]*$/u.test(text)) mult *= 1.5;
    return base * mult;
  }

  global.ORP = { splitToken, orpIndex, orpParts, wordDelay };
})(window);
