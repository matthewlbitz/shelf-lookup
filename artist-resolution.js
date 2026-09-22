'use strict';
const clean = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const lookupName = value => clean(value).replace(/\s+\(\d+\)$/, '');
const normalize = value => clean(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[’‘“”"']/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function fallbackSort(value) {
  const name = lookupName(value).replace(/["“”]/g, '');
  // Do not infer personhood, split collaborations, spell out numbers, or remove cast credits.
  const key = name.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(the|an|a)\s+/i, '').trim();
  return key || name || '[Unknown artist]';
}
function fallback(artist, method = 'deterministic', evidence = '') {
  const sort = fallbackSort(artist);
  return {sort_name: sort, artist_sort: sort, musicbrainz_id: null, musicbrainz_type: null,
    source: 'fallback', status: 'fallback', method, confidence: 0, evidence};
}
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS artist_sort_cache (
    artist TEXT PRIMARY KEY, sort_name TEXT, artist_sort TEXT, musicbrainz_id TEXT,
    musicbrainz_type TEXT, source TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  const cols = new Set(db.prepare('PRAGMA table_info(artist_sort_cache)').all().map(c=>c.name));
  for (const [name,type] of Object.entries({musicbrainz_type:'TEXT',method:'TEXT',confidence:'REAL',evidence:'TEXT'}))
    if (!cols.has(name)) db.exec(`ALTER TABLE artist_sort_cache ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS musicbrainz_response_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL)`);
}
function save(db, artist, result) {
  const fields = ['artist','sort_name','artist_sort','musicbrainz_id','musicbrainz_type','source','status','method','confidence','evidence','updated_at'];
  db.prepare(`INSERT INTO artist_sort_cache (${fields.join(',')}) VALUES (${fields.map(f=>'@'+f).join(',')})
    ON CONFLICT(artist) DO UPDATE SET ${fields.slice(1).map(f=>`${f}=excluded.${f}`).join(',')}`)
    .run({artist,...result,method:result.method || 'legacy-cache',confidence:result.confidence ?? 1,evidence:result.evidence || '',updated_at:new Date().toISOString()});
}
// Shared with the HTTP sorter: fill only blank rows, recording every fallback for review.
function fillLocal(db, table) {
  migrate(db);
  const t = quote(table);
  return db.transaction(() => {
    let updated = 0;
    for (const {artist} of db.prepare(`SELECT DISTINCT artist FROM ${t} WHERE artist_sort IS NULL OR TRIM(artist_sort)=''`).all()) {
      const cached = db.prepare('SELECT * FROM artist_sort_cache WHERE artist=?').get(artist ?? '');
      const existing = db.prepare(`SELECT DISTINCT artist_sort FROM ${t} WHERE artist IS ? AND TRIM(COALESCE(artist_sort,''))<>''`).all(artist);
      const result = cached && ['matched','fallback'].includes(cached.status) && clean(cached.artist_sort) ? cached :
        existing.length === 1 ? {...fallback(artist),sort_name:existing[0].artist_sort,artist_sort:existing[0].artist_sort,source:'existing',status:'matched',method:'existing-value',confidence:1} : fallback(artist);
      if (result !== cached) save(db, artist ?? '', result);
      updated += db.prepare(`UPDATE ${t} SET artist_sort=? WHERE artist IS ? AND (artist_sort IS NULL OR TRIM(artist_sort)='')`).run(result.artist_sort,artist).changes;
    }
    return updated;
  })();
}
module.exports = {clean,lookupName,normalize,fallbackSort,fallback,quote,migrate,save,fillLocal};
