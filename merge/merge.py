import sqlite3
import os

MASTER_DB = "masterAlbums.db"

VOLUNTEER_DBS = [
    "mira.db",
    "marina.db",
]

TABLE = "rainbow_albums"

master = sqlite3.connect(MASTER_DB)
master.row_factory = sqlite3.Row
mc = master.cursor()

total_merged = 0

for db_name in VOLUNTEER_DBS:

    if not os.path.exists(db_name):
        print(f"Skipping {db_name} (not found)")
        continue

    print(f"\nMerging {db_name}")

    volunteer = sqlite3.connect(db_name)
    volunteer.row_factory = sqlite3.Row
    vc = volunteer.cursor()

    vc.execute(f"""
        SELECT id, barcode, assigned_at
        FROM {TABLE}
    """)

    merged = 0
    conflicts = 0

    for row in vc.fetchall():

        row = dict(row)

        # Volunteer never assigned a barcode
        if not row["barcode"]:
            continue

        mc.execute(f"""
            SELECT barcode
            FROM {TABLE}
            WHERE id = ?
        """, (row["id"],))

        master_row = mc.fetchone()

        if master_row is None:
            continue

        # Already assigned in master
        if master_row["barcode"]:
            if master_row["barcode"] != row["barcode"]:
                print(
                    f"Conflict on album ID {row['id']}: "
                    f"master={master_row['barcode']} "
                    f"{db_name}={row['barcode']}"
                )
                conflicts += 1
            continue

        mc.execute(f"""
            UPDATE {TABLE}
            SET barcode = ?,
                assigned_at = ?
            WHERE id = ?
        """, (
            row["barcode"],
            row["assigned_at"],
            row["id"]
        ))

        merged += 1

    volunteer.close()

    total_merged += merged

    print(f"  Merged: {merged}")
    print(f"  Conflicts: {conflicts}")

master.commit()
master.close()

print(f"\nDone! Total merged: {total_merged}")