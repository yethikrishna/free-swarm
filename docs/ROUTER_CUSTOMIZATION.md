# FreeSwarm Router Customization Guide

Now that the FreeSwarm Router fork is the primary runtime, you can customize it as a first-class product. This guide covers the main customization paths.

## Architecture Overview

The fork is a Next.js application with these key directories:

```
router/
├── app/                    # Next.js pages (dashboard, API routes)
│   ├── api/               # API endpoints (/v1/*, /api/*)
│   ├── dashboard/         # Web UI (not used by FreeSwarm backend)
│   └── ...
├── src/                   # Source code
│   ├── services/          # Provider logic, OAuth flows
│   ├── utils/             # Helpers (model registry, quota tracking)
│   └── ...
├── package.json           # Dependencies + build config
└── .next/standalone/router/  # Built output (used at runtime)
```

## Customization 1: Provider Adapters

A "provider adapter" handles connection setup, OAuth flow, and model discovery for a subscription service.

### Current Providers

- **cc/**: Claude via Claude Code subscription (OAuth)
- **cx/**: ChatGPT via Codex subscription (OAuth)  
- **gc/**: Gemini via Gemini CLI subscription (OAuth)
- **ag/**: Google Antigravity (custom OAuth via cloud)
- **openrouter/**: OpenRouter API-key routes

### Adding a New Provider

**Example: Add OpenAI Plus subscription (hypothetical)**

#### Step 1: Register the provider route

In `router/src/services/providers.ts` (or similar):

```typescript
// Define the provider node
const openaiPlusProvider = {
  prefix: "ox/",  // Route prefix
  name: "OpenAI Plus",
  type: "subscription",  // vs "api-key"
  oauth: {
    // OAuth endpoints
    device_code: "https://auth.openai.com/device",
    token_exchange: "https://auth.openai.com/token",
  },
  models: [
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-4", name: "GPT-4" },
    // ... all models available on Plus tier
  ],
};

// Register it
registerProvider("ox", openaiPlusProvider);
```

#### Step 2: Implement OAuth flow

In `router/src/services/oauth/openai-plus.ts`:

```typescript
import { startOAuth, pollOAuth } from './oauth-base';

export async function startOpenAIPlusOAuth() {
  return await startOAuth({
    provider: "openai-plus",
    deviceCodeUrl: "https://auth.openai.com/device",
    scope: "model.query",  // or whatever OpenAI Plus uses
  });
}

export async function pollOpenAIPlusAuth(deviceCode: string) {
  // Poll /token endpoint
  // Return { success, accessToken, refreshToken } or { success: false, error }
}
```

#### Step 3: Add model discovery

In `router/src/services/discovery/openai-plus.ts`:

```typescript
export async function discoverOpenAIPlusModels(accessToken: string) {
  const res = await fetch("https://api.openai.com/v1/plus/models", {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
  
  if (!res.ok) {
    throw new Error(`Failed to discover models: ${res.statusText}`);
  }
  
  const data = await res.json();
  return data.models.map((m: any) => ({
    id: m.id,
    name: m.display_name,
    context_window: m.context_length,
  }));
}
```

#### Step 4: Wire into FreeSwarm backend

Update `backend/apps/agents/providers/registry.py`:

```python
"OpenAI Plus": [
    {"value": "gpt-4-turbo-plus", "label": "GPT-4 Turbo (Plus)",
     "context_window": 128_000, "router_model_id": "ox/gpt-4-turbo",
     "api": "openai-plus", "subscription_only": True},
    # ... other Plus models
],
```

Also update `backend/apps/nine_router/sync.py` to sync new subscription connections:

```python
async def sync_openai_plus_subscription():
    # Similar pattern to sync_openai_api_key, but for subscription
    pass
```

### Testing a New Provider

1. **Local dev test:**
   ```bash
   cd router && npm run dev
   # Navigate to http://localhost:3000/dashboard
   # Test OAuth flow manually in dashboard UI
   ```

2. **Backend integration test:**
   ```bash
   # In Settings, verify the provider appears and can be connected
   # Test that models are discoverable and routable
   ```

3. **End-to-end test:**
   ```bash
   # Create an agent with a model from the new provider
   # Verify it routes correctly through `ox/model-id` to the provider
   ```

## Customization 2: Model Discovery

The router can customize which models are exposed from each provider.

### Discovery Strategy

Models come from two sources:

1. **Hardcoded registry** (fast, but manual maintenance):
   - `router/src/services/models/hardcoded.ts`
   - Used for stable, well-known models

2. **Live discovery** (auto-updated, but slower):
   - Calls provider API to fetch available models
   - Example: OpenRouter's /models endpoint

### Example: Add New Model to Hardcoded Registry

In `router/src/services/models/hardcoded.ts`:

```typescript
export const BUILTIN_MODELS = {
  "Claude": [
    { id: "cc/claude-opus-4-8", name: "Claude Opus 4.8", contextWindow: 1_000_000 },
    { id: "cc/claude-fable-5", name: "Claude Fable 5", contextWindow: 1_000_000 },
    // ADD NEW HERE:
    { id: "cc/claude-instant-4", name: "Claude Instant 4", contextWindow: 100_000 },
  ],
  // ... other providers
};
```

### Example: Override Live Discovery

For providers that expose hundreds of models, FreeSwarm can filter or re-rank them:

In `backend/apps/agents/providers/registry.py`:

```python
# Filter to only include production-ready models
def _should_expose_model(provider: str, model: dict) -> bool:
    # Skip experimental/beta models for stability
    if model.get("status") == "experimental":
        return False
    # Skip model variants already covered by defaults
    if "preview" in model["id"] and model["id"] in HIDDEN_PREVIEW_IDS:
        return False
    return True
```

## Customization 3: Branding

Rebrand the router as the FreeSwarm product.

### Visual Branding

**Update UI strings in the router dashboard:**

`router/app/dashboard/page.tsx`:

```typescript
export default function Dashboard() {
  return (
    <header>
      {/* Change from "9Router" to "FreeSwarm Router" */}
      <h1>FreeSwarm Router</h1>
      <p>Enterprise AI subscription routing</p>
    </header>
  );
}
```

**Update logo:**

Replace `router/public/9router-icon.png` with FreeSwarm branding.

### API Branding

**Update version endpoint:**

`router/app/api/version/route.ts`:

```typescript
export async function GET() {
  return Response.json({
    name: "FreeSwarm Router",
    version: "1.0.0-freeswarm",
    upstream: "9router v0.3.90",
  });
}
```

**Update User-Agent and server headers:**

In server config or middleware:

```typescript
headers: {
  "X-Powered-By": "FreeSwarm Router",
  "X-Router-Version": "1.0.0-freeswarm",
}
```

### Documentation Branding

Update all references in:

- `router/README.md` → FreeSwarm-specific docs
- `router/FREESWARM_FORK.md` → already done ✓
- Router dashboard help text
- Error messages

## Customization 4: Custom Routing Policies

FreeSwarm Router now supports multiple routing strategies for account selection. Built-in strategies are available; custom strategies can be added to extend router behavior.

### Available Strategies

The router now includes these fallback strategies (set via `settings.fallbackStrategy` or per-provider overrides):

1. **fill-first** (default)
   - Uses priority-ordered account list
   - Fills first account until exhausted, then fallback

2. **round-robin**
   - Distributes requests across all available accounts
   - Sticky mode: stays with current account for N consecutive uses
   - Configurable via `stickyRoundRobinLimit` (default: 3)

3. **priority** (NEW)
   - Selects account with highest priority score
   - Factors: explicit priority, recency, health, usage frequency
   - Prioritizes recently-used, error-free accounts

4. **cost-aware** (NEW)
   - Routes to cheapest available account
   - Uses pricing metadata in `providerSpecificData`
   - Falls back to first account if no pricing available

5. **health** (NEW)
   - Selects healthiest account (fewest recent errors)
   - Factors: error status, error age, error code severity
   - Avoids recently-failed accounts

6. **load-balance** (NEW)
   - Distributes fairly across all accounts
   - Picks least-used account each time
   - Useful for spreading load evenly

### Using Custom Strategies

Set via the settings API:

```bash
# Global fallback strategy
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "priority" }'

