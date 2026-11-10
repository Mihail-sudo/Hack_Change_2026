from fastapi import APIRouter

from app.api import chat, health, leads


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(leads.router)
api_router.include_router(chat.router)
