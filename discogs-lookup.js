const { normalizeExternal } = require('./catalog-utils');
const { createSearchRanker } = require('./search-ranking');

function createDiscogsLookup({ db, token, fetchImpl = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), offline = false }) {
  db.exec(`CREATE TABLE IF NOT EXISTS discogs_barcode_cache (
    code TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
  const getCache = db.prepare('SELECT payload FROM discogs_barcode_cache WHERE code = ? AND expires_at > ?');
  const saveCache = db.prepare('INSERT OR REPLACE INTO discogs_barcode_cache VALUES (?, ?, ?)');
  let tail = Promise.resolve(), nextRequest = 0, interval = 2000, queued = 0;
  const pending = new Map();
  async function request(code) {
    if (nextRequest > now()) await sleep(nextRequest - now());
    const url = new URL('https://api.discogs.com/database/search');
    url.search = new URLSearchParams({type:'release', barcode:code, per_page:'100'});
    let response;
    try {
      response = await fetchImpl(url, {headers:{Authorization:`Discogs token=${token}`, 'User-Agent':'KTRU-Shelf-Lookup/1.0'}, signal:AbortSignal.timeout(15000)});
    } finally { nextRequest = now() + interval; }
    const limit = Number(response.headers.get('X-Discogs-Ratelimit'));
    if (limit > 0) interval = Math.max(2000, Math.ceil(60000 / limit) + 250);
    nextRequest = Math.max(nextRequest, now() + interval);
    const remainingHeader = response.headers.get('X-Discogs-Ratelimit-Remaining');
    if (remainingHeader !== null && Number(remainingHeader) <= 2) nextRequest = now() + 60000;
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get('Retry-After');
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now();
      nextRequest = now() + Math.max(60000, Number.isFinite(delay) ? delay : 0);
      const error = Error('Discogs is busy or rate-limited. Manual search is available; online requests will pause.');
      error.retryable = true;
      throw error;
    }
    if (!response.ok) throw Error(response.status === 401 || response.status === 403
      ? 'Discogs access was refused. Check the server token; use manual search for now.' : 'Discogs lookup failed. Use manual search or try again later.');
    const data = await response.json();
    if (!Array.isArray(data.results)) throw Error('Discogs returned an unexpected response.');
    return { results: data.results.filter(r => r.type === 'release').map(r => ({
      id: r.id, master_id: r.master_id, title: String(r.title || ''), barcode: r.barcode || []
    })), truncated: Number(data.pagination?.pages || 1) > 1 };
  }
  return async raw => {
    const code = normalizeExternal(raw);
    if (!code) throw Error('Invalid UPC/EAN code.');
    const cached = getCache.get(code, now());
    if (cached) return JSON.parse(cached.payload);
    if (offline) return {results:[], truncated:false};
    if (!token) throw Error('Online barcode lookup is not configured. Add DISCOGS_TOKEN to the server .env file.');
    if (pending.has(code)) return pending.get(code);
    if (queued >= 100) throw Error('Lookup queue is full. Let the current scans finish first.');
    queued++;
    const work = tail.then(async () => {
      // Preserve the scanned digit length for Discogs; padding is only a local cache key.
      const query = String(raw).replace(/[\s-]/g, '');
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { result = await request(query); break; }
        catch (error) { if (!error.retryable || attempt) throw error; }
      }
      saveCache.run(code, JSON.stringify(result), now() + (result.results.length ? 86400000 : 3600000));
      return result;
    });
    tail = work.catch(() => {});
    pending.set(code, work);
    try { return await work; } finally { pending.delete(code); queued--; }
  };
}

function matchDiscogs(data, localAlbums) {
  const ids = new Set();
  for (const result of data.results) {
    for (const album of localAlbums) {
      const link = String(album.discogs_link || '');
      const kind = /\/master\//.test(link) ? 'master' : /\/release\//.test(link) ? 'release' : null;
      if (kind && String(album.discogs_id) === String(kind === 'master' ? result.master_id : result.id)) ids.add(album.id);
    }
  }
  // Text matches are suggestions only; no splitting on hyphens in artist names.
  const rankers = data.results.slice(0, 10).map(r => createSearchRanker(r.title));
  const suggestions = localAlbums.map(album => ({album,
    score: Math.max(0, ...rankers.map(rank => rank(album.artist, album.title)))
  })).filter(row => row.score > 0).sort((a, b) => b.score - a.score)
    .slice(0, 20).map(row => row.album);
  return { ids: data.truncated ? [] : [...ids], suggestions, query: data.results[0]?.title || '' };
}
module.exports = { createDiscogsLookup, matchDiscogs };
