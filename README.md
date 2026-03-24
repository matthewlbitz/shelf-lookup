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
