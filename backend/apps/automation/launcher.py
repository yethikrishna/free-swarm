"""Wires the automation scheduler (F5) to the real agent stack.

Kept separate from automation.py so that module stays a leaf (no agent imports).
`wire()` injects a launcher that, when a scheduled task fires, launches a fresh
agent (optionally from a saved template, F10) and sends it the task's prompt.
The import of agent_manager happens at fire-time, never at module load.
"""

from __future__ import annotations

import logging

from backend.apps.automation import store
from backend.apps.automation.automation import set_launcher

logger = logging.getLogger(__name__)


async def _launch_scheduled(task: dict) -> None:
    # Lazy import: automation must not pull the heavy agent stack at boot.
    from backend.apps.agents.agent_manager import agent_manager
    from backend.apps.agents.core.models import AgentConfig

    cfg_kwargs: dict = {"name": task.get("name") or "Scheduled task"}
    tpl = store.get_template(task["template_id"]) if task.get("template_id") else None
    if tpl:
        if tpl.get("system_prompt"):
            cfg_kwargs["system_prompt"] = tpl["system_prompt"]
        if tpl.get("model"):
            cfg_kwargs["model"] = tpl["model"]
        if tpl.get("tools"):
            cfg_kwargs["allowed_tools"] = tpl["tools"]

    session = await agent_manager.launch_agent(AgentConfig(**cfg_kwargs))
    prompt = task.get("prompt") or ""
    if prompt:
        await agent_manager.send_message(session.id, prompt, hidden=False)
    logger.info("scheduled task launched agent %s for task %s", session.id, task.get("id"))


def wire() -> None:
    """Register the real launcher. Called once from main after both apps load."""
    set_launcher(_launch_scheduled)
