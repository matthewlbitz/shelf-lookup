// Shared by the page and server so barcode stepping follows the same rules.
(function (root) {
  function numericBarcode(code) {
    if (typeof code !== 'string' || !/^\d{1,30}$/.test(code)) {
      throw new Error('Ordered searching requires numeric barcodes.');
    }
    return BigInt(code);
  }
  function barcodeStep(first, last) {
    const a = numericBarcode(first), b = numericBarcode(last);
    if (a === b) throw new Error('The last barcode must differ from the first.');
    return b > a ? 1n : -1n;
  }
  function formatBarcode(value, first) {
    return first.startsWith('0') ? String(value).padStart(first.length, '0') : String(value);
  }
  function range(first, last) {
    const a = numericBarcode(first), b = numericBarcode(last);
    const step = b >= a ? 1n : -1n;
    const codes = [];
    for (let value = a; ; value += step) {
      codes.push(formatBarcode(value, first));
      if (value === b) return codes;
    }
  }
  function advance(ordered, barcode) {
    if (ordered.stage !== 'assign' || barcode !== ordered.current) {
      throw new Error('Scan both endpoints, then assign the current ordered barcode.');
    }
    const complete = numericBarcode(barcode) === numericBarcode(ordered.last);
    return { ...ordered, stage: complete ? 'complete' : 'assign',
      current: complete ? null : formatBarcode(numericBarcode(barcode) + barcodeStep(ordered.first, ordered.last), ordered.first) };
  }
  function suggestAlbums(albums, firstBarcode, lastBarcode, barcode) {
    const step = barcodeStep(firstBarcode, lastBarcode);
    const firstNumber = numericBarcode(firstBarcode), current = numericBarcode(barcode);
    const progress = (current - firstNumber) * step;
    const length = (numericBarcode(lastBarcode) - firstNumber) * step;
    if (progress <= 0n || progress >= length) return { albums: [], reason: 'The endpoint CDs are already assigned. Choose an interior barcode.' };
    const first = albums.find(a => a.barcode === firstBarcode);
    const last = albums.find(a => a.barcode === lastBarcode);
    if (!first || !last) throw new Error('Assign both the first and last CDs before using ordered suggestions.');
    const direction = Math.sign(last.id - first.id);
    if (!direction) throw new Error('The endpoints must be different albums.');
    // Only assignments BEFORE this CD in physical traversal can be an anchor.
    // The last CD was assigned early and must not pull predictions toward itself.
    let anchor = first, anchorProgress = 0n;
    for (const album of albums) {
      if (!/^\d{1,30}$/.test(album.barcode || '')) continue;
      const position = (BigInt(album.barcode) - firstNumber) * step;
      if (position >= anchorProgress && position < progress) { anchor = album; anchorProgress = position; }
    }
    const unassigned = albums.filter(a => !String(a.barcode || '').trim() && Number.isSafeInteger(a.id));
    const nearby = (sign, count) => unassigned.filter(a => (a.id - anchor.id) * sign > 0)
      .sort((a,b) => Math.abs(a.id - anchor.id) - Math.abs(b.id - anchor.id)).slice(0,count);
    const suggestions = [...nearby(direction,8), ...nearby(-direction,4)];
    return { albums: suggestions, direction, anchor,
      reason: `Barcode ${barcode}: next unassigned IDs ${direction > 0 ? 'above' : 'below'} ${anchor.id}, followed by nearby alternatives. Arrow keys choose; Enter assigns.` };
  }
  const api = { numericBarcode, barcodeStep, range, advance, suggestAlbums };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrderedSearch = api;
})(typeof window !== 'undefined' ? window : this);
