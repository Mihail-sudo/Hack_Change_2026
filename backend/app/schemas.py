from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


LeadStatus = Literal["new", "delivered", "failed"]
ContactType = Literal["email", "phone", "telegram", "other"]

SESSION_ID_PATTERN = r"^[A-Za-z0-9_-]{8,128}$"


class LeadCreate(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    name: str | None = Field(default=None, max_length=100)
    contact: str = Field(min_length=3, max_length=200)
    contact_type: ContactType = "other"

    @field_validator("question", "contact")
    @classmethod
    def _require_non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("name")
    @classmethod
    def _normalize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class LeadRead(BaseModel):
    id: int
    status: LeadStatus
    created_at: datetime


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128, pattern=SESSION_ID_PATTERN)
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def _require_non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ChatResponse(BaseModel):
    reply: str
    done: bool = False
    fallback: bool = False


class SessionResetRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128, pattern=SESSION_ID_PATTERN)


class SessionResetResponse(BaseModel):
    ok: bool = True


class SessionRead(BaseModel):
    session_id: str
    state: dict | None = None
