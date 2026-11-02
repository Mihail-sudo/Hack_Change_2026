from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["user", "assistant"]
Mode = Literal["llm", "fallback"]


class ConsultationRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str | None = None
    top_k: int | None = Field(default=None, ge=1, le=10)


class Source(BaseModel):
    id: str
    title: str
    score: float


class ConsultationResponse(BaseModel):
    answer: str
    session_id: str
    model: str
    mode: Mode
    sources: list[Source]
    created_at: datetime


class Message(BaseModel):
    role: Role
    content: str
    created_at: datetime


class SessionResponse(BaseModel):
    id: str
    messages: list[Message]
    created_at: datetime
    updated_at: datetime


class KnowledgeSearchResponse(BaseModel):
    query: str
    results: list[Source]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    environment: str
    llm_configured: bool
    llm_model: str
    knowledge_articles: int
    active_sessions: int
