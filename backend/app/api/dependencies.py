from fastapi import HTTPException, Request, status

from app.sessions import SessionStore


def get_session_store(request: Request) -> SessionStore:
    store = getattr(request.app.state, "session_store", None)
    if store is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="session store is not initialized",
        )
    return store
