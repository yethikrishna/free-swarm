"""Wires the coordination dispatcher (P1) to the real agent stack.

Kept separate so coordination.py stays a leaf (no agent imports). `wire()`
injects a launcher that, when a delegation is claimed, spawns a worker agent and
sends it the subtask. The worker reports back via
POST /api/coordination/tasks/{id}/complete. agent_manager is imported at
fire-time, never at module load.
"""

from __future__ import annotations

import logging
import time

from backend.apps.coordination import queue as q
from backend.apps.coordination.coordination import set_launcher

logger = logging.getLogger(__name__)


async def _launch_worker(task: dict) -> None:
    # Lazy import: coordination must not pull the heavy agent stack at boot.
    from backend.apps.agents.agent_manager import agent_manager
    from backend.apps.agents.core.models import AgentConfig

    cfg_kwargs: dict = {"name": f"Worker: {(task.get('subtask') or '')[:48]}"}
    if task.get("agent_type"):
        cfg_kwargs["mode"] = task["agent_type"]
    if task.get("required_tools"):
        cfg_kwargs["allowed_tools"] = list(task["required_tools"])

    session = await agent_manager.launch_agent(AgentConfig(**cfg_kwargs))
    q.assign_worker(task["id"], session.id, time.time())

    subtask = task.get("subtask") or ""
    # The worker is told how to report its result back to the parent's blackboard.
    prompt = (
        f"{subtask}\n\n"
        f"[delegated subtask {task['id']} from session {task.get('parent_session_id') or 'manager'}]\n"
        "When done, POST your result to /api/coordination/tasks/"
        f"{task['id']}/complete so the manager can aggregate it."
    )
    await agent_manager.send_message(session.id, prompt, hidden=False)
    logger.info("delegation %s launched worker %s", task.get("id"), session.id)


def wire() -> None:
    """Register the real launcher. Called once from main after both apps load."""
    set_launcher(_launch_worker)
