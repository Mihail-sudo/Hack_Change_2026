import logging
import time

import httpx

from app.config import Settings
from app.schemas import LeadCreate


logger = logging.getLogger(__name__)


class NotificationError(RuntimeError):
    pass


def telegram_configured(settings: Settings) -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_chat_id)


def _format_message(lead_id: int, data: LeadCreate) -> str:
    lines = [f"Новая заявка #{lead_id}", f"Вопрос: {data.question}"]
    if data.name:
        lines.append(f"Имя: {data.name}")
    lines.append(f"Контакт ({data.contact_type}): {data.contact}")
    return "\n".join(lines)


def send_lead_to_telegram(lead_id: int, data: LeadCreate, settings: Settings) -> None:
    if not telegram_configured(settings):
        raise NotificationError("telegram is not configured")

    url = (
        f"{settings.telegram_api_base.rstrip('/')}"
        f"/bot{settings.telegram_bot_token}/sendMessage"
    )
    payload = {
        "chat_id": settings.telegram_chat_id,
        "text": _format_message(lead_id, data),
        "disable_web_page_preview": True,
    }

    attempts = max(1, settings.lead_send_attempts)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            response = httpx.post(
                url,
                json=payload,
                timeout=settings.telegram_timeout_seconds,
            )
            if response.status_code >= 500 or response.status_code == 429:
                response.raise_for_status()
            if response.status_code >= 400:
                raise NotificationError(
                    f"telegram responded with {response.status_code}: {response.text[:200]}"
                )
            body = response.json()
            if not body.get("ok"):
                raise NotificationError(
                    f"telegram error: {body.get('description', 'unknown')}"
                )
            return
        except NotificationError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            if attempt == attempts:
                break
            delay = settings.lead_retry_backoff_seconds * (2 ** (attempt - 1))
            logger.warning(
                "Telegram delivery failed for lead %s (attempt %s/%s): %s",
                lead_id,
                attempt,
                attempts,
                exc,
            )
            time.sleep(delay)

    raise NotificationError(f"telegram delivery failed: {last_error}")
