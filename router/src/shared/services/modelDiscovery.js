/**
 * Model Discovery Service
 *
 * Manages model catalog from two sources:
 * 1. Hardcoded registry (static, fast, manually maintained)
 * 2. Live discovery (dynamic, slow, auto-updated)
 *
 * Supports:
 * - Per-provider discovery strategy
 * - Model filtering and re-ranking
 * - Caching and refresh
 * - Fallback handling
 */

/**
 * Hardcoded Model Registry
 * Fast, reliable models that don't change frequently
 * Update when new stable models are released
 */
export const HARDCODED_MODELS = {
  // Claude subscription (cc/ prefix)
  claude: [
    {
      id: "cc/claude-opus-4-8",
      name: "Claude Opus 4.8",
      provider: "Anthropic",
      contextWindow: 200000,
      inputPrice: 0.015,
      outputPrice: 0.075,
      capabilities: ["reasoning", "vision", "analysis"],
      released: "2025-06-01",
    },
    {
      id: "cc/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "Anthropic",
      contextWindow: 200000,
      inputPrice: 0.003,
      outputPrice: 0.015,
      capabilities: ["reasoning", "vision", "fast"],
      released: "2024-12-01",
    },
    {
      id: "cc/claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      provider: "Anthropic",
      contextWindow: 200000,
      inputPrice: 0.0008,
      outputPrice: 0.004,
      capabilities: ["fast", "lightweight"],
      released: "2024-10-01",
    },
    {
      id: "cc/claude-fable-5",
      name: "Claude Fable 5",
      provider: "Anthropic",
      contextWindow: 1000000,
      inputPrice: 0.0008,
      outputPrice: 0.004,
      capabilities: ["reasoning", "very-long-context"],
      released: "2025-01-01",
    },
  ],

  // OpenAI Codex subscription (cx/ prefix)
  codex: [
    {
      id: "cx/gpt-5-5",
      name: "GPT-5.5",
      provider: "OpenAI",
      contextWindow: 200000,
      inputPrice: 0.02,
      outputPrice: 0.06,
      capabilities: ["reasoning", "advanced"],
      released: "2025-06-01",
    },
    {
      id: "cx/gpt-5-4",
      name: "GPT-5.4",
      provider: "OpenAI",
      contextWindow: 200000,
      inputPrice: 0.015,
      outputPrice: 0.045,
      capabilities: ["reasoning", "stable"],
      released: "2025-03-01",
    },
    {
      id: "cx/gpt-4-turbo",
      name: "GPT-4 Turbo",
      provider: "OpenAI",
      contextWindow: 128000,
      inputPrice: 0.01,
      outputPrice: 0.03,
      capabilities: ["analysis", "stable"],
      released: "2023-11-01",
    },
    {
      id: "cx/gpt-4",
      name: "GPT-4",
      provider: "OpenAI",
      contextWindow: 8192,
      inputPrice: 0.03,
      outputPrice: 0.06,
      capabilities: ["reasoning"],
      released: "2023-03-01",
    },
  ],

  // Gemini CLI subscription (gc/ prefix)
  gemini: [
    {
      id: "gc/gemini-3-5-flash",
      name: "Gemini 3.5 Flash",
      provider: "Google",
      contextWindow: 1000000,
      inputPrice: 0.00075,
      outputPrice: 0.003,
      capabilities: ["fast", "vision", "very-long-context"],
      released: "2025-05-01",
    },
    {
      id: "gc/gemini-2-0-pro",
      name: "Gemini 2.0 Pro",
      provider: "Google",
      contextWindow: 1000000,
      inputPrice: 0.01,
      outputPrice: 0.04,
      capabilities: ["reasoning", "vision"],
      released: "2024-12-01",
    },
    {
      id: "gc/gemini-1-5-pro",
      name: "Gemini 1.5 Pro",
      provider: "Google",
      contextWindow: 1000000,
      inputPrice: 0.00375,
      outputPrice: 0.015,
      capabilities: ["reasoning", "vision"],
      released: "2024-02-01",
    },
  ],

  // OpenRouter API key
  openrouter: [
    {
      id: "openrouter/anthropic/claude-opus-4-8",
      name: "Claude Opus 4.8 (via OpenRouter)",
      provider: "Anthropic",
      contextWindow: 200000,
      inputPrice: 0.015,
      outputPrice: 0.075,
      capabilities: ["reasoning"],
      released: "2025-06-01",
    },
    {
      id: "openrouter/openai/gpt-4-turbo",
      name: "GPT-4 Turbo (via OpenRouter)",
      provider: "OpenAI",
      contextWindow: 128000,
      inputPrice: 0.01,
      outputPrice: 0.03,
      capabilities: ["analysis"],
      released: "2023-11-01",
    },
  ],
};