# Per-provider override (e.g., Claude provider)
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "providerStrategies": {
      "cc": { "fallbackStrategy": "cost-aware" }
    }
  }'
```

### Example: Custom Strategy Implementation

To add a new strategy, update `router/src/sse/services/routingStrategies.js`:

```javascript
export function selectByCustomLogic(availableConnections, model) {
  // Sort by your custom criteria
  const scored = availableConnections.map(conn => ({
    conn,
    score: calculateMyScore(conn, model),
  }));
  
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.conn || null;
}

// Add to ROUTING_STRATEGIES export
export const ROUTING_STRATEGIES = {
  // ... existing strategies
  'custom': selectByCustomLogic,
};
```

Then use it:

```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "custom" }'
```

### Strategy Reference Guide

#### fill-first (Default)

Simplest strategy. Uses the priority-ordered account list and exhausts each account before moving to the next.

**When to use:**
- Simple setups with one primary account
- Minimize context switching between accounts
- When one account is definitively more important than others

**Configuration:**
```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "fill-first" }'
```

#### round-robin

Distributes requests evenly across accounts. Stays with current account for N consecutive requests (sticky mode), then moves to least-recently-used account.

**When to use:**
- Load-balancing across multiple equal-quality accounts
- Spreading quota usage evenly
- Avoiding quota exhaustion on any single account

**Configuration:**
```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "fallbackStrategy": "round-robin",
    "stickyRoundRobinLimit": 5
  }'
