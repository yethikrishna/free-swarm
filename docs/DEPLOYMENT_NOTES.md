# Deployment Notes

## Critical: Cloud Schema Migration for Device-Code Flow

**When:** Before deploying device-code flow endpoints to production  
**What:** Apply the `device_codes` table schema to the cloud Postgres database  
**How:** Run this command on the cloud Postgres instance (e.g., Neon):

```bash
export DATABASE_URL="postgres://..."  # Your Neon connection string
psql "$DATABASE_URL" -f cloud/db/schema.sql
```

**Why:** The device-code flow (RFC 8628) introduced a new `device_codes` table to track short-lived device authorization codes. Without this schema, the following endpoints will fail:
- `POST /api/auth/device/code` — minting new codes
- `POST /api/auth/device/token` — polling for approval
- `POST /api/auth/device/approve` — web user approving a code  
- `GET /api/auth/device/info` — status checks

**Details:**
- Table: `device_codes` with columns for device_code, user_code, status, TTL, and poll tracking
- Indexes on `user_code` and `expires_at` for coarse lookups and TTL sweeping
- Idempotent schema: safe to run multiple times; `IF NOT EXISTS` guards all DDL

**Safe to run:** After every cloud deployment; will no-op if schema is already present.

---

## Device-Code Flow Implementation Summary

**Status:** ✅ Complete (committed to branch `claude/gifted-gates-r327i6`)

Implements RFC 8628 Device Authorization Grant for FreeSwarm account sign-in. Enables signing in on air-gapped or sandboxed desktops (WSL, remote SSH, locked-down VMs) by approving a short code from an already-signed-in browser on any machine.

### Surfaces Implemented

- **Cloud:** 4 new endpoints (code, token, approve, info) + device_codes table
- **Backend:** Device flow module with start/poll/cancel + in-memory flow tracking
- **Frontend desktop:** "Sign in with a code" panel in SignInDialog  
- **Frontend web:** /device approval page at `<origin>/device?code=XXXX-XXXX`

### Security Model

- Device code (32-byte secret) stays server-side; never exposed to renderer
- Short user code (XXXX-XXXX) is human-readable but useless without approval
- Tokens are audience-scoped (`aud=desktop`) and single-use (row deleted on redemption)
- No install-nonce needed (unlike localhost OAuth handoff); trust comes from signed-in user approving

### Testing

- 6 backend tests in `tests/test_device_flow.py` (all pass)
- Full tsc/webpack build verification on cloud, backend, and frontend
- Tested end-to-end flows: pending → approved → sign-in; denied; expired; offline recovery

### Documentation

- Full §7 "Device-code flow (FreeSwarm account)" in `docs/wiki/08-auth-flows.md`
- Cloud README updated with 5 new device endpoints
- Backend module docstrings on flow lifecycle

---

## Other Production Readiness Checks

- [ ] Verify all 5 device endpoints are deployed and reachable from production cloud domain
- [ ] Confirm `device_codes` table exists and has correct indexes (check with `psql`)
- [ ] Test full device flow in production: desktop → code → approval page → sign-in
- [ ] Monitor cloud logs for any errors on `/device/` endpoints
- [ ] Smoke test OAuth handoff still works (localhost POST fallback)
