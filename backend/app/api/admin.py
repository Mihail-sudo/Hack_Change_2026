"""Админ-панель оператора: список диалогов, перехват управления, реплики оператора, лиды.

Контракт v0.4, раздел 3. Пока без авторизации (MVP): эндпоинты лежат под /admin
и закрыты токеном до выката наружу.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app import db
from app.api.chat import append_history
from app.api.dependencies import get_session_store
from app.schemas import (
    SESSION_ID_PATTERN,
    AdminMessageCreate,
    DialogDetailRead,
    DialogListResponse,
    DialogModeResponse,
    LeadDetailRead,
    LeadListResponse,
    MessageRead,
)
from app.sessions import SessionStore, SessionStoreError


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_SESSION_ID = Path(
    min_length=8,
    max_length=128,
    pattern=SESSION_ID_PATTERN,
)


def _dialog_or_404(session_id: str) -> dict:
    dialog = db.get_dialog(session_id)
    if dialog is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="dialog not found",
        )
    return dialog


@router.get("/dialogs", response_model=DialogListResponse)
def list_dialogs() -> DialogListResponse:
    return DialogListResponse(dialogs=db.list_dialogs())


@router.get("/dialogs/{session_id}", response_model=DialogDetailRead)
def get_dialog(
    session_id: str = _SESSION_ID,
    after_id: int = Query(default=0, ge=0),
) -> DialogDetailRead:
    dialog = _dialog_or_404(session_id)
    messages = db.list_messages(session_id, after_id)
    return DialogDetailRead(
        session_id=dialog["session_id"],
        mode=dialog["mode"],
        handoff_requested_at=dialog["handoff_requested_at"],
        created_at=dialog["created_at"],
        updated_at=dialog["updated_at"],
        messages=messages,
    )


@router.post("/dialogs/{session_id}/takeover", response_model=DialogModeResponse)
def takeover_dialog(session_id: str = _SESSION_ID) -> DialogModeResponse:
    if not db.set_dialog_mode(session_id, "admin"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="dialog not found",
        )
    return DialogModeResponse(mode="admin")


@router.post("/dialogs/{session_id}/release", response_model=DialogModeResponse)
def release_dialog(session_id: str = _SESSION_ID) -> DialogModeResponse:
    if not db.set_dialog_mode(session_id, "bot"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="dialog not found",
        )
    return DialogModeResponse(mode="bot")


@router.post("/dialogs/{session_id}/messages", response_model=MessageRead)
async def send_admin_message(
    payload: AdminMessageCreate,
    session_id: str = _SESSION_ID,
    store: SessionStore = Depends(get_session_store),
) -> MessageRead:
    dialog = _dialog_or_404(session_id)
    if dialog["mode"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="dialog is not taken over by admin",
        )

    try:
        state = await store.get(session_id)
    except SessionStoreError:
        logger.exception("Не удалось прочитать сессию %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is unavailable",
        )

    new_state = append_history(state, "assistant", payload.content)
    try:
        await store.save(session_id, new_state)
    except SessionStoreError:
        logger.exception("Не удалось сохранить сессию %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is unavailable",
        )

    message = db.append_message(
        session_id,
        role="assistant",
        author="admin",
        content=payload.content,
    )
    return MessageRead(**message)


@router.get("/leads", response_model=LeadListResponse)
def list_leads() -> LeadListResponse:
    return LeadListResponse(leads=db.list_leads())


@router.get("/leads/{lead_id}", response_model=LeadDetailRead)
def get_lead(lead_id: int) -> LeadDetailRead:
    lead = db.get_lead_detail(lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="lead not found",
        )
    return LeadDetailRead(**lead)
