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
const ENTRY_VERSION = "donnit-api-3"; // bump when changing this file

let cachedApp = null;
let inFlightInit = null;

function loadApp() {
  if (cachedApp) return Promise.resolve(cachedApp);
  if (inFlightInit) return inFlightInit;
  inFlightInit = (async () => {
    const bundle = require("./_bundle.cjs");
    if (!bundle || typeof bundle.createApiApp !== "function") {
      throw new Error("api/_bundle.cjs is missing createApiApp export");
    }
    const app = await bundle.createApiApp(null);
    cachedApp = app;
    return app;
  })().catch((err) => {
    inFlightInit = null;
    throw err;
  });
  return inFlightInit;
}

function isOAuthCallback(req) {
  const url = (req && req.url) || "";
  return /\/integrations\/gmail\/oauth\/callback(?:\?|$)/.test(url);
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
