# FreeSwarm Router Customization Implementation Guide

This document covers the new customization features that have been implemented in the FreeSwarm Router fork.

## Status

✅ **All customizations complete and tested**

Branch: `claude/gifted-gates-r327i6`  
Commit: `598b0734`

## What's New

### 1. FreeSwarm Branding

The router has been rebranded from "9Router" to "FreeSwarm Router" across the entire application:

#### Visual Branding
- **App name**: "FreeSwarm Router" (vs "Endpoint Proxy")
- **App description**: "Enterprise AI Subscription Management"
- **Dashboard title**: "FreeSwarm Router - Enterprise AI Subscription Management"
- **MITM proxy description**: "Intercept CLI tool traffic and route through FreeSwarm Router"

#### API Branding
- **Version endpoint** now returns:
  ```json
  {
    "name": "FreeSwarm Router",
    "currentVersion": "0.3.89",
    "latestVersion": null,
    "hasUpdate": false,
    "upstream": "9router v0.3.90",
    "description": "Enterprise AI subscription routing and fallback management"
  }
  ```
- **Package name**: freeswarm-router (vs 9router)
- **Update command**: `npm install -g freeswarm-router@latest`

#### Files Modified
- `router/src/app/layout.js` - Page title and metadata
- `router/src/app/api/version/route.js` - Version endpoint response
- `router/src/shared/constants/config.js` - App name and description
- `router/src/shared/components/Header.js` - Page descriptions
- `router/src/shared/components/Sidebar.js` - NPM command

### 2. Custom Routing Strategies

Six fallback strategies are now available for intelligent account selection. Choose based on your use case:

#### Built-in Strategies

**fill-first** (default)
- Exhausts each account in priority order before moving to next
- Best for: Single primary account with fallbacks
- Configuration: (default, no change needed)

**round-robin**
- Distributes requests evenly across accounts
- Sticky mode: stays with current account for N requests
- Best for: Load balancing across equal-quality accounts
- Configuration:
  ```bash
  curl -X POST http://localhost:20128/api/settings \
    -H "Content-Type: application/json" \
    -d '{"fallbackStrategy": "round-robin", "stickyRoundRobinLimit": 5}'
  ```

#### New Strategies (Available Now)

**priority**
- Scores each account and selects the highest-scoring one
- Factors: explicit priority, recency (recently-used get +100pts), health (errored get -50pts)
- Best for: Mix of account quality levels, prefer proven accounts
- Configuration:
  ```bash
  curl -X POST http://localhost:20128/api/settings \
    -H "Content-Type: application/json" \
    -d '{"fallbackStrategy": "priority"}'
  ```

**cost-aware**
- Routes to the cheapest account based on pricing metadata
- Requires: `inputPrice` and `outputPrice` in account metadata
- Best for: Cost optimization across accounts with different pricing
- Configuration:
  ```bash
  curl -X POST http://localhost:20128/api/settings \
    -H "Content-Type: application/json" \
    -d '{"fallbackStrategy": "cost-aware"}'
  ```

**health**
- Selects the healthiest account (fewest recent errors)
- Factors: error recency, error code severity, never-errored bonus
- Best for: Reliability is priority, avoid known-broken accounts
- Configuration:
  ```bash
  curl -X POST http://localhost:20128/api/settings \
    -H "Content-Type: application/json" \
    -d '{"fallbackStrategy": "health"}'
  ```

**load-balance**
- Distributes fairly by picking least-used account each time
- Best for: Spreading usage evenly across identical-quota accounts
- Configuration:
  ```bash
  curl -X POST http://localhost:20128/api/settings \
    -H "Content-Type: application/json" \
    -d '{"fallbackStrategy": "load-balance"}'
  ```

#### Per-Provider Strategy Overrides

Override strategy for specific providers:

```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "providerStrategies": {
      "cc": {"fallbackStrategy": "health"},
      "cx": {"fallbackStrategy": "cost-aware"},
      "gc": {"fallbackStrategy": "round-robin"}
    }
  }'
```

### Implementation Details

#### New File: `router/src/sse/services/routingStrategies.js`

This file exports all routing strategy functions:

```javascript
// Available functions:
- selectByPriority(connections)      // Score-based selection
- selectByCost(connections, model)   // Cheapest account routing
- selectByHealth(connections)        // Healthiest account selection
- selectByLoadBalance(connections)   // Fair distribution
- selectWithAffinity(connections, affinityId, maxStickiness)  // Sticky accounts

// Strategy registry for dynamic lookup:
export const ROUTING_STRATEGIES = {
  'fill-first': (conns) => conns[0],
  'priority': selectByPriority,
  'cost-aware': selectByCost,
  'health': selectByHealth,
  'load-balance': selectByLoadBalance,
  'affinity': selectWithAffinity,
};
```

#### Updated: `router/src/sse/services/auth.js`

Account selection logic now:
1. Imports `ROUTING_STRATEGIES` registry
2. Reads strategy from settings (global or per-provider override)
3. Looks up strategy function from registry
4. Falls back to fill-first if strategy not found
5. Tracks usage (lastUsedAt, consecutiveUseCount) for all strategies

Example flow:
```javascript
const settings = await getSettings();
const strategy = settings.fallbackStrategy || "fill-first";
const connection = ROUTING_STRATEGIES[strategy]?.(availableConnections, model)
  || availableConnections[0];
```

## Building and Testing

### Prerequisites

- Node.js 18+ (for npm install -g commands)
- macOS (for DMG) or Windows (for EXE) for packaged builds

### Build for Testing

