"""Адаптер LLMClient для backend."""

from agent.state import new_state


class LLMClient:
    def __init__(self, system_prompt: str = ""):
        self.system_prompt = system_prompt

    def get_response(self, request: dict) -> dict:
        from agent.agent import respond

        session = request.get("session_state") or {}
        state = session.get("agent_state") if isinstance(session, dict) else None
        if state is None:
            state = new_state()
            state["history"] = [
                {"role": item["role"], "content": item["content"]}
                for item in request.get("messages", [])
                if item.get("role") in {"user", "assistant"} and isinstance(item.get("content"), str)
            ]
            if isinstance(session, dict):
                state["form_shown"] = bool(session.get("form_shown", False))
                if session.get("state") == "awaiting_contacts":
                    state["stage"] = "contacts"
        result = respond(request.get("new_message", ""), state, system_prompt=self.system_prompt)
        return {
            "reply": result["reply"],
            "sources": result["sources"],
            "action": result["action"],
            "session_state": result["state"],
        }
