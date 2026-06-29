"""Worker placement core (P6, Tier 2). Pure + unit-tested.

P1 spawns workers in-process. P6 adds the *placement* decision on top: given a
config and the current local load, where should the next delegated job run, here,
or burst to a remote worker tier? This is the platform-agnostic half: the
decision logic is real and tested. The remote tier itself (the autoscaling
compute that answers a burst) is infrastructure the operator provisions; this
module only decides when to use it and reports whether it's configured.

Config: {mode: 'local'|'auto'|'remote', remote_url: str|'', local_capacity: int}
  local   always run here (P1), ignore remote even if configured
  remote  always send to the remote tier (requires remote_url)
  auto    run here until local_capacity is full, then burst to remote if configured
"""

from __future__ import annotations

MODES = ("local", "auto", "remote")


def normalize_config(cfg: dict) -> dict:
    cfg = cfg if isinstance(cfg, dict) else {}
    mode = cfg.get("mode")
    if mode not in MODES:
        mode = "local"
    cap = cfg.get("local_capacity")
    cap = 4 if cap is None else int(cap)  # explicit 0 clamps to 1, not the default
    return {
        "mode": mode,
        "remote_url": str(cfg.get("remote_url") or "").strip(),
        "local_capacity": max(1, cap),
    }


def remote_available(cfg: dict) -> bool:
    return bool(normalize_config(cfg)["remote_url"])


def decide_placement(cfg: dict, local_running: int, queue_depth: int = 0) -> dict:
    """Where the next job should run. Returns {target: 'local'|'remote', reason,
    would_queue: bool}. 'remote' is only chosen when a remote_url is configured;
    otherwise we fall back to local (and the job may queue) rather than fail."""
    c = normalize_config(cfg)
    has_remote = bool(c["remote_url"])
    running = max(0, int(local_running or 0))

    if c["mode"] == "remote":
        if has_remote:
            return {"target": "remote", "reason": "mode=remote", "would_queue": False}
        return {"target": "local", "reason": "mode=remote but no remote_url; falling back", "would_queue": running >= c["local_capacity"]}

    if c["mode"] == "local":
        return {"target": "local", "reason": "mode=local", "would_queue": running >= c["local_capacity"]}

    # auto: stay local until full, then burst if we can.
    if running < c["local_capacity"]:
        return {"target": "local", "reason": f"auto: {running}/{c['local_capacity']} local slots used", "would_queue": False}
    if has_remote:
        return {"target": "remote", "reason": "auto: local full, bursting to remote", "would_queue": False}
    return {"target": "local", "reason": "auto: local full, no remote configured; will queue", "would_queue": True}


def cluster_status(cfg: dict, local_running: int, queue_depth: int) -> dict:
    c = normalize_config(cfg)
    return {
        "mode": c["mode"],
        "local_capacity": c["local_capacity"],
        "local_running": max(0, int(local_running or 0)),
        "queue_depth": max(0, int(queue_depth or 0)),
        "remote_configured": bool(c["remote_url"]),
        "next_placement": decide_placement(cfg, local_running, queue_depth)["target"],
    }
