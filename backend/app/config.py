from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Hack Change 2026 API"
    app_version: str = "0.1.0"
    environment: str = "local"
    cors_origins: list[str] = ["*"]

    leads_db_path: Path = Path("backend/data/leads.db")

    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    telegram_api_base: str = "https://api.telegram.org"
    telegram_timeout_seconds: float = 10.0
    lead_send_attempts: int = 3
    lead_retry_backoff_seconds: float = 0.5


@lru_cache
def get_settings() -> Settings:
    return Settings()
