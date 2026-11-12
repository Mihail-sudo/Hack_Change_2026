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
    status TEXT NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

CREATE TABLE IF NOT EXISTS dialogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL DEFAULT 'bot',
    handoff_requested_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dialogs_updated_at ON dialogs(updated_at);

CREATE TABLE IF NOT EXISTS dialog_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dialog_id INTEGER NOT NULL REFERENCES dialogs(id),
    role TEXT NOT NULL,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dialog_messages_dialog ON dialog_messages(dialog_id, id);
"""

_DIALOG_COLUMNS = "id, session_id, mode, handoff_requested_at, created_at, updated_at"
_MESSAGE_COLUMNS = "id, role, author, content, created_at"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _ensure_dialog(connection: sqlite3.Connection, session_id: str) -> int:
    now = _now()
    connection.execute(
        "INSERT OR IGNORE INTO dialogs (session_id, mode, created_at, updated_at) VALUES (?, 'bot', ?, ?)",
        (session_id, now, now),
    )
    row = connection.execute(
        "SELECT id FROM dialogs WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    return int(row["id"])


def get_or_create_dialog(session_id: str) -> dict[str, object]:
    with _connection() as connection:
        dialog_id = _ensure_dialog(connection, session_id)
        row = connection.execute(
            f"SELECT {_DIALOG_COLUMNS} FROM dialogs WHERE id = ?",
            (dialog_id,),
        ).fetchone()
    return dict(row)


def get_dialog(session_id: str) -> dict[str, object] | None:
    with _connection() as connection:
        row = connection.execute(
            f"SELECT {_DIALOG_COLUMNS} FROM dialogs WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    return dict(row) if row is not None else None


def request_handoff(session_id: str) -> None:
    with _connection() as connection:
        dialog_id = _ensure_dialog(connection, session_id)
        now = _now()
        connection.execute(
            """
            UPDATE dialogs
            SET handoff_requested_at = COALESCE(handoff_requested_at, ?), updated_at = ?
            WHERE id = ?
            """,
            (now, now, dialog_id),
        )


def set_dialog_mode(session_id: str, mode: str) -> bool:
    with _connection() as connection:
        now = _now()
        cursor = connection.execute(
            """
            UPDATE dialogs
            SET mode = ?,
                handoff_requested_at = CASE WHEN ? = 'admin' THEN NULL ELSE handoff_requested_at END,
                updated_at = ?
            WHERE session_id = ?
            """,
            (mode, mode, now, session_id),
        )
        return cursor.rowcount > 0


def append_message(session_id: str, role: str, author: str, content: str) -> dict[str, object]:
    now = _now()
    with _connection() as connection:
        dialog_id = _ensure_dialog(connection, session_id)
        cursor = connection.execute(
            """
            INSERT INTO dialog_messages (dialog_id, role, author, content, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (dialog_id, role, author, content, now),
        )
        connection.execute(
            "UPDATE dialogs SET updated_at = ? WHERE id = ?",
            (now, dialog_id),
        )
        row = connection.execute(
            f"SELECT {_MESSAGE_COLUMNS} FROM dialog_messages WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return dict(row)


def list_messages(session_id: str, after_id: int = 0) -> list[dict[str, object]]:
    with _connection() as connection:
        rows = connection.execute(
            """
            SELECT m.id, m.role, m.author, m.content, m.created_at
            FROM dialog_messages AS m
            JOIN dialogs AS d ON d.id = m.dialog_id
            WHERE d.session_id = ? AND m.id > ?
            ORDER BY m.id
            """,
            (session_id, after_id),
        ).fetchall()
    return [dict(row) for row in rows]


def list_dialogs() -> list[dict[str, object]]:
    with _connection() as connection:
        rows = connection.execute(
            """
            SELECT d.session_id, d.mode, d.handoff_requested_at, d.created_at, d.updated_at,
                   (SELECT COUNT(*) FROM dialog_messages AS m WHERE m.dialog_id = d.id) AS messages_count,
                   (SELECT m.content FROM dialog_messages AS m
                    WHERE m.dialog_id = d.id ORDER BY m.id DESC LIMIT 1) AS last_message
            FROM dialogs AS d
            ORDER BY d.updated_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def create_lead(data: LeadCreate, status: str = "new") -> int:
    created_at = _now()
    with _connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO leads
                (created_at, question, name, contact, contact_type, status)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                data.question,
                data.name,
                data.contact,
                data.contact_type,
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


def list_leads() -> list[dict[str, object]]:
    with _connection() as connection:
        rows = connection.execute(
            """
            SELECT id, question, name, contact, contact_type, status, error, created_at
            FROM leads
            ORDER BY id DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_lead_detail(lead_id: int) -> dict[str, object] | None:
    with _connection() as connection:
        row = connection.execute(
            """
            SELECT id, question, name, contact, contact_type, status, error, created_at
            FROM leads
            WHERE id = ?
            """,
            (lead_id,),
        ).fetchone()
    return dict(row) if row is not None else None