/**
 * Discovery strategies per provider
 * Determines how to fetch available models
 */
export const DISCOVERY_STRATEGIES = {
  // Subscription-based: Live discovery from OAuth connection
  claude: {
    type: "live",
    endpoint: "https://api.anthropic.com/models",
    headers: (token) => ({ "Authorization": `Bearer ${token}` }),
    parser: (response) =>
      response.data.map((m) => ({
        id: `cc/${m.id}`,
        name: m.display_name || m.id,
        contextWindow: m.context_length || 200000,
        inputPrice: m.pricing?.input || 0,
        outputPrice: m.pricing?.output || 0,
      })),
    cacheTTL: 3600, // 1 hour
  },

  codex: {
    type: "live",
    endpoint: "https://api.openai.com/v1/models",
    headers: (token) => ({ "Authorization": `Bearer ${token}` }),
    parser: (response) =>
      response.data
        .filter((m) => m.id.includes("gpt"))
        .map((m) => ({
          id: `cx/${m.id}`,
          name: m.name || m.id,
          contextWindow: 128000,
        })),
    cacheTTL: 3600,
  },

  gemini: {
    type: "live",
    endpoint: "https://generativelanguage.googleapis.com/v1/models",
    headers: (token) => ({ "Authorization": `Bearer ${token}` }),
    parser: (response) =>
      response.models
        .filter((m) => m.name.includes("gemini"))
        .map((m) => ({
          id: `gc/${m.displayName}`,
          name: m.displayName || m.name,
          contextWindow: m.contextWindow || 1000000,
        })),
    cacheTTL: 3600,
  },

  // API key based: Live discovery from OpenRouter
  openrouter: {
    type: "live",
    endpoint: "https://openrouter.ai/api/v1/models",
    headers: (apiKey) => ({ "Authorization": `Bearer ${apiKey}` }),
    parser: (response) =>
      response.data.map((m) => ({
        id: `openrouter/${m.id}`,
        name: m.name || m.id,
        contextWindow: m.context_length || 4000,
        inputPrice: m.pricing?.prompt || 0,
        outputPrice: m.pricing?.completion || 0,
      })),
    cacheTTL: 7200, // 2 hours (less frequent updates)
  },
};

/**
 * Get available models for a provider
 * Tries live discovery first, falls back to hardcoded
 */
export async function discoverModels(provider, accessToken = null, forceRefresh = false) {
  const strategy = DISCOVERY_STRATEGIES[provider];

  // If no strategy defined, use hardcoded
  if (!strategy) {
    return HARDCODED_MODELS[provider] || [];
  }

  // Try live discovery if credentials available
  if (strategy.type === "live" && accessToken) {
    try {
      return await fetchModelsLive(strategy, accessToken, forceRefresh);
    } catch (error) {
      console.warn(`Live discovery for ${provider} failed: ${error.message}, falling back to hardcoded`);
    }
  }

  // Fall back to hardcoded
  return HARDCODED_MODELS[provider] || [];
}

/**
 * Fetch models from live provider API
 */
