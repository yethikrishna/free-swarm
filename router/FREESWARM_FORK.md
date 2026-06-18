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

## Status: Fork is now the runtime

The FreeSwarm Router fork is now the **primary runtime default** (as of commit 75e6538a). The backend supervises the router as a subprocess:

- `scripts/fetch-router.sh` now copies the **fork build** (from `.next/standalone/router/`) at package time.
- `backend/apps/nine_router/` starts it on `:20128` and syncs keys/OAuth into it.
- `backend/apps/agents/providers/registry.py` documents version-specific behavior for fork v0.3.90 (which fixes several 0.3.60 regressions):
  - GPT-5.5 now available via `cx/` Codex subscription route (was 404 on 0.3.60)
  - Gemini 3.5 Flash now available via `gc/` Gemini CLI subscription route (was 404 on 0.3.60)
  - Fable-5 now available via `cc/` Claude subscription route

### Build and deployment

**For dev mode:**
1. `cd router && npm install && npm run build` to produce `.next/standalone/router/`
2. Backend detects and starts the fork automatically
3. Fallback: if fork not built, dev mode falls back to npm 0.3.60 package (for convenience)

**For packaged builds:**
1. Build runs `scripts/fetch-router.sh <dest_dir>` which copies fork build
2. Packaged app includes the fork at its designated location
3. Backend starts it on port `:20128` as subprocess

### Known constraints (inherited from v0.3.90)

The fork is based on upstream 9router v0.3.90 (package v0.3.89). It still carries these constraints from that release:

- WebSearch regression: cross-provider delegation may report unavailability or hallucinate
- `max_tokens` → `max_completion_tokens` translation needed for GPT-5 models
  - Handled by `backend/apps/agents/9router_gpt5_patch.js` loaded via `node --require`
  - Does NOT affect fork directly; patch still needed for v0.3.90

To eliminate these constraints, the fork would need to be upgraded past v0.3.90 but this requires:
- Porting 9Router's v0.4.x API auth to `backend/apps/nine_router/{oauth,sync}.py`
- Re-validating WebSearch translation behavior
- Testing provider OAuth flows (cc/ Claude, cx/ Codex, gc/ Gemini CLI, ag/ Antigravity)

### Customization roadmap

Now that the fork is the runtime, future customizations become viable:

- **Provider adapters**: Add/modify subscription providers without upstream release cycle
- **Model discovery**: Customize model registry per FreeSwarm's routing needs
- **Branding**: Rebrand UI/API as FreeSwarm-owned product (logo, name, docs)
- **Auth flows**: Custom OAuth handlers for enterprise integrations
- **Analytics**: Track usage patterns specific to FreeSwarm's multi-account model
