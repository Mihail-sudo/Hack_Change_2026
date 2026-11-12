"""Публичный интерфейс агента из docs/contract.md."""

from agent.agent import respond
from agent.client import LLMClient
from agent.leads import build_lead

__all__ = ["respond", "build_lead", "LLMClient"]