# FreeSwarm Engineering Wiki

A developer map of the FreeSwarm codebase, grounded in real `file:line`
references. Built by a fleet of code-study agents. Read alongside the per-area
`CLAUDE.md` files (`backend/`, `frontend/`, `electron/`), which carry the
hard-won invariants.

## Sections

| # | Area | Status |
|---|------|--------|
| 01 | [Backend agent orchestration](01-backend-orchestration.md) | Complete |
| 02 | [Backend apps & services](02-backend-apps-services.md) (outputs/apps, service, subscription, tools_lib, modes, dashboards, skills) | Complete |
| 03 | [Backend core & security](03-backend-core-security.md) (main.py, auth, ssrf, lifespans, attack surface) | Complete |
| 04 | [Frontend architecture](04-frontend-architecture.md) (Main.tsx, AppShell, Redux, hooks, config) | Complete |
| 05 | [Frontend pages & canvas](05-frontend-pages-canvas.md) (Dashboard canvas, AgentChat, Views, overlays) | Complete |
| 06 | [Electron shell](06-electron-shell.md) (boot, backend spawn + watchdog, IPC, updater, deep links) | Complete |
| 07 | [Cloud & router](07-cloud-9router.md) (cloud service, 9router standalone vs packaged) | Complete |
| 08 | [Auth flows & intermixing gaps](08-auth-flows.md) (app vs web vs cloud, device logins, callbacks) | Complete |

All sections complete. The wiki is a comprehensive map of FreeSwarm's architecture grounded in file:line references.

## How this wiki was built

Domain-partitioned read-only study agents, each writing one section grounded in
`file:line` references, with explicit "Gotchas & invariants" and "Incomplete /
dead / TODO" subsections so the wiki doubles as a refactor backlog.

## Top open threads (from the completed sections + earlier surveys)

- **Auth surfaces are not yet cleanly separated** across desktop-app (local
  bearer token), web (cloud token), and cloud (OAuth/magic-link/Stripe). Needs
  section 08 before refactoring callbacks.
- **Backend attack-surface gaps** catalogued in section 03 (unvalidated
  `request.json` bodies, response size caps, a couple of resource-leak paths).
- **Apps/Views** has a legacy `/vibe-code` codegen endpoint that predates the
  current workspace-driven builder (section 02); keep but verify callers before
  any change.
