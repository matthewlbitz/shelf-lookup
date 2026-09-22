#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const {parseArgs} = require('node:util');
const {clean,lookupName,normalize,fallback,quote,migrate,save} = require('./artist-resolution');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const literal = value => '"'+String(value).replace(/([+\-!(){}\[\]^"~*?:\\/]|&|\|)/g,'\\$1')+'"';
const validId = id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id || '');
function matched(candidate, method, confidence) {
  const sort = clean(candidate['sort-name']);
  return {sort_name:sort,artist_sort:sort,musicbrainz_id:candidate.id,musicbrainz_type:candidate.type || null,
    source:'musicbrainz',status:'matched',method,confidence,evidence:''};
}
function identity(name, candidate) {
  const key = normalize(lookupName(name));
  if (!key) return null;
  if (clean(candidate.name).toLowerCase() === lookupName(name).toLowerCase()) return 'exact';
  if (normalize(candidate.name) === key) return 'normalized';
  if ((candidate.aliases || []).some(a=>normalize(a.name) === key)) return 'alias';
  return null;
}
function classify(artist, data) {
  if (!Array.isArray(data.artists) || !Number.isInteger(data.count) || data.count < data.artists.length || (data.count && !data.artists.length))
    throw Error('Malformed MusicBrainz response');
  const eligible = data.artists.filter(c=>identity(artist,c));
  const top = eligible[0];
  // A search score alone cannot distinguish namesakes. Truncated result sets require context.
  if (eligible.length === 1 && data.count <= data.artists.length && lookupName(artist) === clean(artist) &&
      validId(top.id) && clean(top['sort-name']) && Number(top.score)>=95 &&
      data.artists.filter(c=>c!==top).every(c=>Number(c.score)<=Number(top.score)-10))
    return matched(top,identity(artist,top),0.98);
  return {...fallback(artist),status:data.count ? 'review':'not_found'};
}
function createLookup({fetchImpl=fetch,wait=sleep,now=Date.now,userAgent='KTRU-shelf-lookup/2.0 (https://github.com/matthewlbitz/shelf-lookup)', cacheGet=()=>null,cacheSet=()=>{}}={}) {
  let last=-Infinity;
  const memory = new Map();
  let queue = Promise.resolve();
  async function request(entity, query) {
    const key=JSON.stringify([entity,query]);
    const cached=memory.get(key) || cacheGet(key);
    if (cached) return cached;
    const url=new URL(`https://musicbrainz.org/ws/2/${entity}/`);
    url.search=new URLSearchParams({query,fmt:'json',limit:'100'});
    for(let attempt=0;attempt<4;attempt++) {
      await wait(Math.max(0,1100-(now()-last))); last=now();
      try {
        const response=await fetchImpl(url,{headers:{'User-Agent':userAgent,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
        if(response.ok) {
          const data=await response.json();
          const rows=data[entity==='artist'?'artists':'releases'];
          if(!Array.isArray(rows) || !Number.isInteger(data.count) || data.count<rows.length || (data.count && !rows.length)) throw Error('Malformed MusicBrainz response');
          memory.set(key,data); cacheSet(key,data); return data;
        }
        if(![429,500,502,503,504].includes(response.status)) throw Object.assign(Error(`MusicBrainz HTTP ${response.status}`),{fatal:true});
        const retry=response.headers.get('retry-after');
        const delay=/^\d+$/.test(retry || '')?Number(retry)*1000:Date.parse(retry)-now();
        if(attempt===3) throw Error(`MusicBrainz HTTP ${response.status}`);
        await wait(Math.max(2000*2**attempt,Number.isFinite(delay)?delay:0));
      } catch(err) {
        if(err.fatal || attempt===3) throw err;
        await wait(2000*2**attempt);
      }
    }
  }
  const search=(entity,query)=>{
    const task=queue.then(()=>request(entity,query)); queue=task.catch(()=>{}); return task;
  };
  const lookup=name=>search('artist',`artist:${literal(lookupName(name))}`);
  lookup.search=search;
  return lookup;
}
function releaseCandidate(artist, album, data) {
  if(!Array.isArray(data.releases) || data.count>data.releases.length) return null;
  const candidates=new Map();
  for(const release of data.releases) {
    if(normalize(release.title)!==normalize(album.title)) continue;
    const credits=release['artist-credit'] || [];
    // Never select one member of a joint credit as the whole artist.
    if(credits.length!==1) continue;
    const candidate=credits[0].artist;
    if(!candidate || !validId(candidate.id) || !clean(candidate['sort-name']) ||
      !(identity(artist,candidate) || normalize(credits[0].name)===normalize(lookupName(artist)))) continue;
    const labels=release['label-info'] || [];
    const barcode=album.externalCodes?.includes(release.barcode);
    const catalog=album.catalog_number && labels.some(l=>normalize(l['catalog-number'])===normalize(album.catalog_number));
    const label=album.label && labels.some(l=>normalize(l.label?.name)===normalize(album.label));
    const year=album.year && String(release.date || '').slice(0,4)===String(album.year);
    if(barcode || catalog || (label && year)) candidates.set(candidate.id,candidate);
  }
  return candidates.size===1 ? matched([...candidates.values()][0],'release-context',0.99):null;
}
async function resolve(artist, albums, lookup) {
  let result=classify(artist,await lookup(artist));
  if(result.status==='matched') return result;
  if(lookup.search) {
    const normalized=normalize(lookupName(artist));
    for(const query of [...new Set([`artist:${literal(normalized)}`,`alias:${literal(lookupName(artist))}`])]) {
      result=classify(artist,await lookup.search('artist',query));
      if(result.status==='matched') return result;
    }
    const matches=new Map();
    for(const album of albums.filter(a=>clean(a.title)).slice(0,3)) {
      const queries=[`release:${literal(album.title)} AND artist:${literal(lookupName(artist))}`];
      for(const code of (album.externalCodes || []).slice(0,2)) queries.unshift(`barcode:${literal(code)}`);
      if(album.catalog_number) queries.unshift(`catno:${literal(album.catalog_number)}`);
      for(const query of queries) {
        const found=releaseCandidate(artist,album,await lookup.search('release',query));
        if(found) { found.evidence=JSON.stringify({title:album.title,year:album.year,label:album.label,query}); matches.set(found.musicbrainz_id,found); }
      }
    }
    if(matches.size===1) return [...matches.values()][0];
  }
  return fallback(artist,'inconclusive','No unique high-confidence identity after available passes');
}
async function run({dbPath,limit=10,apply=false,artist,offline=false,retryFallback=false,lookup,log=console.log,report}={}) {
  const db=new Database(dbPath,{readonly:!apply,fileMustExist:true});
  let lock;
  try {
    if(apply) { lock=fs.openSync(dbPath+'.resolver.lock','wx'); migrate(db); }
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
    const table=(tables.includes('AllAlbumShelfs')?['AllAlbumShelfs']:tables).find(t=>{
      const cols=db.prepare(`PRAGMA table_info(${quote(t)})`).all().map(c=>c.name);
      return ['artist','title','artist_sort'].every(c=>cols.includes(c));
    });
    if(!table) throw Error('No compatible album table found');
    const t=quote(table);
    const cache=new Map(tables.includes('artist_sort_cache')?db.prepare('SELECT * FROM artist_sort_cache').all().map(r=>[r.artist,r]):[]);
    const albums=db.prepare(`SELECT * FROM ${t}`).all();
    const groups=new Map();
    for(const a of albums) { const key=a.artist ?? ''; if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(a); }
    const codes=new Map();
    if(tables.includes('album_external_barcodes')) for(const row of db.prepare('SELECT * FROM album_external_barcodes').all()) {
      if(!codes.has(row.album_id)) codes.set(row.album_id,[]); codes.get(row.album_id).push(row.code);
    }
    // The album barcode is a station inventory ID, not a commercial release barcode.
    for(const a of albums) a.externalCodes=codes.get(a.id ?? a.index) || [];
    lookup ||= createLookup({userAgent:process.env.MUSICBRAINZ_USER_AGENT || undefined,
      cacheGet:key=>{const row=tables.includes('musicbrainz_response_cache')?db.prepare('SELECT payload FROM musicbrainz_response_cache WHERE key=?').get(key):null;return row?JSON.parse(row.payload):null;},
      cacheSet:(key,data)=>{if(apply) db.prepare('INSERT OR REPLACE INTO musicbrainz_response_cache VALUES (?,?,?)').run(key,JSON.stringify(data),new Date().toISOString());}});
    const pending=[...groups].filter(([name,rows])=>(artist===undefined || name===artist) &&
      (rows.some(a=>!clean(a.artist_sort)) || (retryFallback && cache.get(name)?.status==='fallback'))).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit);
    log(`${apply?'APPLY':'DRY RUN (no database writes)'}: ${pending.length} artists; ${offline?'offline':'MusicBrainz enabled'}`);
    const counts={matched:0,fallback:0,rowsUpdated:0,errors:0}; const results=[];
    for(const [i,[name,rows]] of pending.entries()) {
      const prior=cache.get(name);
      const existing=[...new Set(rows.map(a=>clean(a.artist_sort)).filter(v=>v && !(prior?.status==='fallback' && v===prior.artist_sort)))];
      let result;
      if(prior?.status==='matched' && clean(prior.artist_sort)) result=prior;
      else if(existing.length===1) result={...fallback(name),sort_name:existing[0],artist_sort:existing[0],source:'existing',status:'matched',method:'existing-value',confidence:1};
      else if(prior?.status==='fallback' && !retryFallback) result=prior;
      else if(offline || !clean(name)) result=fallback(name,offline?'offline':'missing-name');
      else {
        try { result=await resolve(name,rows,lookup); }
        catch(err) { counts.errors++; result=fallback(name,'lookup-error',err.message); }
      }
      if(apply) counts.rowsUpdated+=db.transaction(()=>{
        // Refresh before writing; never overwrite a manual value entered during a request.
        const current=db.prepare('SELECT * FROM artist_sort_cache WHERE artist=?').get(name);
        if(current?.status==='matched' && clean(current.artist_sort)) result=current;
        save(db,name,result);
        const manualGuard=tables.includes('artist_sort_history')
          ? 'AND NOT EXISTS (SELECT 1 FROM artist_sort_history WHERE artist=? AND undone_at IS NULL)'
          : 'AND ? IS NOT NULL';
        return db.prepare(`UPDATE ${t} SET artist_sort=? WHERE COALESCE(artist,'')=? AND
          (TRIM(COALESCE(artist_sort,''))='' OR (? AND artist_sort=? ${manualGuard}))`)
          .run(result.artist_sort,name,Number(retryFallback && prior?.status==='fallback'),prior?.artist_sort || '',name).changes;
      })();
      counts[result.status==='matched'?'matched':'fallback']++;
      results.push({artist:name,...result});
      log(`[${i+1}/${pending.length}] ${name} → ${result.artist_sort} [${result.status}; ${result.method || 'legacy-cache'}] | This run: ${counts.matched} matched, ${counts.fallback} without a confident match (fallback)${counts.errors ? `; ${counts.errors} lookup errors included` : ''}`);
    }
    if(report) fs.writeFileSync(report,JSON.stringify({counts,results},null,2)+'\n');
    log(`Done: ${JSON.stringify(counts)}`); return counts;
  } finally {db.close();if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(dbPath+'.resolver.lock');}}
}
async function main() {
  const env=path.join(__dirname,'.env'); if(fs.existsSync(env)) process.loadEnvFile(env);
  const {values:v}=parseArgs({options:Object.fromEntries(['db','limit','artist','report'].map(k=>[k,{type:'string'}]).concat(['apply','dry-run','all','offline','retry-fallback','help','review'].map(k=>[k,{type:'boolean'}])))});
  if(v.help) return console.log('node resolve-artists.js [--db PATH] [--limit N | --all] [--artist NAME] [--apply | --dry-run] [--offline] [--retry-fallback] [--report PATH] [--review]\nDefault: read-only dry run of 10 artists. Review emits JSON.');
  if(v.apply && v['dry-run']) throw Error('Choose --apply or --dry-run');
  if(v.all && v.limit) throw Error('Choose --all or --limit');
  const dbPath=path.resolve(v.db || process.env.DB_PATH || path.join(__dirname,'masterAlbums.db'));
  if(v.review) {const db=new Database(dbPath,{readonly:true});try{console.log(JSON.stringify(db.prepare("SELECT * FROM artist_sort_cache WHERE status <> 'matched' ORDER BY artist").all(),null,2));}finally{db.close();}return;}
  const limit=v.all?Infinity:Number(v.limit || 10); if(!v.all && (!Number.isSafeInteger(limit) || limit<1)) throw Error('Invalid limit');
  await run({dbPath,limit,artist:v.artist,apply:!!v.apply,offline:!!v.offline,retryFallback:!!v['retry-fallback'],report:v.report});
}
if(require.main===module) main().catch(err=>{console.error(err.message);process.exitCode=1;});
module.exports={classify,lookupName,createLookup,run,resolve,releaseCandidate};
