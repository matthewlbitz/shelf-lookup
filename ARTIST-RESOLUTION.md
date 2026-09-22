# Artist resolution

Existing nonblank album sort values are preserved. New MusicBrainz results use the complete `sort-name` in both the cache and the album `artist_sort` column. Earlier manually chosen or surname-only sort values are retained as requested.

The server fills blanks from successful cached values, an existing value for that exact artist, or a deterministic fallback. It never calls MusicBrainz in an HTTP request. `/api/next-artist` therefore completes without requiring a person to resolve every unknown artist. Restart the server after updating the code.

## Commands

Run in the shelf-lookup repository. The default database is `masterAlbums.db`; `.env` / `DB_PATH` can override it. Specify `--db` to remove ambiguity.

```sh
# Preview 10 fallback upgrades; no database/cache writes.
node resolve-artists.js --db masterAlbums.db --retry-fallback --dry-run --limit 10

# Enrich all fallback cases, preserving existing accepted/manual values.
# This can take several hours; progress prints as each artist finishes.
node resolve-artists.js --db masterAlbums.db --retry-fallback --all --apply

# Inspect all fallback and legacy review cases as JSON.
node resolve-artists.js --db masterAlbums.db --review > artist-review.json

# Fill newly imported blanks without network access.
node resolve-artists.js --db masterAlbums.db --offline --all --apply

# Limit investigation to one exact database name and optionally save a report.
node resolve-artists.js --db masterAlbums.db --artist '"Pippin" New Broadway Cast' --retry-fallback --dry-run --report artist-sample.json

# Focused verification; full suite also includes pre-existing ordered-search tests.
node --test test/resolve-artists.test.js
npm run check
```

Only run one resolver process at a time. Apply runs take an exclusive `.resolver.lock`. If a process is forcibly killed, confirm it is no longer running before removing that lock. Ctrl-C may leave the lock too. Completed artists and responses are saved transactionally as work progresses; rerun the same command after removing a stale lock. Do not restore a whole database backup over newer station work.

## Selection and fallback policy

1. Reuse accepted cache results and existing values for the same exact artist.
2. Search the exact name, normalized name, then aliases. Automatic identity matches require a unique matching candidate, a high score with separation from competing results, and a complete result set. Discogs numeric disambiguation suffixes require album context.
3. Search up to three album contexts. A matching title and single matching artist credit must also have a commercial barcode, catalog number, or matching label and year. Conflicting identities are not accepted. Station inventory barcodes are deliberately excluded; external codes come from `album_external_barcodes`.
4. Otherwise keep a deterministic, marked fallback. Leading English articles and initial punctuation are ignored; numbers are retained; bands, collaborations and cast credits are not treated as personal names. No speculative surname inversion occurs. Empty artists receive `[Unknown artist]`.

Fallbacks do not assert a MusicBrainz identity. Metadata includes `status`, `method`, `confidence` (a policy score, not a calibrated probability), and `evidence`. API failures are `lookup-error` fallbacks and can be retried. Old review entries have insufficient evidence to accept without fresh searches.

`musicbrainz_response_cache` stores complete successful search responses, including empty results. Retries reuse them indefinitely, avoiding repeated searches; these are snapshots, so newly changed MusicBrainz data will require deliberately clearing selected cache rows before another run. Errors/malformed responses are never cached. Dry runs use memory and existing persistent cache only.

Requests identify the application and project URL, run serially at least 1.1 seconds apart, use timeouts, and retry transient HTTP/network errors with exponential backoff and Retry-After. Set `MUSICBRAINZ_USER_AGENT` to customize the contact information. See the [MusicBrainz search documentation](https://musicbrainz.org/doc/MusicBrainz_API/Search).

## Review

`GET /api/artist-sort-review?limit=100&offset=0` returns the review count and paginated records (up to 500). `--review` exports all nonmatched cache entries, including legacy review records for artists which may already have manual sort values. `POST /api/save-artist-sort` still accepts explicit corrections and records undo history. Corrections are preserved during fallback upgrades; review cache metadata may still show the earlier automated suggestion.

The server's 100% progress means every artist has a usable sort value, not that every identity is MusicBrainz-confirmed. Shelf assignments, barcodes, and the existing good sort values are not rewritten.

Before this task's database changes, a SQLite backup was saved at `backups/masterAlbums.before-resolver-v2.db`.
