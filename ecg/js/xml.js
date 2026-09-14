// Parser for the annotation XML that ships next to the EDF in a Polar ECG
// Analysis export. The annotations the user created by pressing the button in
// the app carry description "Event"; the rest are the vendor's own summary
// notes (minimum HR, highest 1-minute mean HR and so on).

const text = (node, tag) => {
  const el = node.getElementsByTagName(tag)[0];
  return el ? (el.textContent || '').trim() : '';
};

function stripHtml(s) {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} xmlText
 * @returns {{ events: Array<{t:number, note:string, wellbeing:number|null}>,
 *             vendorNotes: Array<{t:number, note:string, description:string}> }}
 */
export function parseAnnotations(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid annotation XML');
  const events = [], vendorNotes = [];
  for (const node of doc.getElementsByTagName('annotation')) {
    const ms = parseFloat(text(node, 'onsetmilisecond'));
    if (!Number.isFinite(ms)) continue;
    const t = ms / 1000;
    const description = text(node, 'description');
    const note = stripHtml(text(node, 'note'));
    if (/^event$/i.test(description)) {
      const wb = parseFloat(text(node, 'wellbeinglevel'));
      events.push({ t, note, wellbeing: Number.isFinite(wb) && wb >= 0 ? wb : null });
    } else {
      vendorNotes.push({ t, note, description });
    }
  }
  events.sort((a, b) => a.t - b.t);
  vendorNotes.sort((a, b) => a.t - b.t);
  return { events, vendorNotes };
}
