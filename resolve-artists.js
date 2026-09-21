#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { parseArgs } = require('node:util');
const CACHE_SQL = `CREATE TABLE IF NOT EXISTS artist_sort_cache (
 artist TEXT PRIMARY KEY, sort_name TEXT, artist_sort TEXT, musicbrainz_id TEXT, musicbrainz_type TEXT,
 source TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`;
const normalize = s => String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const lookupName = s => s.trim().replace(/\s+\(\d+\)$/, '');
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Trust only reversible surname/article rearrangements or unchanged group names.
function deriveKey(name, candidate) {
 const sort = String(candidate['sort-name'] || '').trim();
 const parts = sort.split(',').map(s => s.trim());
 let key;
 if (candidate.type === 'Person' && parts.length === 2 && parts.every(Boolean) &&
     normalize(parts[1] + ' ' + parts[0]) === normalize(name)) key = parts[0];
 if (candidate.type === 'Group') {
   if (normalize(sort) === normalize(name)) key = sort;
   if (parts.length === 2 && parts[0] && /^(the|a|an)$/i.test(parts[1]) &&
       normalize(parts[1] + ' ' + parts[0]) === normalize(name)) key = parts[0];
 }
 return key && !/^(the|a|an)$/i.test(key) && /[\p{L}\p{N}]/u.test(key) ? key : null;
}
function classify(artist, data) {
 if (!Array.isArray(data.artists) || !Number.isInteger(data.count) || data.count < data.artists.length ||
     (data.count > 0 && !data.artists.length)) throw new Error('Malformed MusicBrainz response');
 const candidates = [...data.artists].sort((a,b) => Number(b.score) - Number(a.score));
 const top = candidates[0];
 const result = { sort_name: top?.['sort-name'] || null, artist_sort: null,
   musicbrainz_id: top?.id || null, musicbrainz_type: top?.type || null, source: 'musicbrainz', status: top ? 'review' : 'not_found' };
 const name = lookupName(artist);
 // Numeric Discogs IDs cannot establish which MusicBrainz namesake is intended.
 const confident = top && name === artist.trim() && Number(top.score) === 100 &&
   /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(top.id || '') &&
   normalize(top.name) === normalize(name) && data.count <= candidates.length &&
   candidates.slice(1).every(c => Number.isFinite(Number(c.score)) && Number(c.score) <= 85 && normalize(c.name) !== normalize(name));
 if (confident) {
   result.artist_sort = deriveKey(name, top);
   if (result.artist_sort) result.status = 'matched';
 }
 return result;
}
function createLookup({ fetchImpl = fetch, wait = sleep, now = Date.now,
 userAgent = 'shelf-lookup/1.0 (https://github.com/matthewlbitz/shelf-lookup)' } = {}) {
 let last = -Infinity;
 return async artist => {
   const escaped = lookupName(artist).replace(/([+\-!(){}\[\]^"~*?:\\/]|&|\|)/g, '\\$1');
   const url = new URL('https://musicbrainz.org/ws/2/artist/');
   url.search = new URLSearchParams({ query: `artist:"${escaped}"`, fmt: 'json', limit: '100' });
   for (let attempt = 0; attempt < 4; attempt++) {
     await wait(Math.max(0, 1100 - (now() - last)));
     last = now();
     const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
     if (response.ok) return response.json();
     if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3)
       throw new Error(`MusicBrainz HTTP ${response.status}`);
     const retry = response.headers.get('retry-after');
     const delay = retry ? (/^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-now()) : 0;
     await wait(Math.max(2000 * 2 ** attempt, Number.isFinite(delay) ? delay : 0));
   }
 };
}
async function run({ dbPath, limit = 10, apply = false, artist, lookup = createLookup(), log = console.log }) {
 const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
 try {
   const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
   const table = (tables.includes('AllAlbumShelfs') ? ['AllAlbumShelfs'] : tables).find(t => {
     const cols = db.prepare(`PRAGMA table_info(${quote(t)})`).all().map(c => c.name);
     return ['artist','title','artist_sort'].every(c => cols.includes(c)) && (cols.includes('id') || cols.includes('index'));
   });
   if (!table) throw new Error('No compatible album table with artist_sort found; run the app migration first.');
   const t = quote(table);
   const blank = "(artist_sort IS NULL OR TRIM(artist_sort) = '')";
   const unresolved = db.prepare(`SELECT DISTINCT artist FROM ${t} WHERE ${blank} AND artist IS NOT NULL AND TRIM(artist) <> '' ORDER BY artist`).all();
   const cached = new Set(tables.includes('artist_sort_cache') ? db.prepare('SELECT artist FROM artist_sort_cache').all().map(r => r.artist) : []);
   const pending = unresolved.filter(r => !cached.has(r.artist) && (!artist || artist === r.artist));
   const batch = pending.slice(0, limit);
   log(`${apply ? 'APPLY' : 'DRY RUN (no database writes)'}: ${unresolved.length} unresolved; ${unresolved.filter(r => cached.has(r.artist)).length} cached; ${pending.length} eligible; ${batch.length} this batch.`);
   if (apply) db.transaction(() => {
     db.exec(CACHE_SQL);
     if (!db.prepare('PRAGMA table_info(artist_sort_cache)').all().some(c => c.name === 'musicbrainz_type'))
       db.exec('ALTER TABLE artist_sort_cache ADD COLUMN musicbrainz_type TEXT');
   })();
   const persist = apply ? db.transaction((name, result) => {
     // A second runner may have completed it while this request was in flight.
     if (db.prepare('SELECT 1 FROM artist_sort_cache WHERE artist=?').get(name)) return 0;
     const existing = db.prepare(`SELECT DISTINCT artist_sort FROM ${t} WHERE artist=? AND NOT ${blank}`).all(name);
     if (existing.some(r => normalize(r.artist_sort) !== normalize(result.artist_sort))) {
       result.status = 'review'; result.artist_sort = null;
     }
     db.prepare(`INSERT INTO artist_sort_cache (artist,sort_name,artist_sort,musicbrainz_id,musicbrainz_type,source,status,updated_at) VALUES (@artist,@sort_name,@artist_sort,@musicbrainz_id,@musicbrainz_type,@source,@status,@updated_at)`).run({ artist: name, ...result, updated_at: new Date().toISOString() });
     return result.status === 'matched' ? db.prepare(`UPDATE ${t} SET artist_sort=? WHERE artist=? AND ${blank}`).run(result.artist_sort, name).changes : 0;
   }) : null;
   const counts = { matched: 0, review: 0, not_found: 0, rowsUpdated: 0 };
   for (const [i, row] of batch.entries()) {
     let result;
     try { result = classify(row.artist, await lookup(row.artist)); }
     catch (err) { throw new Error(`${row.artist}: ${err.message}. Stopped; failed lookup remains uncached and retryable.`, { cause: err }); }
     if (persist) counts.rowsUpdated += persist(row.artist, result);
     counts[result.status]++;
     log(`[${i+1}/${batch.length}] ${row.artist} → ${result.sort_name || '—'} → ${result.artist_sort || 'unresolved'} [${result.status}; ${result.musicbrainz_type || 'unknown type'}]`);
   }
   log(`Done: ${JSON.stringify(counts)}`);
   return counts;
 } finally { db.close(); }
}
async function main() {
 const env = path.join(__dirname, '.env');
 if (fs.existsSync(env)) process.loadEnvFile(env);
 const { values } = parseArgs({ options: { db: { type:'string' }, limit: { type:'string' }, artist: { type:'string' }, apply: { type:'boolean' }, 'dry-run': { type:'boolean' }, all: { type:'boolean' }, help: { type:'boolean' } } });
 if (values.help) { console.log('node resolve-artists.js [--db PATH] [--limit N | --all] [--artist EXACT_NAME] [--dry-run | --apply]\nDefault: read-only dry run, 10 uncached artists. --all explicitly selects all uncached artists.'); return; }
 if (values.apply && values['dry-run']) throw new Error('Choose --apply or --dry-run, not both.');
 if (values.all && values.limit) throw new Error('Choose --all or --limit.');
 const limit = values.all ? Infinity : Number(values.limit ?? 10);
 if (!values.all && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer.');
 await run({ dbPath: values.db || process.env.DB_PATH || path.join(__dirname,'masterAlbums.db'), limit, apply: !!values.apply, artist: values.artist,
 lookup: createLookup({ userAgent: process.env.MUSICBRAINZ_USER_AGENT || undefined }) });
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { classify, deriveKey, lookupName, createLookup, run };
