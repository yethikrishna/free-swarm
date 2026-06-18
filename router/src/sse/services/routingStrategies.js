/**
 * Custom routing strategies for account selection.
 * These complement the built-in "fill-first" and "round-robin" strategies.
 */

/**
 * Priority-based routing: selects account with highest priority score
 * Factors: explicit priority, account age, usage frequency, health status
 */
export function selectByPriority(availableConnections) {
  if (availableConnections.length === 0) return null;

  const scored = availableConnections.map(conn => {
    let score = conn.priority || 0;

    // Bonus for recently used accounts (suggests they're working)
    if (conn.lastUsedAt) {
      const lastUsedMs = new Date(conn.lastUsedAt).getTime();
      const nowMs = Date.now();
      const recencyHours = (nowMs - lastUsedMs) / (1000 * 60 * 60);

      if (recencyHours < 1) score += 100;       // Used in last hour: +100
      else if (recencyHours < 24) score += 50;  // Used today: +50
      else if (recencyHours < 168) score += 25; // Used this week: +25
    } else {
      // Never used accounts get a slight penalty
      score -= 10;
    }

    // Penalty for errored accounts
    if (conn.lastError) {
      score -= 50;
    }

    // Bonus for accounts with lower error rate (estimated from consecutiveUseCount)
    if (conn.consecutiveUseCount && conn.consecutiveUseCount > 5) {
      score += 20;
    }

    return { conn, score };
  });

  // Sort by score descending and return top account
  scored.sort((a, b) => b.score - a.score);
  return scored[0].conn;
}

/**
 * Cost-aware routing: selects cheapest account based on token pricing
 * Requires pricing metadata in connection providerSpecificData
 */
export function selectByCost(availableConnections, model = null) {
  if (availableConnections.length === 0) return null;

  // If only one connection or pricing info unavailable, fall back to priority
  if (availableConnections.length === 1) {
    return availableConnections[0];
  }

  const withCost = availableConnections
    .map(conn => {
      // Try to get pricing from providerSpecificData
      const inputPrice = conn.providerSpecificData?.inputPrice || 0;
      const outputPrice = conn.providerSpecificData?.outputPrice || 0;

      // Cost per 1M tokens (typical pricing unit)
      const costPer1M = inputPrice + (outputPrice * 2); // Assume 2x output multiplier

      return { conn, costPer1M };
    })
    .filter(({ costPer1M }) => costPer1M >= 0) // Only include accounts with valid pricing
    .sort((a, b) => a.costPer1M - b.costPer1M);

  // If no accounts have pricing info, fall back to first available
  if (withCost.length === 0) {
    return availableConnections[0];
  }

  // Return cheapest account
  return withCost[0].conn;
}

/**
 * Health-aware routing: selects healthiest account
 * Factors: error status, consecutive failures, last error time
 */
export function selectByHealth(availableConnections) {
  if (availableConnections.length === 0) return null;

  const scored = availableConnections.map(conn => {
    let score = 100; // Start with perfect health

    // Check for recent errors
    if (conn.lastError) {
      const lastErrorMs = conn.lastErrorAt
        ? new Date(conn.lastErrorAt).getTime()
        : Date.now();
      const errorAgeHours = (Date.now() - lastErrorMs) / (1000 * 60 * 60);

      if (errorAgeHours < 1) score -= 80;       // Error in last hour
      else if (errorAgeHours < 24) score -= 40; // Error today
      else if (errorAgeHours < 168) score -= 20; // Error this week
      else score -= 5;                            // Old error, mostly recovered
    }

    // Check error code severity
    if (conn.errorCode) {
      if (conn.errorCode >= 500) score -= 30; // Server error: serious
      else if (conn.errorCode >= 400) score -= 15; // Client error: moderate
    }

    // Bonus for never-errored accounts
    if (!conn.lastError && conn.lastUsedAt) {
      score += 20;
    }

    return { conn, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].conn;
}

/**
 * Load-balanced routing: distributes fairly across all accounts
 * Similar to round-robin but with equal opportunities regardless of usage history
 */
export function selectByLoadBalance(availableConnections) {
  if (availableConnections.length === 0) return null;

  // Sort by usage count (ascending) to pick least-used
  const sorted = [...availableConnections].sort((a, b) => {
    const countA = a.consecutiveUseCount || 0;
    const countB = b.consecutiveUseCount || 0;
    return countA - countB;
  });

  return sorted[0];
}

/**
 * Affinity routing: sticky to one account until it fails
 * Useful for stateful providers or maintaining connection pools
 */
export function selectWithAffinity(availableConnections, affinityId = null, maxStickiness = 10) {
  if (availableConnections.length === 0) return null;

  // If affinity ID provided and account still available, use it
  if (affinityId) {
    const sticky = availableConnections.find(c => c.id === affinityId);
    const count = sticky?.consecutiveUseCount || 0;

    if (sticky && count < maxStickiness) {
      return sticky;
    }
  }

  // Otherwise pick first (highest priority) account
  return availableConnections[0];
}

/**
 * Export all strategies as a registry
 */
export const ROUTING_STRATEGIES = {
  'fill-first': (conns) => conns[0], // Built-in: already sorted by priority
  'priority': selectByPriority,
  'cost-aware': selectByCost,
  'health': selectByHealth,
  'load-balance': selectByLoadBalance,
  'affinity': selectWithAffinity,
};
