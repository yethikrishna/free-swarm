/**
 * Provider Adapter Framework
 *
 * Complete example of adding a new OAuth provider to FreeSwarm Router.
 * This file demonstrates the full pattern for OpenAI Plus subscription (hypothetical).
 *
 * Real providers follow this same pattern:
 * - OAuth flow initiation and polling
 * - Model discovery via API
 * - Token refresh handling
 * - Error resilience
 */

import https from "https";

/**
 * OAuth Configuration
 * Define provider-specific endpoints and scopes
 */
export const OPENAI_PLUS_CONFIG = {
  provider: "openai-plus",
  prefix: "op/",
  name: "OpenAI Plus",
  type: "subscription", // vs "api-key"
  oauth: {
    device_code: "https://auth.openai.com/device",
    token_exchange: "https://auth.openai.com/token",
    models: "https://api.openai.com/v1/plus/models",
  },
  scopes: ["model.query", "model.list"],
};

/**
 * Start OAuth flow: Request device code
 * User scans QR code, authorizes app, device code polls for token
 */
export async function startOpenAIPlusOAuth() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      client_id: process.env.OPENAI_PLUS_CLIENT_ID,
      scope: OPENAI_PLUS_CONFIG.scopes.join(" "),
    });

    const options = {
      hostname: "auth.openai.com",
      path: "/device",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const { device_code, user_code, verification_uri, expires_in, interval } = JSON.parse(data);
            resolve({
              deviceCode: device_code,
              userCode: user_code,
              verificationUri: verification_uri,
              expiresIn: expires_in,
              pollInterval: interval || 5,
            });
          } catch (e) {
            reject(new Error(`Failed to parse OAuth response: ${e.message}`));
          }
        } else {
          reject(new Error(`OAuth failed: ${res.statusCode}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("OAuth request timeout"));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Poll for access token: Called repeatedly until user authorizes
 */
export async function pollOpenAIPlusAuth(deviceCode, maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await exchangeDeviceCode(deviceCode);

    if (result.success) {
      return {
        success: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
      };
    }

    if (result.error === "authorization_pending") {
      // User hasn't authorized yet, keep polling
      await sleep(5000);
      continue;
    }

    if (result.error === "expired_token") {
      return {
        success: false,
        error: "Device code expired. Please try again.",
      };
    }

    // Other errors are fatal
    return {
      success: false,
      error: result.error || "Unknown error during authorization",
    };
  }

  return {
    success: false,
    error: "Authorization timeout (10 minutes exceeded)",
  };
}

async function exchangeDeviceCode(deviceCode) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      client_id: process.env.OPENAI_PLUS_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const options = {
      hostname: "auth.openai.com",
      path: "/token",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            resolve({
              success: true,
              accessToken: response.access_token,
              refreshToken: response.refresh_token,
              expiresIn: response.expires_in,
            });
          } else if (response.error) {
            resolve({ error: response.error });
          } else {
            resolve({ error: "Unknown response" });
          }
        } catch (e) {
          resolve({ error: `Parse error: ${e.message}` });
        }
      });
    });

    req.on("error", () => resolve({ error: "network_error" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout" });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Refresh access token using refresh token
 */
export async function refreshOpenAIPlusToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      client_id: process.env.OPENAI_PLUS_CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const options = {
      hostname: "auth.openai.com",
      path: "/token",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            resolve({
              accessToken: response.access_token,
              refreshToken: response.refresh_token || refreshToken,
              expiresIn: response.expires_in,
            });
          } else {
            reject(new Error(response.error || "Token refresh failed"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Discover available models from provider API
 */
export async function discoverOpenAIPlusModels(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.openai.com",
      path: "/v1/plus/models",
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": "FreeSwarm-Router/1.0",
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            const models = response.data.map((m) => ({
              id: m.id,
              name: m.name || m.id,
              description: m.description || "",
              contextWindow: m.context_length || 128000,
              inputPrice: m.pricing?.input || 0,
              outputPrice: m.pricing?.output || 0,
              released: m.released_at || new Date().toISOString(),
            }));
            resolve(models);
          } catch (e) {
            reject(new Error(`Failed to parse models: ${e.message}`));
          }
        } else if (res.statusCode === 401) {
          reject(new Error("Invalid or expired access token"));
        } else {
          reject(new Error(`Model discovery failed: ${res.statusCode}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Model discovery timeout"));
    });

    req.end();
  });
}

/**
 * Validate access token is still valid
 */
export async function validateOpenAIPlusToken(accessToken) {
  try {
    const models = await discoverOpenAIPlusModels(accessToken);
    return { valid: true, models: models.length };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Utility: Sleep for polling
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Integration with FreeSwarm backend
 *
 * After implementing above OAuth flow:
 *
 * 1. Add to backend/apps/agents/providers/registry.py:
 *
 *    "OpenAI Plus": [
 *      {
 *        "value": "gpt-4-turbo-plus",
 *        "label": "GPT-4 Turbo (Plus)",
 *        "context_window": 128000,
 *        "router_model_id": "op/gpt-4-turbo",
 *        "api": "openai-plus",
 *        "subscription_only": True
 *      },
 *      ...
 *    ]
 *
 * 2. Add to backend/apps/nine_router/sync.py:
 *
 *    async def sync_openai_plus_subscription():
 *      connections = await get_active_subscriptions("openai-plus")
 *      for conn in connections:
 *        try:
 *          models = await fetch_openai_plus_models(conn.access_token)
 *          await update_available_models("op/", models)
 *        except Exception as e:
 *          logger.error(f"Failed to sync OpenAI Plus models: {e}")
 *
 * 3. Wire into Settings UI (frontend already supports adding new providers)
 */
