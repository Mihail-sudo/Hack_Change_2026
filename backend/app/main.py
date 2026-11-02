from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, AsyncIterator

from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.models import (
    ConsultationRequest,
    ConsultationResponse,
    HealthResponse,
    KnowledgeSearchResponse,
    SessionResponse,
)
from app.services import ConsultantService, SessionNotFoundError


def _load_knowledge_path(settings: Settings) -> Path:
    configured = settings.knowledge_path
    if configured.exists():
        return configured
    return Path(__file__).resolve().parent.parent / "data" / "knowledge.json"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings = settings.model_copy(update={"knowledge_path": _load_knowledge_path(settings)})

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.consultant = ConsultantService(settings)
        try:
            yield
        finally:
            await application.state.consultant.close()

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Прототип backend для LLM-консультанта с поиском по базе знаний.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def consultant(request: Request) -> ConsultantService:
        return request.app.state.consultant

    @application.get("/", tags=["meta"])
    def root() -> dict[str, str]:
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
            "health": "/health",
        }

    @application.get("/health", response_model=HealthResponse, tags=["meta"])
    def health(request: Request) -> HealthResponse:
        service = consultant(request)
        return HealthResponse(
            status="ok",
            environment=settings.environment,
            llm_configured=settings.llm_configured,
            llm_model=settings.llm_model,
            knowledge_articles=service.knowledge.size,
            active_sessions=service.sessions.count(),
        )

    @application.post(
        "/api/v1/consultations",
        response_model=ConsultationResponse,
        tags=["consultant"],
    )
    async def consult(payload: ConsultationRequest, request: Request) -> ConsultationResponse:
        try:
            return await consultant(request).consult(payload)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found") from exc

    @application.post(
        "/api/v1/sessions",
        response_model=SessionResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["sessions"],
    )
    def create_session(request: Request) -> SessionResponse:
        return consultant(request).sessions.create()

    @application.get(
        "/api/v1/sessions/{session_id}",
        response_model=SessionResponse,
        tags=["sessions"],
    )
    def get_session(session_id: str, request: Request) -> SessionResponse:
        try:
            return consultant(request).sessions.get(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found") from exc

    @application.delete(
        "/api/v1/sessions/{session_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["sessions"],
    )
    def delete_session(session_id: str, request: Request) -> Response:
        try:
            consultant(request).sessions.delete(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get(
        "/api/v1/knowledge/search",
        response_model=KnowledgeSearchResponse,
        tags=["knowledge"],
    )
    def search_knowledge(
        request: Request,
        q: Annotated[str, Query(min_length=1, max_length=500)],
        top_k: Annotated[int, Query(ge=1, le=10)] = 3,
    ) -> KnowledgeSearchResponse:
        hits = consultant(request).knowledge.search(q, top_k=top_k)
        return KnowledgeSearchResponse(
            query=q,
            results=[hit.document.to_source(hit.score) for hit in hits],
        )

    return application


app = create_app()
