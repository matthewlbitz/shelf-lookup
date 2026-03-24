const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "masterAlbums.db");
const SHELF_GROUP_MAX = 32;
const HISTORY_LIMIT = 10;

const db = new Database(DB_PATH);

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function getUserTables() {
  return db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `
    )
    .all()
    .map((row) => row.name);
}

function getTableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function hasColumn(columns, name) {
  return columns.some((column) => column.name === name);
}

function resolveAlbumTable() {
  const tables = getUserTables();

  const preferred = tables.find((name) => name === "AllAlbumShelfs");
  if (preferred) {
    return {
      tableName: preferred,
      idColumn: "index",
      artistColumn: "artist",
      titleColumn: "title",
      currentShelfColumn: "old",
      newShelfColumn: "shelf",
      barcodeColumn: "barcode",
      assignedAtColumn: "assigned_at",
    };
  }

  for (const tableName of tables) {
    const columns = getTableColumns(tableName).map((column) => column.name);
    const artistColumn = columns.includes("artist") ? "artist" : null;
    const titleColumn = columns.includes("title") ? "title" : null;
    const idColumn = columns.includes("id")
      ? "id"
      : columns.includes("index")
        ? "index"
        : null;
    const currentShelfColumn = columns.includes("current_shelf")
      ? "current_shelf"
      : columns.includes("old")
        ? "old"
        : null;
    const newShelfColumn = columns.includes("new_shelf")
      ? "new_shelf"
      : columns.includes("shelf")
        ? "shelf"
        : null;

    if (artistColumn && titleColumn && idColumn) {
      return {
        tableName,
        idColumn,
        artistColumn,
        titleColumn,
        currentShelfColumn,
        newShelfColumn,
        barcodeColumn: "barcode",
        assignedAtColumn: "assigned_at",
      };
    }
  }

  throw new Error(
    "Could not find an album table with artist/title and id or index columns."
  );
}

const schema = resolveAlbumTable();
const existingColumns = getTableColumns(schema.tableName);
const quotedTable = quoteIdentifier(schema.tableName);
const quotedIdColumn = quoteIdentifier(schema.idColumn);
const quotedArtistColumn = quoteIdentifier(schema.artistColumn);
const quotedTitleColumn = quoteIdentifier(schema.titleColumn);
const quotedBarcodeColumn = quoteIdentifier(schema.barcodeColumn);
const quotedAssignedAtColumn = quoteIdentifier(schema.assignedAtColumn);
const quotedCurrentShelfColumn = schema.currentShelfColumn
  ? quoteIdentifier(schema.currentShelfColumn)
  : null;
const quotedNewShelfColumn = schema.newShelfColumn
  ? quoteIdentifier(schema.newShelfColumn)
  : null;

if (!hasColumn(existingColumns, schema.barcodeColumn)) {
  db.exec(
    `ALTER TABLE ${quotedTable} ADD COLUMN ${quotedBarcodeColumn} TEXT`
  );
}

if (!hasColumn(existingColumns, schema.assignedAtColumn)) {
  db.exec(
    `ALTER TABLE ${quotedTable} ADD COLUMN ${quotedAssignedAtColumn} TEXT`
  );
}

db.exec(`
  CREATE TABLE IF NOT EXISTS assignment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    barcode TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    undone_at TEXT
  )
`);

db.exec(
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${schema.tableName}_barcode
    ON ${quotedTable} (${quotedBarcodeColumn})
    WHERE ${quotedBarcodeColumn} IS NOT NULL
      AND TRIM(${quotedBarcodeColumn}) <> ''
  `
);

db.exec(
  `
    CREATE INDEX IF NOT EXISTS idx_${schema.tableName}_artist_title
    ON ${quotedTable} (${quotedArtistColumn}, ${quotedTitleColumn})
  `
);

const searchStmt = db.prepare(
  `
    SELECT
      ${quotedIdColumn} AS id,
      ${quotedArtistColumn} AS artist,
      ${quotedTitleColumn} AS title,
      ${quotedCurrentShelfColumn ? `${quotedCurrentShelfColumn} AS current_shelf,` : "NULL AS current_shelf,"}
      ${quotedNewShelfColumn ? `${quotedNewShelfColumn} AS new_shelf,` : "NULL AS new_shelf,"}
      ${quotedBarcodeColumn} AS barcode,
      ${quotedAssignedAtColumn} AS assigned_at
    FROM ${quotedTable}
    WHERE ${quotedArtistColumn} LIKE @pattern
       OR ${quotedTitleColumn} LIKE @pattern
    ORDER BY ${quotedArtistColumn} COLLATE NOCASE, ${quotedTitleColumn} COLLATE NOCASE
    LIMIT 20
  `
);