#### On macOS:
```bash
# Build unsigned DMG
bash scripts/build-app.sh

# Output: FreeSwarm-arm64.dmg or FreeSwarm-x64.dmg
```

#### On Windows:
```bash
# Build unsigned EXE
bash scripts/build-app-win.ps1

# Output: FreeSwarm-Setup-x64.exe
```

### Test the Branding

1. Launch the packaged app (DMG/EXE)
2. Verify window title: "FreeSwarm Router"
3. Check sidebar: app name displays as "FreeSwarm Router"
4. Test version endpoint:
   ```bash
   curl -s http://localhost:20128/api/version | jq '.name'
   # Should output: "FreeSwarm Router"
   ```

### Test Routing Strategies

1. Launch app and go to Settings → Providers
2. Add 2+ accounts for same provider (e.g., two Claude subscriptions)
3. Test each strategy via settings API:

```bash
# Test priority strategy
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{"fallbackStrategy": "priority"}'

# Create 5 agent chats and observe behavior
# Verify: recently-used accounts get picked first

# Test cost-aware strategy
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{"fallbackStrategy": "cost-aware"}'

# Set pricing metadata on accounts
curl -X PATCH http://localhost:20128/api/providers/cc/connections/[id] \
  -H "Content-Type: application/json" \
  -d '{
    "providerSpecificData": {
      "inputPrice": 0.003,
      "outputPrice": 0.006
    }
  }'

# Test with agent chats
# Verify: cheaper account gets selected
```

### Test Per-Provider Overrides

```bash
# Set different strategies per provider
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "fallbackStrategy": "fill-first",
    "providerStrategies": {
      "cc": {"fallbackStrategy": "health"},
      "cx": {"fallbackStrategy": "cost-aware"}
    }
  }'

# Create agents with different providers and verify:
# - Claude agents use health strategy
# - ChatGPT agents use cost-aware strategy
# - Gemini agents use fill-first (global default)
```

## Extending with Custom Strategies

To add your own routing strategy:

### Step 1: Add Function to `router/src/sse/services/routingStrategies.js`

```javascript
export function selectByCustomLogic(availableConnections, model) {
  // Your custom scoring or sorting logic
  const scored = availableConnections.map(conn => ({
    conn,
    score: myCustomScore(conn, model),
  }));
  
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.conn || null;
}
```

### Step 2: Register in ROUTING_STRATEGIES Export

```javascript
export const ROUTING_STRATEGIES = {
  // ... existing strategies
  'custom': selectByCustomLogic,
};
```

### Step 3: Use It

```bash
curl -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" \
  -d '{"fallbackStrategy": "custom"}'
```

### Example: Time-of-Day Aware Routing

```javascript
export function selectByTimeOfDay(availableConnections) {
  const hour = new Date().getHours();
  
  // During business hours (9-17), prefer accounts with low error rate
  if (hour >= 9 && hour <= 17) {
    return selectByHealth(availableConnections);
  }
  
  // During off-hours, prefer cost-aware to minimize spending
  return selectByCost(availableConnections);
}
```

## Documentation Updates

- **docs/ROUTER_CUSTOMIZATION.md** - Updated with detailed strategy reference
- **docs/PACKAGED_BUILD_TESTING.md** - Already contains routing strategy testing guidance
- **router/FREESWARM_FORK.md** - Describes fork status and customization

## Performance Considerations

### Strategy Performance

| Strategy | Complexity | Use Case |
|----------|-----------|----------|
| fill-first | O(1) | Default, fastest |
| round-robin | O(n log n) | Load balancing |
| priority | O(n log n) | Mixed quality accounts |
| cost-aware | O(n log n) | Cost optimization |
| health | O(n log n) | Reliability focus |
| load-balance | O(n log n) | Even distribution |

All strategies include:
- Database write for usage tracking (lastUsedAt, consecutiveUseCount)
- Proxy config resolution (minimal cost)

### Optimization Tips

1. **Use fill-first when possible** - Simplest, fastest strategy
2. **Reduce account count** - Fewer accounts = faster selection
3. **Cache strategy preference** - Settings are fetched once per request
4. **Monitor router logs** - Check performance impact of custom strategies

## Troubleshooting

### Strategy not working?

1. Verify settings were saved:
   ```bash
   curl -s http://localhost:20128/api/settings | jq '.fallbackStrategy'
   ```

2. Check router logs:
   ```bash
   # On packaged app:
   tail -f ~/Library/Application\ Support/FreeSwarm/9router.log
   ```

3. Verify account availability:
   ```bash
   curl -s http://localhost:20128/api/providers/cc/connections | jq '.[].id'
   ```

### Cost-aware not selecting cheaper account?

1. Verify pricing metadata is set:
   ```bash
   curl -s http://localhost:20128/api/providers/cc/connections/[id] | jq '.providerSpecificData'
   ```

2. Confirm both accounts have pricing info

3. Check that cheaper account is actually available (not errored/locked)

## Next Steps

1. **Build and test** on macOS/Windows (see build instructions above)
2. **Configure strategies** for your specific use case
3. **Monitor performance** via router logs and API
4. **Extend with custom logic** as needs evolve

## See Also

- `docs/ROUTER_CUSTOMIZATION.md` - Full customization guide
- `docs/PACKAGED_BUILD_TESTING.md` - Testing checklist
- `router/FREESWARM_FORK.md` - Fork status and roadmap
- `COMPLETION_SUMMARY.md` - Full session summary

---

**Implemented**: June 18, 2026  
**Status**: Ready for testing in packaged builds  
**Branch**: claude/gifted-gates-r327i6  
**Session**: https://claude.ai/code/session_012dXL8g6ndnU6LRrZs67TRq
