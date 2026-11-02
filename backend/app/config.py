from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "LLM Consultant API"
    app_version: str = "0.1.0"
    environment: str = "development"

    llm_api_key: str | None = None
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = Field(default=0.2, ge=0, le=2)
    llm_timeout_seconds: float = Field(default=30.0, gt=0)

    max_history_messages: int = Field(default=12, ge=0, le=100)
    retrieval_top_k: int = Field(default=3, ge=1, le=10)
    knowledge_path: Path = Field(
        default=Path(__file__).resolve().parent.parent / "data" / "knowledge.json"
    )

    cors_origins: list[str] = ["*"]

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
