(() => {
  const el = id => document.getElementById(id);
  let owner, active = null, busy = false;
  try {
    owner = localStorage.getItem('shelf-receiver-id');
    if (!owner) {
      owner = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('shelf-receiver-id', owner);
    }
  } catch (_) { el('status').textContent = 'Enable browser storage to receive stacks and recover progress.'; return; }
  async function request(url, body) {
    const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not reach the host. Keep the stack in order and retry.');
    }
    return response.json();
  }
  function draw() {
    el('work').hidden = !active;
    el('stacks').hidden = !!active;
    if (!active) return;
    el('heading').textContent = `Column ${active.column} · Stack ${active.id.slice(-6)}`;
    el('progress').textContent = `${active.position} of ${active.count} CDs placed · Follow rows downward`;
    el('rows').replaceChildren();
    const group = active.scans.slice(active.position, active.position + 10);
    const destination = scan => String(scan.album?.new_shelf || '').trim().toUpperCase();
    group.forEach((scan, i) => {
      const row = document.createElement('div');
      const label = destination(scan);
      const previousSame = i > 0 && !!label && destination(group[i - 1]) === label;
      const nextSame = i + 1 < group.length && !!label && destination(group[i + 1]) === label;
      row.className = (previousSame || nextSame ? 'batch-repeat' : '')
        + (previousSame ? ' repeat-continuation' : '') + (nextSame ? ' repeat-continues' : '');
      const number = document.createElement('span'); number.textContent = active.position + i + 1;
      const shelf = document.createElement('strong'); shelf.textContent = scan.album?.new_shelf || 'Set aside';
      const detail = document.createElement('span'); detail.textContent = [scan.album?.artist, scan.album?.title].filter(Boolean).join(' — ');
      const barcode = document.createElement('small'); barcode.textContent = scan.barcode;
      detail.append(barcode); row.append(number, shelf, detail); el('rows').append(row);
    });
    el('next').textContent = active.position + 10 >= active.count ? 'Group placed — Finish stack (Enter)' : 'Group placed — Next 10 (Enter)';
    el('next').disabled = busy;
    el('back').disabled = busy;
  }
  async function refresh() {
    if (active || busy) return;
    busy = true;
    try {
      const stacks = await request('/api/shared-stacks');
      el('stacks').replaceChildren();
      el('status').textContent = stacks.length ? 'Choose a stack to start or resume. Claimed stacks stay with their receiving browser.' : 'Waiting for a column stack to be handed off…';
      stacks.forEach(stack => {
        const button = document.createElement('button');
        button.textContent = `Column ${stack.column} · Stack ${stack.id.slice(-6)} · ${stack.count - stack.position} CDs${stack.claimed ? ' · Resume' : ''}`;
        button.addEventListener('click', async () => {
          if (busy) return;
          busy = true; button.disabled = true;
          try {
            active = await request(`/api/shared-stacks/${stack.id}/claim`, { owner });
            if (active.position >= active.count) { active = null; throw new Error('This stack is already finished.'); }
            el('status').textContent = 'Place the displayed CDs, then confirm the group.';
          } catch (error) { el('status').textContent = error.message; }
          finally { busy = false; button.disabled = false; draw(); if (active) el('next').focus(); }
        });
        el('stacks').append(button);
      });
    } catch (error) { el('status').textContent = `Connection unavailable. ${error.message}`; }
    finally { busy = false; }
  }
  async function next() {
    if (!active || busy) return;
    busy = true; draw();
    try {
      const result = await request(`/api/shared-stacks/${active.id}/progress`, {
        owner, from: active.position, position: Math.min(active.position + 10, active.count)
      });
      active.position = result.position;
      if (active.position === active.count) { active = null; el('status').textContent = 'Stack finished.'; }
      else el('status').textContent = 'Progress saved. Place the next group.';
    } catch (error) { el('status').textContent = `${error.message} If you already placed this group, retry the button without placing it again.`; }
    finally { busy = false; draw(); if (!active) refresh(); }
  }
  el('next').addEventListener('click', next);
  el('back').addEventListener('click', () => { if (busy) return; active = null; draw(); refresh(); });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.repeat || !active || (event.target.closest('button,a,input') && event.target !== el('next'))) return;
    event.preventDefault(); next();
  });
  refresh(); setInterval(refresh, 3000);
})();