async function fetchModelsLive(strategy, accessToken, forceRefresh) {
  // Check cache (in-memory, could be extended to Redis)
  const cacheKey = `models:${strategy.endpoint}`;
  const cached = getCache(cacheKey);

  if (cached && !forceRefresh) {
    return cached;
  }

  // Fetch from API
  const response = await fetch(strategy.endpoint, {
    headers: strategy.headers(accessToken),
    timeout: 15000,
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const models = strategy.parser(data);

  // Cache result
  setCache(cacheKey, models, strategy.cacheTTL);

  return models;
}

/**
 * Filter models by criteria
 * Remove experimental, deprecated, or hidden models
 */
export function filterModels(models, options = {}) {
  const {
    hideExperimental = true,
    hideDeprecated = true,
    onlyWithPricing = false,
    minContextWindow = 0,
    capabilities = null,
  } = options;

  return models.filter((model) => {
    // Hide experimental
    if (hideExperimental && model.id.includes("experimental")) {
      return false;
    }

    // Hide deprecated
    if (hideDeprecated && model.id.includes("deprecated")) {
      return false;
    }

    // Require pricing info
    if (onlyWithPricing && (!model.inputPrice || !model.outputPrice)) {
      return false;
    }

    // Minimum context window
    if (model.contextWindow && model.contextWindow < minContextWindow) {
      return false;
    }

    // Required capabilities
    if (capabilities && Array.isArray(capabilities)) {
      const hasAllCapabilities = capabilities.every(
        (cap) => model.capabilities && model.capabilities.includes(cap)
      );
      if (!hasAllCapabilities) return false;
    }

    return true;
  });
}

/**
 * Re-rank models by custom logic
 * Useful for promoting favored models or deprioritizing expensive ones
 */
export function rankModels(models, rankingFn) {
  const ranked = models.map((model) => ({
    model,
    score: rankingFn(model),
  }));

  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.model);
}

/**
 * Example ranking function: Prefer cheaper models
 */
export function rankByCost(model) {
  const costPer1M = (model.inputPrice || 0) + (model.outputPrice || 0) * 2;
  return -costPer1M; // Negative so cheaper = higher score
}

/**
 * Example ranking function: Prefer recent models
 */
export function rankByRecency(model) {
  if (!model.released) return 0;
  const releaseDate = new Date(model.released);
  const ageInDays = (Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 100 - ageInDays); // Newer = higher score
}

/**
 * Example ranking function: Prefer capable models
 */
export function rankByCapabilities(model) {
  const desiredCapabilities = ["reasoning", "vision"];
  const matchCount = (model.capabilities || []).filter((cap) =>
    desiredCapabilities.includes(cap)
  ).length;
  return matchCount * 50; // Each desired capability: +50 points
}

/**
 * Get recommended model for a use case
 */
export function recommendModel(models, useCase = "general") {
  let filtered = models;
  let ranker = rankByRecency; // Default: prefer recent models

  switch (useCase) {
    case "cost-optimized":
      filtered = filterModels(models, { onlyWithPricing: true });
      ranker = rankByCost;
      break;

    case "reasoning":
      filtered = filterModels(models, { capabilities: ["reasoning"] });
      ranker = rankByCapabilities;
      break;

    case "vision":
      filtered = filterModels(models, { capabilities: ["vision"] });
      ranker = rankByCapabilities;
      break;

    case "long-context":
      filtered = filterModels(models, { minContextWindow: 100000 });
      ranker = rankByRecency;
      break;

    case "fast":
      filtered = filterModels(models, { capabilities: ["fast"] });
      ranker = rankByCost;
      break;
  }

  const ranked = rankModels(filtered, ranker);
  return ranked[0] || models[0] || null;
}

/**
 * Simple in-memory cache (extend with Redis for production)
 */
const cache = new Map();

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttlSeconds) {
  cache.set(key, {
    data,
    expireAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Clear cache for force refresh
 */
export function clearModelCache() {
  cache.clear();
}