const lookupShelfSelect = quotedNewShelfColumn
  ? `${quotedNewShelfColumn} AS new_shelf`
  : "NULL AS new_shelf";

const lookupByBarcodeStmt = db.prepare(
  `
    SELECT
      ${quotedIdColumn} AS id,
      ${quotedArtistColumn} AS artist,
      ${quotedTitleColumn} AS title,
      ${lookupShelfSelect}
    FROM ${quotedTable}
    WHERE ${quotedBarcodeColumn} = ?
    LIMIT 1
  `
);

const lookupByIdStmt = db.prepare(
  `
    SELECT
      ${quotedIdColumn} AS id,
      ${quotedArtistColumn} AS artist,
      ${quotedTitleColumn} AS title,
      ${quotedBarcodeColumn} AS barcode,
      ${quotedAssignedAtColumn} AS assigned_at
    FROM ${quotedTable}
    WHERE ${quotedIdColumn} = ?
    LIMIT 1
  `
);

const lookupBarcodeOwnerStmt = db.prepare(
  `
    SELECT
      ${quotedIdColumn} AS id,
      ${quotedArtistColumn} AS artist,
      ${quotedTitleColumn} AS title
    FROM ${quotedTable}
    WHERE ${quotedBarcodeColumn} = ?
    LIMIT 1
  `
);

const assignStmt = db.prepare(
  `
    UPDATE ${quotedTable}
    SET ${quotedBarcodeColumn} = @barcode,
        ${quotedAssignedAtColumn} = @assignedAt
    WHERE ${quotedIdColumn} = @albumId
  `
);

const clearAssignmentStmt = db.prepare(
  `
    UPDATE ${quotedTable}
    SET ${quotedBarcodeColumn} = NULL,
        ${quotedAssignedAtColumn} = NULL
    WHERE ${quotedIdColumn} = @albumId
      AND ${quotedBarcodeColumn} = @barcode
  `
);

const historyInsertStmt = db.prepare(
  `
    INSERT INTO assignment_history (album_id, barcode, assigned_at)
    VALUES (@albumId, @barcode, @assignedAt)
  `
);

const latestHistoryStmt = db.prepare(
  `
    SELECT
      h.id,
      h.album_id,
      h.barcode,
      h.assigned_at,
      ${quotedArtistColumn} AS artist,
      ${quotedTitleColumn} AS title
    FROM assignment_history h
    JOIN ${quotedTable} a ON a.${quotedIdColumn} = h.album_id
    WHERE h.undone_at IS NULL
    ORDER BY h.id DESC
    LIMIT 1
  `
);

const recentHistoryStmt = db.prepare(
  `
    SELECT
      h.id,
      h.album_id AS albumId,
      h.barcode,
      h.assigned_at,
      ${quotedArtistColumn} AS artist,
      ${quotedTitleColumn} AS title
    FROM assignment_history h
    JOIN ${quotedTable} a ON a.${quotedIdColumn} = h.album_id
    WHERE h.undone_at IS NULL
    ORDER BY h.id DESC
    LIMIT ?
  `
);

const markHistoryUndoneStmt = db.prepare(
  `
    UPDATE assignment_history
    SET undone_at = @undoneAt
    WHERE id = @id
  `
);

const shelfGroupExpr = quotedCurrentShelfColumn
  ? `NULLIF(RTRIM(TRIM(${quotedCurrentShelfColumn}), 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'), '')`
  : null;

const progressStmt = quotedCurrentShelfColumn
  ? db.prepare(
      `
        SELECT
          ${shelfGroupExpr} AS section,
          COUNT(*) AS total,
          SUM(
            CASE
              WHEN ${quotedBarcodeColumn} IS NOT NULL AND TRIM(${quotedBarcodeColumn}) <> '' THEN 1
              ELSE 0
            END
          ) AS assigned
        FROM ${quotedTable}
        WHERE TRIM(COALESCE(${quotedCurrentShelfColumn}, '')) <> ''
          AND ${shelfGroupExpr} IS NOT NULL
        GROUP BY section
        ORDER BY CAST(section AS INTEGER), section
      `
    )
  : null;

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    dbPath: DB_PATH,
    table: schema.tableName,
  });
});

