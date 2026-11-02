from dataclasses import dataclass
from typing import Protocol

from openai import AsyncOpenAI

from app.config import Settings


@dataclass(frozen=True)
class LLMResult:
    text: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMClient(Protocol):
    async def complete(self, messages: list[dict[str, str]]) -> LLMResult: ...

    async def close(self) -> None: ...


class OpenAICompatibleClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.llm_api_key:
            raise ValueError("LLM API key is not configured")
        self._client = AsyncOpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout_seconds,
        )
        self._model = settings.llm_model
        self._temperature = settings.llm_temperature

    async def complete(self, messages: list[dict[str, str]]) -> LLMResult:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            temperature=self._temperature,
        )
        content = response.choices[0].message.content or ""
        usage = response.usage
        return LLMResult(
            text=content.strip(),
            model=response.model or self._model,
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
        )

    async def close(self) -> None:
        await self._client.close()


def build_llm_client(settings: Settings) -> LLMClient | None:
    if not settings.llm_configured:
        return None
    return OpenAICompatibleClient(settings)
