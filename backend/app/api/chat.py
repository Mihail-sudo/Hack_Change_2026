import logging
import random

# Временно отключено: настоящий агент вернётся, когда бэкенд будет готов к интеграции.
# from agent import respond as agent_respond
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.concurrency import run_in_threadpool

from app import db
from app.api.dependencies import get_session_store
from app.schemas import (
    SESSION_ID_PATTERN,
    ChatRequest,
    ChatResponse,
    HandoffRequest,
    HandoffResponse,
    MessagesRead,
    SessionRead,
    SessionResetRequest,
    SessionResetResponse,
)
from app.sessions import SessionStore, SessionStoreError


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

FALLBACK_REPLY = (
    "Извините, сейчас не получается ответить. "
    "Оставьте, пожалуйста, телефон, и менеджер свяжется с вами."
)


def _stub_respond(message: str, state: dict | None) -> dict:
    """Заглушка вместо агента: возвращает слова пользователя в случайном порядке."""
    words = message.split()
    random.shuffle(words)
    reply = " ".join(words)

    history = list((state or {}).get("history") or [])
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": reply})

    return {
        "reply": reply,
        "state": {"history": history, "done": False},
        "actions": [],
        "done": False,
    }


def append_history(state: dict | None, role: str, content: str) -> dict:
    """Дописать реплику в state.history (исключение из правила «чёрного ящика», контракт v0.4).

    В режиме оператора агент не вызывается, поэтому историю ведёт API — иначе после
    возврата диалога боту агент потеряет контекст разговора с оператором.
    """
    state = state or {}
    state.setdefault("history", []).append({"role": role, "content": content})
    return state


def _store_unavailable(session_id: str) -> HTTPException:
    logger.exception("Хранилище сессий недоступно в сессии %s", session_id)
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="session store is unavailable",
    )


@router.post("", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    store: SessionStore = Depends(get_session_store),
) -> ChatResponse:
    try:
        state = await store.get(payload.session_id)
    except SessionStoreError:
        raise _store_unavailable(payload.session_id)

    dialog = db.get_or_create_dialog(payload.session_id)
    db.append_message(payload.session_id, role="user", author="client", content=payload.message)

    if dialog["mode"] == "admin":
        new_state = append_history(state, "user", payload.message)
        try:
            await store.save(payload.session_id, new_state)
        except SessionStoreError:
            raise _store_unavailable(payload.session_id)
        return ChatResponse(reply="", done=False, mode="admin")

    try:
        result = await run_in_threadpool(_stub_respond, payload.message, state)
    except Exception:
        logger.exception("Агент упал в сессии %s", payload.session_id)
        db.append_message(
            payload.session_id, role="assistant", author="bot", content=FALLBACK_REPLY
        )
        return ChatResponse(reply=FALLBACK_REPLY, done=False, fallback=True)

    new_state = result.get("state")
    if not isinstance(new_state, dict):
        logger.error(
            "Агент вернул некорректное состояние в сессии %s: %r",
            payload.session_id,
            type(new_state),
        )
        db.append_message(
            payload.session_id, role="assistant", author="bot", content=FALLBACK_REPLY
        )
        return ChatResponse(reply=FALLBACK_REPLY, done=False, fallback=True)

    try:
        await store.save(payload.session_id, new_state)
    except SessionStoreError:
        raise _store_unavailable(payload.session_id)

    for action in result.get("actions") or []:
        logger.info(
            "Действие агента в сессии %s: %s",
            payload.session_id,
            action.get("type"),
        )

    reply = str(result.get("reply") or "")
    db.append_message(payload.session_id, role="assistant", author="bot", content=reply)
    return ChatResponse(reply=reply, done=bool(result.get("done")), mode="bot")


@router.post("/handoff", response_model=HandoffResponse)
def request_operator(payload: HandoffRequest) -> HandoffResponse:
    db.request_handoff(payload.session_id)
    return HandoffResponse()


@router.get("/{session_id}/messages", response_model=MessagesRead)
def get_messages(
    session_id: str = Path(
        min_length=8,
        max_length=128,
        pattern=SESSION_ID_PATTERN,
    ),
    after_id: int = Query(default=0, ge=0),
) -> MessagesRead:
    dialog = db.get_dialog(session_id)
    if dialog is None:
        return MessagesRead(session_id=session_id, mode="bot", messages=[])
    messages = db.list_messages(session_id, after_id)
    return MessagesRead(session_id=session_id, mode=dialog["mode"], messages=messages)


@router.get("/{session_id}", response_model=SessionRead)
async def get_session(
    session_id: str = Path(
        min_length=8,
        max_length=128,
        pattern=SESSION_ID_PATTERN,
    ),
    store: SessionStore = Depends(get_session_store),
) -> SessionRead:
    try:
        state = await store.get(session_id)
    except SessionStoreError:
        raise _store_unavailable(session_id)
    return SessionRead(session_id=session_id, state=state)


@router.post("/reset", response_model=SessionResetResponse)
async def reset_session(
    payload: SessionResetRequest,
    store: SessionStore = Depends(get_session_store),
) -> SessionResetResponse:
    try:
        await store.reset(payload.session_id)
    except SessionStoreError:
        raise _store_unavailable(payload.session_id)
    return SessionResetResponse()
