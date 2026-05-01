// Vercel serverless function entry. Written as ESM (.js) because
// package.json sets "type": "module". The Express app is pre-bundled into
// ./_bundle.cjs by `npm run build`; we load that CJS bundle here via
// createRequire so we never trip Node ESM's strict relative-extension rule
// or accidentally tree-shake away the runtime entry.
//
// Earlier deploys failed because:
//   - api/index.ts had a static `import "../server/app"` that did not exist
//     on disk in the deployed function (ERR_MODULE_NOT_FOUND).
//   - A checked-in api/index.cjs entry was rejected by Vercel's function
//     pattern matcher ("doesn't match any Serverless Functions").
// This file is the supported pattern: api/index.js, ESM, lazy CJS load,
// no static server/app import anywhere.
//
// /api/health is handled DIRECTLY here, before the bundle is loaded, so a
// broken bundle (missing _bundle.cjs, server/app init throw, native binding
// failure inside routes.ts) cannot poison the health probe. Operators can
// always hit /api/health to learn whether the function entry runs and which
// env vars are present.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// dotenv is a no-op on Vercel (env comes straight from the platform); the
// require may legitimately fail in environments without dotenv installed.
try {
  require("dotenv/config");
} catch (_ignored) {
  // ignore — env already present
}

const BUILD_MARKER = process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
const ENTRY_VERSION = "donnit-api-4"; // bump when changing this file

let cachedApp = null;
let inFlightInit = null;
let lastInitError = null;

function loadApp() {
  if (cachedApp) return Promise.resolve(cachedApp);
  if (inFlightInit) return inFlightInit;
  inFlightInit = (async () => {
    let bundle;
    try {
      bundle = require("./_bundle.cjs");
    } catch (err) {
      const message = err && err.message ? String(err.message).slice(0, 200) : "require failed";
      lastInitError = "bundle_require_failed:" + message;
      throw err;
    }
    if (!bundle || typeof bundle.createApiApp !== "function") {
      lastInitError = "bundle_missing_createApiApp";
      throw new Error("api/_bundle.cjs is missing createApiApp export");
    }
    try {
      const app = await bundle.createApiApp(null);
      cachedApp = app;
      return app;
    } catch (err) {
      const message = err && err.message ? String(err.message).slice(0, 200) : "createApiApp failed";
      lastInitError = "create_app_failed:" + message;
      throw err;
    }
  })().catch((err) => {
    inFlightInit = null;
    throw err;
  });
  return inFlightInit;
}

function getPath(req) {
  const url = (req && req.url) || "";
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function isOAuthCallback(req) {
  const url = (req && req.url) || "";
  return /\/integrations\/gmail\/oauth\/callback(?:\?|$)/.test(url);
}

function isHealthPath(req) {
  const path = getPath(req);
  // Vercel rewrites /api/health -> /api/index, so the rewritten request
  // arrives with path /api/index. The original path is preserved in
  // x-vercel-original-pathname.
  if (path === "/api/health") return true;
  const orig = req && req.headers && req.headers["x-vercel-original-pathname"];
  if (typeof orig === "string" && orig === "/api/health") return true;
  return false;
}

// Direct health response. Does NOT load the bundle. Reports BOOLEAN env
// presence only — never the values themselves. Useful for verifying that:
//   1. The function entry is reachable at all (status 200).
//   2. ENTRY_VERSION matches the deployed commit.
//   3. The required env vars are wired up in Vercel project settings.
//   4. If a previous request tripped bundle init, lastInitError is exposed.
function respondHealth(res) {
  try {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-donnit-entry", ENTRY_VERSION);
    res.setHeader("x-donnit-commit", BUILD_MARKER);
    res.end(
      JSON.stringify({
        ok: true,
        source: "entry",
        entry: ENTRY_VERSION,
        commit: BUILD_MARKER,
        time: new Date().toISOString(),
        node: process.version,
        env: {
          supabaseUrl: Boolean(process.env.SUPABASE_URL),
          supabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
          supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
          googleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
          googleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
          googleRedirectUri: Boolean(process.env.GOOGLE_REDIRECT_URI),
          gmailOauthStateSecret: Boolean(process.env.GMAIL_OAUTH_STATE_SECRET),
        },
        lastInitError: lastInitError,
      }),
    );
  } catch (_ignored) {
    try {
      res.statusCode = 500;
      res.end();
    } catch (_ignored2) {
      // last resort
    }
  }
}

function safeError(res, req, reason) {
  try {
    if (res.headersSent || res.writableEnded) return;
  } catch (_ignored) {
    return;
  }
  if (isOAuthCallback(req)) {
    try {
      res.statusCode = 302;
      res.setHeader("Location", "/?gmail=" + encodeURIComponent(reason));
      res.setHeader("x-donnit-entry", ENTRY_VERSION);
      res.setHeader("x-donnit-commit", BUILD_MARKER);
      res.end();
      return;
    } catch (_ignored) {
      // fall through to JSON
    }
  }
  try {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("x-donnit-entry", ENTRY_VERSION);
    res.setHeader("x-donnit-commit", BUILD_MARKER);
    res.end(
      JSON.stringify({
        ok: false,
        reason: reason,
        entry: ENTRY_VERSION,
        commit: BUILD_MARKER,
        lastInitError: lastInitError,
      }),
    );
  } catch (_ignored) {
    try {
      res.end();
    } catch (_ignored2) {
      // last-resort
    }
  }
}

export default async function handler(req, res) {
  try {
    res.setHeader("x-donnit-entry", ENTRY_VERSION);
    res.setHeader("x-donnit-commit", BUILD_MARKER);
  } catch (_ignored) {
    // headers already sent (very unlikely at this point)
  }

  // Direct entry-level health response. MUST run before loadApp() so a
  // broken bundle cannot mask whether the function entry is reachable.
  if (isHealthPath(req)) {
    return respondHealth(res);
  }

  let app;
  try {
    app = await loadApp();
  } catch (err) {
    console.error(
      "[donnit] api init failed:",
      err && err.message ? String(err.message).slice(0, 200) : "unknown",
    );
    return safeError(res, req, "server_error");
  }
  try {
    return app(req, res);
  } catch (err) {
    console.error(
      "[donnit] api dispatch failed:",
      err && err.message ? String(err.message).slice(0, 200) : "unknown",
    );
    return safeError(res, req, "server_error");
  }
}

if (!globalThis.__donnitTrapsInstalled) {
  process.on("unhandledRejection", (reason) => {
    console.error(
      "[donnit] unhandledRejection:",
      reason && reason.message ? String(reason.message).slice(0, 200) : "unknown",
    );
  });
  process.on("uncaughtException", (err) => {
    console.error(
      "[donnit] uncaughtException:",
      err && err.message ? String(err.message).slice(0, 200) : "unknown",
    );
  });
  globalThis.__donnitTrapsInstalled = true;
}
