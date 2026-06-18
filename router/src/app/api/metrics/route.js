/**
 * Prometheus-compatible metrics endpoint
 * Exposes router performance, routing, and reliability metrics
 *
 * Usage:
 *   curl http://localhost:20128/api/metrics
 *   # Feed to Prometheus, Grafana, DataDog, etc.
 */

import { getProviderConnections, getSettings } from "@/lib/localDb";

// In-memory metrics (extend to persistent store for production)
const metricsStore = {
  requests: {
    total: 0,
    by_provider: {},
    by_status: {},
    by_route: {},
  },
  routing: {
    strategy_selections: {},
    fallback_activations: 0,
    account_switches: 0,
  },
  provider_health: {
    connection_failures: {},
    model_lock_events: 0,
    quota_exhaustion: 0,
  },
  performance: {
    request_duration_ms: [],
    token_usage: {
      total_input: 0,
      total_output: 0,
    },
  },
};

/**
 * Track request execution
 * Call this after each request completes
 */
export function trackRequest(provider, status, durationMs, model = null, tokens = null) {
  metricsStore.requests.total += 1;

  // By provider
  if (!metricsStore.requests.by_provider[provider]) {
    metricsStore.requests.by_provider[provider] = 0;
  }
  metricsStore.requests.by_provider[provider] += 1;

  // By status
  if (!metricsStore.requests.by_status[status]) {
    metricsStore.requests.by_status[status] = 0;
  }
  metricsStore.requests.by_status[status] += 1;

  // By route (provider + model)
  if (model) {
    const route = `${provider}:${model}`;
    if (!metricsStore.requests.by_route[route]) {
      metricsStore.requests.by_route[route] = 0;
    }
    metricsStore.requests.by_route[route] += 1;
  }

  // Duration tracking
  metricsStore.performance.request_duration_ms.push(durationMs);
  // Keep last 1000 for percentile calculation
  if (metricsStore.performance.request_duration_ms.length > 1000) {
    metricsStore.performance.request_duration_ms.shift();
  }

  // Token tracking
  if (tokens) {
    metricsStore.performance.token_usage.total_input += tokens.input || 0;
    metricsStore.performance.token_usage.total_output += tokens.output || 0;
  }
}

/**
 * Track routing strategy selection
 */
export function trackRoutingStrategy(provider, strategy) {
  const key = `${provider}:${strategy}`;
  if (!metricsStore.routing.strategy_selections[key]) {
    metricsStore.routing.strategy_selections[key] = 0;
  }
  metricsStore.routing.strategy_selections[key] += 1;
}

/**
 * Track fallback activation
 */
export function trackFallback(provider, reason) {
  metricsStore.routing.fallback_activations += 1;

  // Could also track fallback reason if needed
  const reasonKey = `fallback_${reason}`;
  if (!metricsStore.provider_health[reasonKey]) {
    metricsStore.provider_health[reasonKey] = 0;
  }
  metricsStore.provider_health[reasonKey] += 1;
}

/**
 * Track account switch
 */
export function trackAccountSwitch(fromAccount, toAccount, reason) {
  metricsStore.routing.account_switches += 1;
}

/**
 * Track provider connection failure
 */
export function trackConnectionFailure(provider, connectionId, error) {
  const key = `${provider}:${connectionId}`;
  if (!metricsStore.provider_health.connection_failures[key]) {
    metricsStore.provider_health.connection_failures[key] = 0;
  }
  metricsStore.provider_health.connection_failures[key] += 1;
}

/**
 * Track model lock events
 */
export function trackModelLock(provider, model) {
  metricsStore.provider_health.model_lock_events += 1;
}

/**
 * Track quota exhaustion
 */
export function trackQuotaExhaustion(provider) {
  metricsStore.provider_health.quota_exhaustion += 1;
}

/**
 * Calculate percentiles for request duration
 */
function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((sorted.length * percentile) / 100) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Generate Prometheus metrics output
 */