```

#### priority

Scores each account and selects highest-scoring one. Scoring considers:
- Explicit priority value
- Recent usage (accounts used in last hour: +100pts)
- Error status (errored accounts: -50pts)
- Consecutive use count (5+ consecutive: +20pts)

**When to use:**
- Mix of account quality levels
- Want to prefer working accounts
- Age of account matters

**Configuration:**
```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "priority" }'
```

#### cost-aware

Routes to the cheapest account based on pricing metadata. Requires `inputPrice` and `outputPrice` in account's `providerSpecificData`.

**When to use:**
- Cost optimization across different accounts
- Different tiers/regions with different pricing
- Budget-conscious routing

**Configuration:**
```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "cost-aware" }'
```

**Provider metadata setup:**
```bash
curl -X PATCH http://localhost:20128/api/providers/cc/connections/[id] \
  -d '{
    "providerSpecificData": {
      "inputPrice": 0.003,
      "outputPrice": 0.006
    }
  }'
```

#### health

Selects healthiest account (fewest recent errors). Scoring considers:
- Recent error status (error in last hour: -80pts)
- Error code severity (5xx: -30pts, 4xx: -15pts)
- Never-errored accounts with usage: +20pts

**When to use:**
- Avoiding known-broken accounts
- Provider reliability is priority
- Prefer proven, stable accounts

**Configuration:**
```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "health" }'
```

#### load-balance

Distributes fairly across all accounts by picking least-used one each time. Similar to round-robin but simpler (no sticky mode).

**When to use:**
- Spreading usage as evenly as possible
- Accounts have identical quotas
- Maximum utilization across all accounts

**Configuration:**
```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "fallbackStrategy": "load-balance" }'
```

## Customization 5: Analytics & Monitoring

Add custom instrumentation to track router usage:

### Log Provider Switching

In `router/src/services/routing/fallback.ts`:

```typescript
async function executeWithFallback(
  primaryAccount: Account,
  fallbackAccounts: Account[],
  request: Request
) {
  try {
    return await dispatchRequest(primaryAccount, request);
  } catch (error) {
    if (isExhausted(error)) {
      logger.warn(`[FALLBACK] Primary ${primaryAccount.id} exhausted, switching`, {
        reason: error.message,
        primary: primaryAccount.id,
      });
      
      // Try fallbacks...
      for (const account of fallbackAccounts) {
        try {
          return await dispatchRequest(account, request);
        } catch (fbError) {
          logger.debug(`[FALLBACK] ${account.id} also failed`, { error: fbError });
        }
      }
    }
    throw error;  // All exhausted
  }
}
```

### Expose Metrics

Add Prometheus-style metrics endpoint:

`router/app/api/metrics/route.ts`:

```typescript
export async function GET() {
  const stats = getRouterStats();
  
  const metrics = `
# HELP freeswarm_router_requests_total Total requests
# TYPE freeswarm_router_requests_total counter
freeswarm_router_requests_total{provider="${stats.provider}"} ${stats.totalRequests}

# HELP freeswarm_router_fallbacks_total Fallback activations
# TYPE freeswarm_router_fallbacks_total counter
freeswarm_router_fallbacks_total{reason="exhausted"} ${stats.fallbacksExhausted}
  `.trim();
  
  return new Response(metrics, {
    headers: { "Content-Type": "text/plain" },
  });
}
```

## Build & Test Customizations

### Local testing

```bash
cd router
npm install  # First time only
npm run dev  # Start dev server on http://localhost:3000
```

### Packaged build

```bash
# After making changes, rebuild:
cd router && npm run build

# Then build the full packaged app:
bash scripts/build-app.sh  # (macOS) or build-app-win.ps1 (Windows)
```

### CI/CD considerations

When ready to ship customizations:

1. Tag the fork version: `git tag router-v1.0.0-freeswarm-custom`
2. Update `NINE_ROUTER_FORK_VERSION` in `process.py`
3. Rebuild and test packaged builds on both platforms
4. Publish tagged release for reproducibility

## Future Directions

- **Multi-region routing**: Route to provider's nearest region for latency
- **Usage-based billing**: Track per-account spending and alert on overage
- **A/B testing**: Route subset of queries through experimental providers
- **Webhook integrations**: Notify external systems on provider failures
- **Compliance**: Add request/response logging for compliance audits

## Resources

- **9router upstream**: https://github.com/decolua/9router
- **Next.js docs**: https://nextjs.org/docs
- **FreeSwarm router**: `./router/` (this repository)
- **Router test guide**: `docs/PACKAGED_BUILD_TESTING.md`

## Support

When customizing, keep these principles in mind:

1. **Backward compatibility**: Don't break existing `/v1` routes
2. **Error resilience**: Handle provider outages gracefully
3. **Performance**: Don't add blocking I/O in hot paths
4. **Testing**: Test customizations in packaged build, not just dev
5. **Documentation**: Update comments and guides as you customize

Happy customizing!
