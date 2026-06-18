import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "freeswarm-router";

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export async function GET() {
  const currentVersion = pkg.version;

  // When the router runs bundled inside the FreeSwarm desktop app, it is
  // updated via the Electron auto-updater, never via npm. The backend sets
  // FREESWARM_BUNDLED when it spawns us, so suppress the npm "new version"
  // nag (it would tell users to `npm install -g` a router they can't update
  // that way, and npm's freeswarm-router version is unrelated to the app's).
  if (process.env.FREESWARM_BUNDLED) {
    return Response.json({
      name: "FreeSwarm Router",
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      upstream: "FreeSwarm Router (fork of 9router)",
      description: "Enterprise AI subscription routing and fallback management",
    });
  }

  const latestVersion = await fetchLatestVersion();
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({
    name: "FreeSwarm Router",
    currentVersion,
    latestVersion,
    hasUpdate,
    upstream: "FreeSwarm Router (fork of 9router)",
    description: "Enterprise AI subscription routing and fallback management",
  });
}