async function generateMetrics() {
  const settings = await getSettings();
  const connections = await getProviderConnections();
  const activeConnections = connections.filter((c) => c.isActive).length;

  const durations = metricsStore.performance.request_duration_ms;
  const p50 = calculatePercentile(durations, 50);
  const p95 = calculatePercentile(durations, 95);
  const p99 = calculatePercentile(durations, 99);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  let output = "# HELP freeswarm_requests_total Total API requests processed\n";
  output += "# TYPE freeswarm_requests_total counter\n";
  output += `freeswarm_requests_total ${metricsStore.requests.total}\n\n`;

  // Requests by provider
  output += "# HELP freeswarm_requests_by_provider Requests per provider\n";
  output += "# TYPE freeswarm_requests_by_provider gauge\n";
  for (const [provider, count] of Object.entries(metricsStore.requests.by_provider)) {
    output += `freeswarm_requests_by_provider{provider="${provider}"} ${count}\n`;
  }
  output += "\n";

  // Requests by status
  output += "# HELP freeswarm_requests_by_status Requests per HTTP status\n";
  output += "# TYPE freeswarm_requests_by_status gauge\n";
  for (const [status, count] of Object.entries(metricsStore.requests.by_status)) {
    output += `freeswarm_requests_by_status{status="${status}"} ${count}\n`;
  }
  output += "\n";

  // Requests by route
  output += "# HELP freeswarm_requests_by_route Requests per provider:model route\n";
  output += "# TYPE freeswarm_requests_by_route gauge\n";
  for (const [route, count] of Object.entries(metricsStore.requests.by_route)) {
    const [provider, model] = route.split(":");
    output += `freeswarm_requests_by_route{provider="${provider}",model="${model}"} ${count}\n`;
  }
  output += "\n";

  // Routing metrics
  output += "# HELP freeswarm_fallback_activations Total fallback route activations\n";
  output += "# TYPE freeswarm_fallback_activations counter\n";
  output += `freeswarm_fallback_activations ${metricsStore.routing.fallback_activations}\n\n`;

  output += "# HELP freeswarm_account_switches Total account switches due to errors\n";
  output += "# TYPE freeswarm_account_switches counter\n";
  output += `freeswarm_account_switches ${metricsStore.routing.account_switches}\n\n`;

  // Routing strategy selections
  output += "# HELP freeswarm_strategy_selections Routing strategy selections\n";
  output += "# TYPE freeswarm_strategy_selections gauge\n";
  for (const [strategy, count] of Object.entries(metricsStore.routing.strategy_selections)) {
    const [provider, strat] = strategy.split(":");
    output += `freeswarm_strategy_selections{provider="${provider}",strategy="${strat}"} ${count}\n`;
  }
  output += "\n";

  // Connection health
  output += "# HELP freeswarm_connection_failures Provider connection failures\n";
  output += "# TYPE freeswarm_connection_failures gauge\n";
  for (const [key, count] of Object.entries(metricsStore.provider_health.connection_failures)) {
    const [provider, connId] = key.split(":");
    output += `freeswarm_connection_failures{provider="${provider}",connection="${connId}"} ${count}\n`;
  }
  output += "\n";

  output += "# HELP freeswarm_model_lock_events Total model rate-limit lock events\n";
  output += "# TYPE freeswarm_model_lock_events counter\n";
  output += `freeswarm_model_lock_events ${metricsStore.provider_health.model_lock_events}\n\n`;

  output += "# HELP freeswarm_quota_exhaustion_events Total quota exhaustion events\n";
  output += "# TYPE freeswarm_quota_exhaustion_events counter\n";
  output += `freeswarm_quota_exhaustion_events ${metricsStore.provider_health.quota_exhaustion}\n\n`;

  // Performance metrics
  output += "# HELP freeswarm_request_duration_ms Request latency in milliseconds\n";
  output += "# TYPE freeswarm_request_duration_ms gauge\n";
  output += `freeswarm_request_duration_ms{percentile="50"} ${p50.toFixed(2)}\n`;
  output += `freeswarm_request_duration_ms{percentile="95"} ${p95.toFixed(2)}\n`;
  output += `freeswarm_request_duration_ms{percentile="99"} ${p99.toFixed(2)}\n`;
  output += `freeswarm_request_duration_ms{percentile="avg"} ${avgDuration.toFixed(2)}\n\n`;

  // Token usage
  output += "# HELP freeswarm_tokens_input_total Total input tokens processed\n";
  output += "# TYPE freeswarm_tokens_input_total counter\n";
  output += `freeswarm_tokens_input_total ${metricsStore.performance.token_usage.total_input}\n\n`;

  output += "# HELP freeswarm_tokens_output_total Total output tokens processed\n";
  output += "# TYPE freeswarm_tokens_output_total counter\n";
  output += `freeswarm_tokens_output_total ${metricsStore.performance.token_usage.total_output}\n\n`;

  // System health
  output += "# HELP freeswarm_active_connections Active provider connections\n";
  output += "# TYPE freeswarm_active_connections gauge\n";
  output += `freeswarm_active_connections ${activeConnections}\n\n`;

  output += "# HELP freeswarm_total_connections Total configured connections\n";
  output += "# TYPE freeswarm_total_connections gauge\n";
  output += `freeswarm_total_connections ${connections.length}\n\n`;

  // Configuration
  output += "# HELP freeswarm_config_fallback_strategy Active fallback strategy\n";
  output += "# TYPE freeswarm_config_fallback_strategy gauge\n";
  output += `freeswarm_config_fallback_strategy{strategy="${settings.fallbackStrategy || "fill-first"}"} 1\n\n`;

  return output;
}

/**
 * GET /api/metrics - Prometheus-compatible metrics endpoint
 */
export async function GET() {
  try {
    const metrics = await generateMetrics();
    return new Response(metrics, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Metrics generation error:", error);
    return new Response(`# Error generating metrics: ${error.message}\n`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/**
 * POST /api/metrics/reset - Reset all metrics to zero (admin only)
 */
export async function POST(request) {
  // In production, add authorization check here
  if (request.headers.get("X-Reset-Metrics-Token") !== process.env.METRICS_RESET_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Reset all metrics
  for (const key in metricsStore) {
    if (typeof metricsStore[key] === "object") {
      Object.keys(metricsStore[key]).forEach((k) => {
        if (Array.isArray(metricsStore[key][k])) {
          metricsStore[key][k] = [];
        } else if (typeof metricsStore[key][k] === "number") {
          metricsStore[key][k] = 0;
        } else if (typeof metricsStore[key][k] === "object") {
          Object.keys(metricsStore[key][k]).forEach((innerK) => {
            metricsStore[key][k][innerK] = 0;
          });
        }
      });
    }
  }

  return Response.json({ message: "Metrics reset" });
}

// Export tracking functions for use throughout the router
export {
  trackRequest,
  trackRoutingStrategy,
  trackFallback,
  trackAccountSwitch,
  trackConnectionFailure,
  trackModelLock,
  trackQuotaExhaustion,
};
