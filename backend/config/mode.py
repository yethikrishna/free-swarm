"""Web vs local runtime mode: the single source of truth for the product split.

FreeSwarm ships in two shapes from one codebase:

  - Local (desktop / dev): the backend runs on the user's own machine at
    127.0.0.1:8324. Nothing is logged or sent to the cloud. Auth and
    subscription are still validated against the production cloud (the
    desktop is a thin client for those), but no usage/telemetry leaves the
    device. This is the default mode.

  - Web (the /app deployment): the backend is hosted, so usage logging,
    analytics, and server-side accounting are turned on. Opt in by setting
    FREESWARM_WEB=1 in the hosted environment.

Gate any "only on the hosted web build" behavior on IS_WEB / analytics_enabled()
here rather than re-reading the env var in scattered call sites.
"""

import os

# Hosted web deployment. Default (unset) is the privacy-preserving local mode.
IS_WEB = os.environ.get("FREESWARM_WEB") == "1"

# Packaged desktop build (DMG/EXE) vs `bash run.sh` dev. Mirrors config/paths.py.
IS_PACKAGED = os.environ.get("FREESWARM_PACKAGED") == "1"

# Everything that isn't the hosted web build is "local" and stays silent.
IS_LOCAL = not IS_WEB


def analytics_enabled() -> bool:
    """Whether usage/telemetry may leave the machine at all.

    Local builds never log. The web build does (still subject to the user's
    in-app analytics opt-in, which is enforced separately in service/client)."""
    return IS_WEB
