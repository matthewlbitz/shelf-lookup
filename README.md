# KTRU Shelf Lookup

KTRU Shelf Lookup is a local web application for organizing and navigating KTRU Rice Radio's physical music collection. It connects album records, barcode labels, artist-sorting rules, and shelf assignments in one workflow designed for hands-on catalog work.

The current development database contains more than 19,000 album records. The application supports barcode assignment and lookup, collection-progress tracking, and normalization of artist names for consistent physical sorting.

## Guided stack workflow

The home page opens the previous Assign / Sort workflow. The experimental
**Library stacks** workflow remains available at `/workflow.html`, using the
existing black-and-gold Courier styling. Choose a starting point: labels, assignment, columns, or shelves.
Create separate saved stacks for the UPC and no-UPC piles, and write the stack
label on a slip kept with each physical pile.

- **No UPC, labels in order:** scan the first and last KTRU labels; keep the stack
  in place and assign from the first CD.
- **With UPC:** scan each KTRU label and then that CD’s UPC/EAN. Both scans are
  saved independently. Confirm later, starting at the top of the scanned pile.
- **Already assigned:** scan KTRU labels once to begin column or shelf sorting.
- **Column sorting:** place the displayed CD onto its column pile. Finishing
  creates a saved stack for each column, in physical shelf-sorting order.
- **Shelf sorting:** place each displayed CD onto its shelf and confirm placement.

Every step is stored in `masterAlbums.db`, including barcode pairs, assignment
progress, physical order, and column piles. Assignment and workflow advancement
are one database transaction. Retries have stable operation IDs; stale changes
are rejected. **Save & leave for a partner** releases a stack. Another operator
can resume it, or deliberately take over a stack after checking with its owner.
Keep the source pile and any partially filled column piles together when pausing.

The server can be restarted without losing saved work. Local catalog work does
not require internet, but other devices need a local network connection to the
server. Fresh external UPC lookups require internet; scans remain saved if lookup
is unavailable. Work while completely disconnected from the server is not yet
supported: the page retains the pending save for retry and asks you to stop moving
CDs until reconnected. Back up the database file to protect all saved work.

Existing browser queues and shared handoffs are available under **Existing tools**
(`/index.html`). Finish existing piles there; they are not automatically migrated
into the new stack system. New column piles use the guided workflow’s shared home
screen rather than the older handoff inboxes.

## Highlights

- Search albums by artist or title
- Assign unique barcode labels to catalog records
- Look up an album's destination shelf by scanning or entering its barcode
- Filter searches to records that still need assignments
- Review recent barcode activity and undo individual or latest assignments
- Track assignment progress by shelf group
- Normalize artist names through an interactive artist sorter
- Filter artist-sorting work by genre
- Automatically handle supported one-word and numbered artist-name patterns
- Review artist-sorting progress and undo recent changes
- Use a separate SQLite database through the `DB_PATH` environment variable

## Why I Built It

KTRU's physical music library requires more than a searchable catalog: every album must be labeled consistently, assigned to the correct shelf, and sortable according to a shared artist-name convention. Manual work at this scale is vulnerable to duplicate barcodes, inconsistent naming, and lost progress.

Shelf Lookup turns that operational process into a focused web workflow. It validates assignments, records reversible history, summarizes progress, and helps staff move efficiently between catalog data and the physical collection.

## Technology

- **Runtime:** Node.js
- **Server:** Express
- **Database:** SQLite with `better-sqlite3`
- **Frontend:** HTML, CSS, and browser JavaScript
- **API style:** JSON endpoints used by the browser interface
- **Version control:** Git and GitHub

## Project Structure

```text
shelf-lookup/
|-- server.js          # Express server, SQLite queries, and API routes
|-- index.html         # Barcode assignment, lookup, history, and progress UI
|-- artist-sorter.html # Artist-name normalization and progress workflow
|-- package.json       # Project metadata, scripts, and dependencies
|-- masterAlbums.db    # Development catalog database
`-- merge/
    `-- merge.py       # Supporting database merge utility
```

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/matthewlbitz/shelf-lookup.git
cd shelf-lookup
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the application

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

