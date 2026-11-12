from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


LeadStatus = Literal["new", "delivered", "failed"]
ContactType = Literal["email", "phone", "telegram", "other"]
DialogMode = Literal["bot", "admin"]
MessageRole = Literal["user", "assistant"]
MessageAuthor = Literal["client", "bot", "admin"]

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
    mode: DialogMode = "bot"


class HandoffRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128, pattern=SESSION_ID_PATTERN)


class HandoffResponse(BaseModel):
    ok: bool = True


class MessageRead(BaseModel):
    id: int
    role: MessageRole
    author: MessageAuthor
    content: str
    created_at: datetime


class MessagesRead(BaseModel):
    session_id: str
    mode: DialogMode
    messages: list[MessageRead]


class DialogRead(BaseModel):
    session_id: str
    mode: DialogMode
    handoff_requested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    messages_count: int
    last_message: str | None = None


class DialogListResponse(BaseModel):
    dialogs: list[DialogRead]


class DialogDetailRead(BaseModel):
    session_id: str
    mode: DialogMode
    handoff_requested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    messages: list[MessageRead]


class DialogModeResponse(BaseModel):
    ok: bool = True
    mode: DialogMode


class AdminMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)

    @field_validator("content")
    @classmethod
    def _require_non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class LeadDetailRead(BaseModel):
    id: int
    question: str
    name: str | None
    contact: str
    contact_type: ContactType
    status: LeadStatus
    error: str | None
    created_at: datetime


class LeadListResponse(BaseModel):
    leads: list[LeadDetailRead]


class SessionResetRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128, pattern=SESSION_ID_PATTERN)


class SessionResetResponse(BaseModel):
    ok: bool = True


class SessionRead(BaseModel):
    session_id: str
    state: dict | None = None
