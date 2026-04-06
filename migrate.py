"""
Migration script — safely adds missing columns to existing database.
Safe to run multiple times (skips columns that already exist).
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "instance", "poker.db")


def column_exists(cursor, table, column):
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def migrate():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH} — nothing to migrate.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    migrations = [
        ("sessions", "default_buyin", "INTEGER NOT NULL DEFAULT 0"),
        ("sessions", "started_at",    "DATETIME"),
        ("sessions", "ended_at",      "DATETIME"),
        ("sessions", "deleted",       "BOOLEAN NOT NULL DEFAULT 0"),
        ("sessions", "small_blind",        "INTEGER NOT NULL DEFAULT 5"),
        ("sessions", "big_blind",          "INTEGER NOT NULL DEFAULT 10"),
        ("sessions", "name",               "VARCHAR(100)"),
        ("session_players", "position",    "INTEGER NOT NULL DEFAULT 0"),
        ("transactions", "confirmed",      "BOOLEAN NOT NULL DEFAULT 0"),
    ]

    # Create new tables if they don't exist
    c.execute("""
        CREATE TABLE IF NOT EXISTS hands (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            button_session_player_id INTEGER NOT NULL REFERENCES session_players(id),
            status VARCHAR(10) NOT NULL DEFAULT 'open',
            carry_over INTEGER NOT NULL DEFAULT 0,
            remainder INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS hand_bets (
            id INTEGER PRIMARY KEY,
            hand_id INTEGER NOT NULL REFERENCES hands(id),
            session_player_id INTEGER NOT NULL REFERENCES session_players(id),
            amount INTEGER NOT NULL,
            type VARCHAR(20) NOT NULL DEFAULT 'bet'
        )
    """)

    for table, column, definition in migrations:
        if not column_exists(c, table, column):
            c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            print(f"  Added: {table}.{column}")
        else:
            print(f"  Skipped (exists): {table}.{column}")

    conn.commit()
    conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    migrate()