The artist-sorting interface is available at [http://localhost:3000/artist-sorter](http://localhost:3000/artist-sorter).

## Use a Separate Database

The application uses `masterAlbums.db` in the project folder by default. To protect the primary database while testing, point the application to a copy.

On macOS or Linux:

```bash
DB_PATH=masterAlbums.test.db npm start
```

On Windows PowerShell:

```powershell
$env:DB_PATH="masterAlbums.test.db"
npm start
```

The server inspects the database schema at startup and supports the project's `rainbow_albums` table as well as compatible album tables containing artist, title, and identifier fields.

## Data and Workflow

The application maintains operational fields and history records for:

- Unique album barcodes
- Barcode assignment timestamps
- Reversible assignment history
- Normalized artist-sort values
- Reversible artist-sort history
- Current and destination shelf information

Where required, the server creates missing workflow columns, history tables, and indexes when it starts. Because startup can modify the selected database schema, use a backup or test copy when evaluating changes.

## API Overview

The Express server provides endpoints for:

- Album search and barcode validation
- Barcode assignment, lookup, and undo actions
- Recent assignment history and shelf progress
- Artist-sort selection, saving, progress, recent history, and undo actions
- Application health checks

## What This Project Demonstrates

- Translating a physical collection-management process into a web application
- Designing database-backed workflows with validation and reversible history
- Building focused user interfaces for repetitive operational work
- Querying and updating SQLite safely with prepared statements and transactions
- Handling multiple compatible database schemas
- Improving data quality through artist-name normalization and progress tracking
- Iterating on real user needs with Git and GitHub

## Current Status

This is an actively developed operational tool. Current work focuses on expanding artist-name normalization, improving collection progress visibility, refining edge-case handling, and supporting safe database-backed workflows.

## Author

**Matthew Bitz**<br>
Computer Science, Rice University<br>
[GitHub](https://github.com/matthewlbitz)

### Ordered searching

Turn on **Ordered searching**, scan the first barcode in the stack, then scan
its last barcode. The full inclusive range is queued in scan direction: 100 to
130 queues 100, 101, …, 130; 100 to 70 queues 100, 99, …, 70.

Start with the first CD and work down the stack. Search for each album, choose
it, and press Enter to assign the next queued barcode automatically. Neither
endpoint needs to be assigned in advance. For a single CD, scan its barcode twice.
Numeric barcodes retain leading zeros and support large values exactly.

After the stack is done, scan the first barcode of another stack to continue,
or uncheck **Ordered searching** for stacks that need individual scans. Toggling
clears pending scans but keeps completed assignments. **Undo Last** restores the
undone barcode and remaining range in the active session. Reloading resets the
mode. External barcode matching remains available when ordered searching is off.

Run checks with `node --test test/ordered-search.test.js`.

### Batch sorting

In **Sort**, scan every CD in a stack, placing each scanned CD on top of the
scanned stack. Select **Start sorting** to see destinations in reverse scan
order, ten CDs at a time. Follow the rows downward, then press **Enter** or
**Next 10**. The last group can contain fewer than ten CDs. Press **Enter** on the final group to finish the stack and immediately start
scanning the next stack. **Previous 10** lets you revisit a group.
Unmatched barcodes and albums without a shelf retain their position and show
**Set aside**. Use **Remove last scan** to correct a scan while scanning, and
remove that physical CD from the scanned stack too. Batch progress is saved in this browser.

Run workflow checks with `node --test test/*.test.js`.

### Column bucket sorting

Sort uses **columns-first batch sorting** by default. Scan a
stack as usual; sorting shows column numbers in groups of ten. Place each CD on
top of its column bucket in row order. **Next 10** confirms that the displayed
group was physically placed and saves its order in the buckets.

Select **Group placed — pause for buckets** to pause after placing a group.
Choose **Sort column …** to empty a bucket: full shelf labels appear in reverse
placement order, ten at a time, without rescanning. Finish the bucket and select
**Resume stack** to continue. Buckets can also be selected while scanning;
the scanned source stack is retained. Bucket counts and progress persist across
reloads in the same browser. Keep the physical stacks in order and use one tab
for the sorting session. Unknown destinations remain **Set aside** and are not
added to a column bucket. Previous-group navigation is available only in normal
sorting, since advancing a bucket group records physical placements.

### One album at a time

Enable **One album at a time** in Sort to scan or type a barcode and immediately
see the album and its full shelf location. Nothing is queued or added to column
buckets. Turn it off to return to batch sorting. Switch modes between stacks;
the preference is remembered in this browser.

### Two computers on the same Wi-Fi

Run `npm start` on the computer with your catalog. The terminal prints a
**Same Wi-Fi** address and a **Receive stacks** address. Your partner opens the
Receive stacks address in her browser; she does not need Node, Git, or a copy
of the database. Keep the host computer awake and connected. If the address
changes after reconnecting, use the newly printed address. Allow Node through
the host firewall if prompted. Some guest/station networks block communication
between devices; those require a network that permits local connections.

On the scanning computer, use the default columns-first batch sorting. Confirm
placed groups as usual. Between stacks, or after **Group placed — pause for
buckets**, select **Hand off column** beside a column bucket. Give your partner
that exact physical stack, keeping its top and bottom unchanged. Both screens
show a matching stack ID. Once sent, start a separate physical bucket for any
more CDs in that column.

On **Receive shared stacks**, select the matching stack and follow the full
shelf destinations from the top down. Confirm each placed group with the button
or Enter. New stacks appear automatically, and completed groups are saved in
the host's SQLite database. Returning to the list or reloading preserves progress;
use the same receiving browser to resume claimed stacks. Use one receiving tab.

If a handoff fails, keep the column separate and use **Retry handoff** before
continuing to scan. Retrying does not create another copy. If confirming a shelf
group fails after you physically placed it, retry the button without placing the
same CDs again. Keep browser storage: it holds the sender's pending handoff ID
and the receiver's claim identity. Unsent scanning progress remains in the
scanning browser. The host must be running for handoffs or progress updates.

The shared app is intended for trusted local Wi-Fi; it has no login. Do not
forward its port onto the internet. Shared stack records are stored automatically
with the catalog and should be included in your usual database backups.

Repeated barcodes within the current scanned stack are ignored with a notice,
including while a lookup is pending. Removing a scan lets you scan it again.
The same barcode can be scanned in a later stack or in **One album at a time** mode.

### Paired barcode scanning

Turn on **Use external barcodes (KTRU → UPC/EAN per CD)**. This switches off
first/last range inference and clears pending scans. In the first pass, scan each
CD’s KTRU barcode followed by that same CD’s UPC/EAN, then move to the next CD.
Use **Skip barcode** for CDs without an external barcode. Focus switches automatically.

Click **Finish scanning — confirm albums** once every CD is paired. In the second
pass, confirm and assign each match (or search manually), in reverse scanning
order, starting with the last CD scanned (the top of the scanned pile). No albums are assigned during capture.

Place each confirmed CD onto a new pile. Once confirmation is finished, click
**Hand confirmed stack to column sort** to send that pile to the shared column
sorter inbox without navigating away. On the column sorter, click **Refresh incoming
confirmed stacks**, then **Receive stack** for the matching stack ID. Another tab
or browser connected to the same server can receive it without rescanning.
Keep skipped CDs separate. Column sorting follows the top of the confirmed pile
(the reverse of confirmation order). Use the existing **Hand off column** buttons
to send completed column piles to the shelf sorter. Finish an active sorting stack
before importing another one. The pending confirmed pile is held in this page
until handed off; keep the page open.

Confirmed-stack handoffs use persistent retry IDs. If sending fails, keep the pile
separate and retry. The column receiver saves the imported stack before acknowledging
receipt; refresh the inbox to retry an interrupted acknowledgement. A claimed stack
belongs to its receiving browser. The existing column-to-shelf handoff is unchanged.


### Saving scanned stack bundles

On Sort, scan one physical stack, placing each scanned CD on top, then choose
**Save stack bundle**. Repeat for additional stacks. Open **Stack bundles · sort
into columns**, refresh, and select the six-character bundle label matching the
physical pile. Scanning 1, 2, 3, 4, 5 displays 5 first when that bundle is opened.
These bundles use the same Wi-Fi host as assignment handoffs and column-to-shelf
bundles.

**Previous 10** reopens a page during column or shelf sorting. For column sorting,
restore the reopened group's CDs to their original top-first order before placing
them again; the app rolls back that group's bucket counts. Going back stops at a
handoff or bucket-draining boundary, since those CDs may already be with another
sorter. Finish closes the stack, so check the final page before confirming it.

Shared bundles are persistent rows in `masterAlbums.db`:
`shared_column_stacks` for stacks going into columns and `shared_sort_stacks`
for columns going onto shelves. Completed rows remain stored but leave the inbox.
The host computer and Node server must be running and reachable to fetch bundles;
this is not cloud storage or peer replication. Once a column bundle is received
for sorting, its working state is saved in that receiving browser's local storage.
Local unsent scans and column buckets are also browser-local, not shared.
