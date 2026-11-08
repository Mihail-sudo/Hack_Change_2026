from fastapi import APIRouter

from app.config import get_settings


router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> dict[str, str]:
    settings = get_settings()
    return {
        "status": "ok",
        "environment": settings.environment,
        "version": settings.app_version,
    }
