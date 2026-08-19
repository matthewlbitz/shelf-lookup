# KTRU Shelf Lookup

KTRU Shelf Lookup is a local web application for organizing and navigating KTRU Rice Radio's physical music collection. It connects album records, barcode labels, artist-sorting rules, and shelf assignments in one workflow designed for hands-on catalog work.

The current development database contains more than 19,000 album records. The application supports barcode assignment and lookup, collection-progress tracking, and normalization of artist names for consistent physical sorting.

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
