/* Capture positions synchronously: network completion must never reorder CDs. */
(() => {
  const el = id => document.getElementById(id);
  const input = el('sortBarcodeInput');
  let scans = [], phase = 'scan', page = 0;
  let buckets = {}, bucketMode = true, activeBucket = null, suspended = null;
  let singleMode = false, singleScan = null;
  let handoffs = {}, sending = false;
  const storageKey = 'shelf-lookup-batch-v1';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) {
      ({ scans, phase, page, buckets, bucketMode, activeBucket, suspended } = saved);
      handoffs = saved.handoffs || {};
      singleMode = !!saved.singleMode && phase === 'scan' && !scans.length;
    }
  } catch (_) { /* Storage may be unavailable. */ }
  // Finish an already-started legacy shelf batch without changing its destinations.
  if (phase === 'scan' && !activeBucket) bucketMode = true;
  const column = scan => String(scan.album?.new_shelf || '').trim().match(/^(\d+)\s*[A-Za-z]+$/)?.[1];
  const routing = () => bucketMode && !activeBucket;
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ scans, phase, page, buckets, bucketMode, activeBucket, suspended, singleMode, handoffs })); }
    catch (_) { el('sortStatus').textContent = 'Unable to save this session. Keep this page open while sorting.'; }
  }
  const pending = () => scans.some(scan => scan.pending);
  if (Object.keys(handoffs).length) el('handoffStatus').textContent = 'A handoff needs confirmation. Keep its column stack separate and select Retry handoff.';

  function render() {
    save();
    const scanning = phase === 'scan';
    const transferPending = Object.keys(handoffs).length > 0;
    el('singleSortToggle').checked = singleMode;
    el('singleSortToggle').disabled = !scanning || scans.length > 0;
    el('scanStackHint').hidden = singleMode;
    el('sortInputLabel').textContent = singleMode ? 'Scan or enter a barcode' : 'Scan this stack';
    el('bucketList').hidden = singleMode;
    el('batchProgress').hidden = singleMode;
    el('bucketHint').hidden = singleMode || !bucketMode;
    el('pauseBatch').hidden = phase !== 'sort' || !routing();
    el('resumeBatch').hidden = phase !== 'paused';
    el('resumeBatch').disabled = transferPending;
    const list = el('bucketList');
    list.replaceChildren();
    Object.keys(buckets).filter(key => buckets[key].length).sort((a,b) => Number(a)-Number(b)).forEach(key => {
      const button = document.createElement('button');
      button.className = 'secondary';
      button.textContent = `Sort column ${key} · ${buckets[key].length} CDs`;
      button.disabled = transferPending || phase === 'sort' || !!activeBucket || pending();
      button.addEventListener('click', () => {
        if (Object.keys(handoffs).length || phase === 'sort' || activeBucket || pending()) return;
        suspended = { scans, phase, page };
        scans = buckets[key].slice(); activeBucket = key; page = 0; phase = 'sort';
        render(); el('nextBatch').focus();
      });
      list.append(button);
      const handoff = document.createElement('button');
      handoff.className = 'secondary';
      handoff.textContent = `${handoffs[key] ? 'Retry handoff' : 'Hand off column'} ${key}`;
      handoff.disabled = sending || phase === 'sort' || !!activeBucket || pending();
      handoff.addEventListener('click', () => sendBucket(key));
      list.append(handoff);
    });
    el('batchScanFields').hidden = !scanning;
    input.disabled = !scanning || transferPending;
    el('startBatch').hidden = singleMode || !scanning;
    el('startBatch').disabled = !scans.length || pending() || transferPending;
    el('removeBatchScan').hidden = singleMode || !scanning;
    el('removeBatchScan').disabled = !scans.length;
    el('previousBatch').hidden = phase !== 'sort' || bucketMode || !!activeBucket;
    el('previousBatch').disabled = page === 0;
    el('nextBatch').hidden = phase !== 'sort';
    const start = page * 10;
    el('nextBatch').textContent = start + 10 >= scans.length ? 'Finish stack (Enter)' : 'Next 10 (Enter)';
    el('batchProgress').textContent = scanning
      ? `${scans.length} CDs scanned${pending() ? ' · Looking up shelf locations…' : ''}`
      : phase === 'paused' ? 'Stack paused · Sort a column bucket below, or resume this stack.' : `${activeBucket ? `Column ${activeBucket} → shelves · ` : bucketMode ? 'Into column buckets · ' : ''}CDs ${start + 1}–${Math.min(start + 10, scans.length)} of ${scans.length} · Pick up from the top, follow rows downward`;
    const output = el('sortOutput');
    output.replaceChildren();
    output.className = singleMode ? 'sort-output' : '';
    if (singleMode) {
      const album = singleScan?.album;
      const values = [
        ['sort-label', singleScan?.pending ? 'Looking up…' : 'Place album on'],
        ['sort-artist', album?.artist || (singleScan?.error ? 'No match' : 'Scan a barcode')],
        ['sort-title', singleScan?.error || album?.title || 'Scan or type a barcode and press Enter.'],
        ['sort-shelf', singleScan?.pending ? '—' : album?.new_shelf || (album ? 'Set aside' : '—')]
      ];
      values.forEach(([className, text]) => {
        const node = document.createElement('div'); node.className = className; node.textContent = text; output.append(node);
      });
      return;
    }
    if (phase === 'paused') { output.textContent = 'Keep the remaining source stack in order.'; return; }
    if (scanning) {
      const last = scans.at(-1);
      output.textContent = last ? `Last scan: ${last.barcode} · ${last.pending ? 'Looking up…' : last.error || last.album.new_shelf || 'No shelf — set aside when sorting'}` : 'Scan all barcodes, then select Start sorting.';
      return;
    }
    const group = scans.slice().reverse().slice(start, start + 10);
    const counts = new Map();
    scans.forEach(scan => { const key = column(scan); if (key) counts.set(key, (counts.get(key) || 0) + 1); });
    const dominant = [...counts].find(([, count]) => count > scans.length / 2)?.[0];
    const destination = scan => (routing() ? column(scan) : scan.album?.new_shelf) || '';
    group.forEach((scan, i) => {
      const row = document.createElement('div');
      const label = destination(scan);
      const previousSame = i > 0 && !!label && destination(group[i - 1]) === label;
      const nextSame = i + 1 < group.length && !!label && destination(group[i + 1]) === label;
      row.className = 'batch-row' + (previousSame || nextSame ? ' batch-repeat' : '')
        + (previousSame ? ' repeat-continuation' : '') + (nextSame ? ' repeat-continues' : '');
      const exception = !routing() && dominant && column(scan) && column(scan) !== dominant;
      if (exception) row.className += ' batch-exception';
      const values = [String(start + i + 1), (routing() ? column(scan) : scan.album?.new_shelf) || 'Set aside',
        `${scan.barcode} · ${scan.error || [scan.album?.artist, scan.album?.title].filter(Boolean).join(' — ')}${!scan.error && !scan.album?.new_shelf ? ' · No shelf assigned' : ''}`];
      values.forEach((value, index) => {
        const cell = document.createElement('div');
        cell.className = ['', 'batch-shelf', 'batch-detail'][index];
        const parts = index === 1 && !routing() && dominant && !exception && String(value).match(/^(\d+)\s*([A-Za-z]+)$/);
        if (parts) {
          const number = document.createElement('span'); number.className = 'batch-column'; number.textContent = parts[1];
          const letter = document.createElement('strong'); letter.className = 'batch-letter'; letter.textContent = parts[2];
          cell.append(number); cell.append(letter);
        } else cell.textContent = value;
        row.append(cell);
      });
      output.append(row);
    });
  }
  async function sendBucket(key) {
    if (sending || phase === 'sort' || activeBucket || pending()) return;
    if (!handoffs[key]) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      handoffs[key] = { id, column: key, scans: buckets[key].slice() };
    }
    // Persist the retry identity before sending so a lost response cannot duplicate a stack.
    try {
      localStorage.setItem(storageKey, JSON.stringify({ scans, phase, page, buckets, bucketMode, activeBucket, suspended, singleMode, handoffs }));
    } catch (_) {
      el('handoffStatus').textContent = 'Browser storage is unavailable. Handoff was not sent.';
      return;
    }
    sending = true; render();
    try {
      const response = await fetch('/api/shared-stacks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(handoffs[key]) });
      if (!response.ok) throw new Error('Handoff failed. Keep the stack in order and retry.');
      const sent = handoffs[key];
      buckets[key].splice(0, sent.scans.length);
      delete handoffs[key];
      el('handoffStatus').textContent = `Column ${key} sent · Stack ${sent.id.slice(-6)}. Give your partner this stack without changing its order.`;
    } catch (error) {
      el('handoffStatus').textContent = `${error.message} Keep this column stack separate until the handoff succeeds.`;
    } finally { sending = false; render(); }
  }
  input.addEventListener('keydown' , async event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat || Object.keys(handoffs).length || phase !== 'scan') return;
    const barcode = input.value.trim();
    if (!barcode) return;
    if (!singleMode && scans.some(scan => scan.barcode === barcode)) {
      el('sortStatus').textContent = `Barcode ${barcode} is already in this stack — duplicate not added.`;
      input.value = ''; input.focus();
      return;
    }
    el('sortStatus').textContent = '';
    const scan = { barcode, pending: true };
    if (singleMode) singleScan = scan;
    else scans.push(scan);
    input.value = '';
    render();
    await lookup(scan);
  });
  async function lookup(scan) {
    try {
      const response = await fetch(`/lookup/${encodeURIComponent(scan.barcode)}`);
      if (!response.ok) throw new Error(response.status === 404 ? 'Barcode not found — set aside' : 'Lookup failed — set aside');
      scan.album = await response.json();
    } catch (error) { scan.error = error.message; }
    finally { scan.pending = false; render(); }
  }
  el('singleSortToggle').addEventListener('change', () => {
    if (phase !== 'scan' || scans.length) return;
    singleMode = el('singleSortToggle').checked;
    singleScan = null; input.value = ''; render(); input.focus();
  });
  el('removeBatchScan').addEventListener('click', () => {
    if (phase !== 'scan') return;
    scans.pop(); render(); input.focus();
  });
  el('startBatch').addEventListener('click', () => {
    if (Object.keys(handoffs).length || phase !== 'scan' || !scans.length || pending()) return;
    phase = 'sort'; page = 0; render(); el('nextBatch').focus();
  });
  function next(pause = false) {
    if (phase !== 'sort') return;
    const group = scans.slice().reverse().slice(page * 10, page * 10 + 10);
    if (activeBucket) buckets[activeBucket].splice(-group.length);
    else if (routing()) group.forEach(scan => {
      const key = column(scan);
      if (key) (buckets[key] ||= []).push(scan);
    });
    if ((page + 1) * 10 >= scans.length) {
      if (activeBucket) {
        ({ scans, page, phase } = suspended);
        activeBucket = null; suspended = null;
      } else { scans = []; page = 0; phase = 'scan'; bucketMode = true; }
    } else { page++; if (pause) phase = 'paused'; }
    render();
    (phase === 'scan' ? input : el(phase === 'paused' ? 'resumeBatch' : 'nextBatch')).focus();
  }
  el('nextBatch').addEventListener('click', () => next());
  el('pauseBatch').addEventListener('click', () => next(true));
  el('resumeBatch').addEventListener('click', () => {
    if (Object.keys(handoffs).length || phase !== 'paused') return;
    phase = 'sort'; render(); el('nextBatch').focus();
  });
  el('previousBatch').addEventListener('click', () => {
    if (phase === 'sort' && !bucketMode && !activeBucket) page = Math.max(0, page - 1);
    render();
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !el('sortPanel').classList.contains('active') || phase !== 'sort') return;
    if (event.target.closest('button, input, textarea, select') && event.target !== el('nextBatch')) return;
    event.preventDefault();
    if (!event.repeat) next();
  });
  render();
  scans.filter(scan => scan.pending).forEach(lookup);
})();
