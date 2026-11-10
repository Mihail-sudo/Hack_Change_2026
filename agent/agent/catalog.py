"""Локальная база знаний EnergyTool для системного промпта."""

import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SERVICES_DIR = DATA_DIR / "services"
SHOP_FILE = DATA_DIR / "shop" / "shop_kb.md"
INVALID_CONTENT_MARKERS = (
    "The URL you requested has been blocked",
    "Web Page Blocked!",
    "You need to enable JavaScript to run this app",
)


def _read_valid(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        logger.warning("Пустой файл базы знаний пропущен: %s", path)
        return None
    if any(marker in text for marker in INVALID_CONTENT_MARKERS):
        logger.warning("Невалидная выгрузка базы знаний пропущена: %s", path)
        return None
    return text


@lru_cache(maxsize=1)
def load_catalog() -> str:
    """Собрать услуги и каталог магазина, исключив ошибочные выгрузки."""
    sections = []
    for path in sorted(SERVICES_DIR.glob("*.md")):
        text = _read_valid(path)
        if text:
            sections.append(text)

    if SHOP_FILE.exists():
        text = _read_valid(SHOP_FILE)
        if text:
            sections.append(text)

    if not sections:
        raise RuntimeError(f"Нет валидных данных для каталога в {DATA_DIR}")
    return "\n\n---\n\n".join(sections)
