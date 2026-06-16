# FreeSwarm Router

This directory is **FreeSwarm Router**, FreeSwarm's fork of
[9router](https://github.com/decolua/9router) (MIT, Copyright (c) 2024-2026
decolua and contributors). The upstream MIT `LICENSE` is preserved in this
directory unchanged; this fork adds its own changes on top of it, it does not
replace the original license or attribution.

FreeSwarm Router is the smart LLM router / subscription proxy that powers
FreeSwarm: it exposes an OpenAI-compatible API on `localhost:20128/v1` and lets
users connect their Claude / ChatGPT / Gemini subscriptions (and API keys)
without FreeSwarm ever handling raw provider keys directly.

## Why the source lives here

The plan calls for owning the router as a first-class product so we can
customise it (rebrand, provider adapters, model discovery) rather than only
consuming the upstream npm build. This is the source-of-truth fork for that
work. It was vendored from upstream tag `v0.3.90` (package version `0.3.89`),
trimmed of docs-only weight (`gitbook/`, `images/`, `tests/`, translated
READMEs) to keep the tree reviewable.

## Relationship to the running app (read before "switching to the fork")

The backend supervises the router as a subprocess and pins a specific build:

- `scripts/fetch-router.sh` fetches `9router@0.3.60` (the **npm build**) at
  package time.
- `backend/apps/nine_router/` starts it on `:20128` and syncs keys/OAuth into it.
- `backend/apps/agents/providers/registry.py` encodes **version-specific**
  behaviour (e.g. "GPT-5.5's `cx/` entry 404s on 0.3.60", "re-add the gc/
  gemini-3.5-flash entry once 9Router is bumped past 0.3.60"). Model routing
  is genuinely sensitive to the exact router version.

Because of that, **the runtime still uses the pinned npm build (`0.3.60`).**
This fork (source `0.3.89`) is intentionally decoupled until a fork build is
produced and validated against `registry.py`'s known regressions (notably the
WebSearch-translation behaviour and the per-model 404s noted there).

### Path to make the fork the runtime

1. `cd router && npm install && npm run build` to produce the Next.js build.
2. Stage that build where `scripts/fetch-router.sh` currently drops the npm
   `app/` payload (adjust the script to copy from `router/` instead of npm).
3. Re-validate every row in `registry.py` against the fork build (provider
   OAuth connect, each `cc/ cx/ gc/ ag/ openrouter/` route, custom providers,
   WebSearch translation) in the **packaged** desktop build, not just `run.sh`.
4. Only then bump `NINE_ROUTER_NPM_VERSION` / the fetch source to the fork.

Until step 4 is done deliberately, do not point the runtime at this tree.
