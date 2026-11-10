import logging
import random

# Временно отключено: настоящий агент вернётся, когда бэкенд будет готов к интеграции.
# from agent import respond as agent_respond
from fastapi import APIRouter, HTTPException, Path, Request, status
from fastapi.concurrency import run_in_threadpool

from app.schemas import (
    SESSION_ID_PATTERN,
    ChatRequest,
    ChatResponse,
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


def _store(request: Request) -> SessionStore:
    store = getattr(request.app.state, "session_store", None)
    if store is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is not initialized",
        )
    return store


@router.post("", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    store = _store(request)

    try:
        state = await store.get(payload.session_id)
    except SessionStoreError:
        logger.exception("Не удалось прочитать сессию %s", payload.session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is unavailable",
        )

    try:
        result = await run_in_threadpool(_stub_respond, payload.message, state)
    except Exception:
        logger.exception("Агент упал в сессии %s", payload.session_id)
        return ChatResponse(reply=FALLBACK_REPLY, done=False, fallback=True)

    new_state = result.get("state")
    if not isinstance(new_state, dict):
        logger.error(
            "Агент вернул некорректное состояние в сессии %s: %r",
            payload.session_id,
            type(new_state),
        )
        return ChatResponse(reply=FALLBACK_REPLY, done=False, fallback=True)

    try:
        await store.save(payload.session_id, new_state)
    except SessionStoreError:
        logger.exception("Не удалось сохранить сессию %s", payload.session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is unavailable",
        )

    for action in result.get("actions") or []:
        logger.info(
            "Действие агента в сессии %s: %s",
            payload.session_id,
            action.get("type"),
        )

    return ChatResponse(
        reply=str(result.get("reply") or ""),
        done=bool(result.get("done")),
    )


@router.get("/{session_id}", response_model=SessionRead)
async def get_session(
    request: Request,
    session_id: str = Path(
        min_length=8,
        max_length=128,
        pattern=SESSION_ID_PATTERN,
    ),
) -> SessionRead:
    store = _store(request)
    try:
        state = await store.get(session_id)
    except SessionStoreError:
        logger.exception("Не удалось прочитать сессию %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is unavailable",
        )
    return SessionRead(session_id=session_id, state=state)


@router.post("/reset", response_model=SessionResetResponse)
async def reset_session(
    payload: SessionResetRequest,
    request: Request,
) -> SessionResetResponse:
    store = _store(request)
    try:
        await store.reset(payload.session_id)
    except SessionStoreError:
        logger.exception("Не удалось сбросить сессию %s", payload.session_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is unavailable",
        )
    return SessionResetResponse()
