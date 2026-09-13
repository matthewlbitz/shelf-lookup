function installSharedStacks(app, db, columnInbox = false) {
  const table = columnInbox ? "shared_column_stacks" : "shared_sort_stacks";
  const route = columnInbox ? "/api/column-stacks" : "/api/shared-stacks";
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY, column_label TEXT NOT NULL, scans TEXT NOT NULL,
    owner TEXT, position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const get = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
  const view = row => ({ id: row.id, column: row.column_label,
    count: JSON.parse(row.scans).length, position: row.position,
    claimed: !!row.owner, createdAt: row.created_at });
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
  app.get(route, (_req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY created_at, id`).all()
      .map(view).filter(row => row.position < row.count));
  });
  app.post(route, (req, res) => {
    const { id, scans } = req.body || {};
    const column = columnInbox ? "mixed" : req.body?.column;
    if (!validId(id) || (!columnInbox && !/^\d+$/.test(String(column))) || !Array.isArray(scans) ||
      !scans.length || scans.length > 10000 || scans.some(s => !s || typeof s.barcode !== 'string' ||
        !s.album || (!columnInbox && (typeof s.album.new_shelf !== 'string' ||
        s.album.new_shelf.trim().match(/^(\d+)\s*[A-Za-z]+$/)?.[1] !== String(column))))) {
      return res.status(400).json({ error: 'Invalid column stack.' });
    }
    const serialized = JSON.stringify(scans);
    const existing = get.get(id);
    if (existing && (existing.scans !== serialized || existing.column_label !== String(column))) {
      return res.status(409).json({ error: 'This handoff ID already belongs to another stack.' });
    }
    if (!existing) db.prepare(`INSERT INTO ${table} (id, column_label, scans) VALUES (?, ?, ?)`)
      .run(id, String(column), serialized);
    res.json(view(get.get(id)));
  });
  app.post(`${route}/:id/claim`, (req, res) => {
    const { owner } = req.body || {};
    if (!validId(owner)) return res.status(400).json({ error: 'Invalid browser identity.' });
    db.prepare(`UPDATE ${table} SET owner = ? WHERE id = ? AND (owner IS NULL OR owner = ?)`)
      .run(owner, req.params.id, owner);
    const row = get.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Stack not found.' });
    if (row.owner !== owner) return res.status(409).json({ error: 'This stack is already being sorted on another browser.' });
    res.json({ ...view(row), scans: JSON.parse(row.scans).reverse() });
  });
  app.post(`${route}/:id/progress`, (req, res) => {
    const { owner, from, position } = req.body || {};
    const row = get.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Stack not found.' });
    if (!validId(owner) || row.owner !== owner) return res.status(409).json({ error: 'Claim this stack first.' });
    const count = JSON.parse(row.scans).length;
    if (!Number.isInteger(from) || from < 0 || from >= count || position !== (columnInbox ? count : Math.min(from + 10, count)))
      return res.status(400).json({ error: 'Invalid progress.' });
    if (row.position !== from && row.position !== position)
      return res.status(409).json({ error: 'Progress changed. Reopen the stack to continue.' });
    db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).run(position, row.id);
    res.json(view(get.get(row.id)));
  });
}
module.exports = { installSharedStacks };
