function normalizeSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(word => word && !['the', 'a', 'an'].includes(word)).join(' ');
}
function normalizeExternal(value) {
  const digits = String(value || '').replace(/[\s-]/g, '');
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits.padStart(14, '0') : null;
}
function migrateExternal(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS album_external_barcodes (
    album_id INTEGER NOT NULL, code TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'import',
    PRIMARY KEY (album_id, code));
    CREATE INDEX IF NOT EXISTS idx_external_code ON album_external_barcodes(code)`);
}
module.exports = { normalizeSearch, normalizeExternal, migrateExternal };
