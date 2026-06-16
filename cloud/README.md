# freeswarm-cloud

The stateless cloud service both FreeSwarm apps already call at
`https://api.freeswarm.myndlabs.tech`. Handles **auth, subscription, billing,
and usage ingest**. Vercel serverless functions + Neon Postgres.

It does **not** run agents, fusion, or the 9router. Those are long-running /
WebSocket workloads that cannot run on Vercel serverless: they live on-device
(local app) and, if ever hosted for the web app, on a persistent server.

## Why this exists separately

The desktop backend (`/backend`) is a *thin client* for accounts: its
`auth/router.py` and `subscription/router.py` proxy to this service. The web
`/app` calls it directly from the browser. This repo is the other side of that
contract.

## Endpoints (contract the desktop already expects)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | Liveness + DB/auth config check |
| GET  | `/api/me` | Bearer -> `{ user_id, email, plan, status, expires, usage }` |
| POST | `/api/auth/signin-activate` | `{ token, signin_method, email }` -> profile + plan |
| POST | `/api/auth/dev-login` | `{ email }` -> `{ token }` (dev only, `ALLOW_DEV_LOGIN=1`) |
| GET  | `/api/auth/google` | OAuth start + callback (gated on `GOOGLE_*`) |
| POST | `/api/subscription/sync` | Bearer -> `{ plan, current_period_end, status, synced }` |
| POST | `/api/billing/portal` | Bearer -> `{ url }` (gated on `STRIPE_SECRET_KEY`) |
| POST | `/api/service/sync` | Usage ingest (web mode), idempotent |

Working today: health, dev-login, signin-activate, me, subscription/sync,
service/sync. Structured stubs (deploy green, return 501 until configured):
Google OAuth, Stripe billing.

## Deploy

1. **Neon**: create a free Postgres project, copy the pooled connection string.
   Apply the schema: `psql "$DATABASE_URL" -f db/schema.sql`
2. **Vercel**: new project with **Root Directory = `cloud`**. Add the env vars
   from `.env.example` (at minimum `DATABASE_URL` and `AUTH_SECRET`).
3. Point the domain `api.freeswarm.myndlabs.tech` at this Vercel project.
4. Verify: `curl https://api.freeswarm.myndlabs.tech/api/health` -> `status: ok`.

## Local test (no OAuth/Stripe needed)

```bash
export DATABASE_URL=...        # a Neon branch
export AUTH_SECRET=$(openssl rand -hex 32)
export ALLOW_DEV_LOGIN=1
psql "$DATABASE_URL" -f db/schema.sql
vercel dev
# mint a token, then call the contract:
curl -XPOST localhost:3000/api/auth/dev-login -d '{"email":"you@x.com"}' -H 'content-type: application/json'
curl localhost:3000/api/me -H "Authorization: Bearer <token>"
```

## Env

See `.env.example`. `DATABASE_URL` + `AUTH_SECRET` are required; everything else
unlocks an optional path (Google sign-in, Stripe billing, dev login).
