# Feature expansion F1-F13

Thirteen account/productivity features layered on top of the device-code work,
spanning cloud (Vercel + Postgres), the desktop backend (FastAPI), and both
frontends (web account portal + desktop app). All additive; nothing existing was
changed in behavior.

## Cloud schema migration (required before these go live)

The new endpoints read tables added to `cloud/db/schema.sql`. Apply once per
deploy (idempotent, safe to re-run):

```bash
psql "$DATABASE_URL" -f cloud/db/schema.sql
```

New tables: `teams`, `team_members`, `shared_resources`, `cost_events`,
`audit_events`, `api_keys`, `webhooks`, `user_totp`, `org_settings`,
`notification_channels`, plus two columns on `refresh_tokens`
(`device_label`, `last_seen_at`).

## What shipped per feature

| # | Feature | Cloud | Backend | Frontend |
|---|---|---|---|---|
| F1 | Device/session management | `sessions` (via refresh_tokens) + `/api/sessions`, `/api/sessions/revoke` | - | Web account: Sessions tab (list + sign out a device) |
| F2 | Teams/collaboration | `teams`, `team_members` + `/api/teams`, `/api/teams/members` | - | Web account: Teams tab |
| F3 | Session sharing & export | `shared_resources` + `/api/share`, `/api/share/get` | `automation/export.py` renderers + `/api/automation/{export,share}` | Web account: Share tab (copy/revoke) |
| F4 | Advanced cost management | `cost_events` + `/api/cost/{ingest,summary}` | - | Web account: Cost tab (totals, per-day sparkline, top models) |
| F5 | Scheduled tasks & automation | - | `automation` SubApp: scheduler loop + CRUD + real agent launcher | Desktop: Automation page (scheduled tasks) |
| F6 | Activity & audit logs | `audit_events` + `/api/audit`; emitted by other endpoints | - | Web account: Activity tab |
| F7 | Advanced analytics | (cost aggregation by day/model) | - | Web account: Cost tab doubles as the analytics view |
| F8 | User management / RBAC | role checks on `/api/teams/members` (owner/admin/member) | - | Web account: Teams tab gates controls by role |
| F9 | API keys & webhooks | `api_keys`, `webhooks` + `/api/keys`, `/api/webhooks` | - | Web account: API keys tab |
| F10 | Agent templates & presets | - | `automation` templates store + CRUD; applied at scheduled launch | Desktop: Automation page (templates) |
| F11 | Advanced security (2FA) | `user_totp` + `/api/totp` (RFC 6238, `lib/totp.ts`, no new dep) | - | Web account: Security tab |
| F12 | Custom branding | `org_settings` + `/api/org/settings` | - | Web account: Branding tab |
| F13 | Notification integrations | `notification_channels` + `/api/notifications` | - | Web account: Notifications tab |

## Security notes

- API keys are stored as `sha256(key)`; the plaintext (`fs_live_...`) is shown
  once at creation and never again.
- Webhooks get an HMAC signing secret (`whsec_...`) so receivers can verify.
- TOTP secrets are base32; `confirmed` only flips after the first valid code, so
  a half-finished enrollment never locks anyone out.
- RBAC: only owners grant admin or change roles; admins can invite members; the
  server enforces this independently of the UI hiding controls.
- Branding accent color is validated to `#RRGGBB` and logo URL to `https://` to
  avoid style/URL injection in the portal.
- Session revoke also blacklists the token's `jti`, so it dies across surfaces.

## Tested

- Backend: `tests/test_automation.py` (13 cases): scheduling math, task/template
  CRUD, single-tick fire path, launcher-error resilience, transcript renderers.
- Cloud: `npm run typecheck` clean (pre-existing stripe-module warnings aside).
- Frontend: `tsc --noEmit` + `npm run build` clean.

## Producers + delivery (now wired)

The three "next step" gaps are closed:

- **Cost/audit producers (L1).** `backend/apps/telemetry/emitter.py` posts a
  per-turn cost DELTA to `/api/cost/ingest` (clamped >= 0, idempotent
  submission ids) and an `agent.run_completed` event to `/api/audit` on close.
  Fire-and-forget; no-op when signed out. Hooked at the agent loop's turn
  cost-finalized point. Tested: `tests/test_telemetry.py` (10 cases).
- **Webhook/notification delivery (L2).** `cloud/lib/dispatch.ts` fans an event
  out to every registered webhook (HMAC-SHA256 signed body,
  `X-FreeSwarm-Signature`) and notification channel (Slack `{text}`; email via
  optional `NOTIFY_EMAIL_WEBHOOK` relay). Per-target 4s timeout. Wired into the
  audit POST hub and share creation; the per-webhook `events` filter self-gates.
- **Share-transcript button (L3).** The chat header has a Share button:
  POST `/api/automation/share` -> copy a public link
  (`/api/share/view?token=`, an XSS-safe HTML transcript page) to the clipboard,
  with a transient "Link copied" / "Sign in to share" state.