app.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  const unassignedOnly = String(req.query.unassigned || "") === "1";

  if (!q) {
    return res.json([]);
  }

  const pattern = `%${q}%`;
  let results = searchStmt.all({ pattern });
  if (unassignedOnly) {
    results = results.filter((row) => !String(row.barcode || "").trim());
  }
  return res.json(results);
});

app.get("/history", (_req, res) => {
  try {
    const rows = recentHistoryStmt.all(HISTORY_LIMIT);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/progress", (_req, res) => {
  if (!progressStmt) {
    return res.json([]);
  }

  const rowMap = new Map();

  for (const row of progressStmt.all()) {
    rowMap.set(String(row.section), row);
  }

  const rows = Array.from({ length: SHELF_GROUP_MAX }, (_value, index) => {
    const section = String(index + 1);
    const row = rowMap.get(section);
    const total = Number(row?.total || 0);
    const assigned = Number(row?.assigned || 0);

    return {
      section,
      total,
      assigned,
      percent: total > 0 ? Number(((assigned / total) * 100).toFixed(1)) : 0,
    };
  });

  return res.json(rows);
});

app.post("/assign", (req, res) => {
  const barcode = String(req.body?.barcode || "").trim();
  const albumId = Number(req.body?.albumId);

  if (!barcode) {
    return res.status(400).json({ error: "Barcode is required." });
  }

  if (!Number.isInteger(albumId)) {
    return res.status(400).json({ error: "Valid albumId is required." });
  }

  const album = lookupByIdStmt.get(albumId);
  if (!album) {
    return res.status(404).json({ error: "Album not found." });
  }

  const barcodeOwner = lookupBarcodeOwnerStmt.get(barcode);
  if (barcodeOwner && barcodeOwner.id !== albumId) {
    return res.status(409).json({
      error: "Barcode already assigned to another album.",
      existingAlbum: barcodeOwner,
    });
  }

  if (album.barcode && album.barcode !== barcode) {
    return res.status(409).json({
      error: "Album already has a barcode.",
      existingBarcode: album.barcode,
      album,
    });
  }

  const assignedAt = new Date().toISOString();
  const assignTransaction = db.transaction(() => {
    assignStmt.run({ barcode, albumId, assignedAt });
    historyInsertStmt.run({ albumId, barcode, assignedAt });
  });
  assignTransaction();

  return res.json({
    success: true,
    message: "Barcode assigned.",
    album: {
      id: album.id,
      artist: album.artist,
      title: album.title,
      barcode,
      assigned_at: assignedAt,
    },
  });
});

app.post("/undo-last-assignment", (_req, res) => {
  try {
    const latest = latestHistoryStmt.get();

    if (!latest) {
      return res.status(404).json({ error: "No assignment available to undo." });
    }

    const undoneAt = new Date().toISOString();
    const undoTransaction = db.transaction(() => {
      const cleared = clearAssignmentStmt.run({
        albumId: latest.album_id,
        barcode: latest.barcode,
      });

      if (cleared.changes === 0) {
        throw new Error("The latest assignment no longer matches the current barcode.");
      }

      markHistoryUndoneStmt.run({ id: latest.id, undoneAt });
    });

    undoTransaction();

    return res.json({
      success: true,
      message: "Last assignment undone.",
      assignment: {
        id: latest.id,
        albumId: latest.album_id,
        barcode: latest.barcode,
        artist: latest.artist,
        title: latest.title,
        assigned_at: latest.assigned_at,
        undone_at: undoneAt,
      },
    });
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
});

app.get("/lookup/:barcode", (req, res) => {
  const barcode = String(req.params.barcode || "").trim();

  if (!barcode) {
    return res.status(400).json({ error: "Barcode is required." });
  }

  const album = lookupByBarcodeStmt.get(barcode);

  if (!album) {
    return res.status(404).json({ error: "Album not found for this barcode." });
  }

  return res.json(album);
});

app.listen(PORT, () => {
  console.log(`Vinyl shelf app running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Album table: ${schema.tableName}`);
});
