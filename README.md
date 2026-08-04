# Vinyl Shelf Organizer

Small local web app for assigning barcode labels to vinyl albums and then looking up destination shelf locations during sorting.

## Stack

- Node.js
- Express
- better-sqlite3
- SQLite
- Single-page HTML/CSS/JS frontend

## Run

```bash
npm install
node server.js
```

Open `http://localhost:3000`.

## Main Features

- Assign mode for barcode-to-album matching
- Sort mode for fast barcode lookup
- Shelf-group assignment progress dashboard
- Undo last assignment
- Unassigned-only search toggle
- Recent assignment history
- Camera cover matching with local OCR, local album matching, and barcode confirmation

## Camera Cover Matching (macOS and Windows)

Open `http://localhost:3000/cover-matcher`. Chrome and Edge can use either a webcam or a chosen image file on both macOS and Windows. OCR stays on the computer running the app: install the free [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) executable, ensure `tesseract` is on PATH, and restart the app. On macOS, `brew install tesseract` is a common option. On Windows, install a Tesseract build and add its install folder to PATH. Set `TESSERACT_PATH` to the executable path if it is not on PATH.

## Safe Test Database

`masterAlbums.test.db` is a local copy of the current album database for testing. It is separate from `masterAlbums.db`, so assignments, skips, and sorting changes made while using it do not affect the live database.

On macOS/Linux, run `DB_PATH=masterAlbums.test.db node server.js`. In PowerShell on Windows, run `$env:DB_PATH = "masterAlbums.test.db"; node server.js`.

## Database Notes

The app expects a SQLite database file named `masterAlbums.db` in the project folder by default.

The current album table in this project is `AllAlbumShelfs`.

The app will add these fields/tables automatically if missing:

- `barcode`
- `assigned_at`
- `assignment_history`

## Sharing Across Computers

This repository is set up to ignore local SQLite database files and `node_modules/`.

Recommended flow:

1. Push the code to GitHub or another Git remote.
2. On the other computer, clone the repo.
3. Run `npm install`.
4. Copy your real `masterAlbums.db` into the project folder.
5. Start the app with `node server.js`.

If you want to sync the live database too, do that separately from git.
