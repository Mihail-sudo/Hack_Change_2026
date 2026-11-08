import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone

from app.config import get_settings
from app.schemas import LeadCreate


_SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    question TEXT NOT NULL,
    name TEXT,
    contact TEXT NOT NULL,
    contact_type TEXT NOT NULL,
    source_page TEXT,
    status TEXT NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
"""


@contextmanager
def _connection() -> Generator[sqlite3.Connection, None, None]:
    path = get_settings().leads_db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with _connection() as connection:
        connection.executescript(_SCHEMA)


def create_lead(data: LeadCreate, status: str = "new") -> int:
    created_at = datetime.now(timezone.utc).isoformat()
    with _connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO leads
                (created_at, question, name, contact, contact_type, source_page, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                data.question,
                data.name,
                data.contact,
                data.contact_type,
                data.source_page,
                status,
            ),
        )
        return int(cursor.lastrowid)


def update_lead_status(lead_id: int, status: str, error: str | None = None) -> None:
    with _connection() as connection:
        connection.execute(
            "UPDATE leads SET status = ?, error = ? WHERE id = ?",
            (status, error, lead_id),
        )


def get_lead(lead_id: int) -> dict[str, object] | None:
    with _connection() as connection:
        row = connection.execute(
            "SELECT id, status, created_at FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
    return dict(row) if row is not None else None
