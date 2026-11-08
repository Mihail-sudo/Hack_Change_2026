import logging

from fastapi import APIRouter, HTTPException, status

from app import db
from app.config import get_settings
from app.notifications import (
    NotificationError,
    send_lead_to_telegram,
    telegram_configured,
)
from app.schemas import LeadCreate, LeadRead


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leads", tags=["leads"])


@router.post("", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
def create_lead(payload: LeadCreate) -> LeadRead:
    lead_id = db.create_lead(payload)
    settings = get_settings()

    if not telegram_configured(settings):
        logger.warning("Lead %s stored, Telegram is not configured", lead_id)
    else:
        try:
            send_lead_to_telegram(lead_id, payload, settings)
        except NotificationError as exc:
            logger.warning("Lead %s stored, delivery failed: %s", lead_id, exc)
            db.update_lead_status(lead_id, "failed", str(exc)[:500])
        else:
            db.update_lead_status(lead_id, "delivered")

    lead = db.get_lead(lead_id)
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="lead persistence failed",
        )
    return LeadRead(**lead)
