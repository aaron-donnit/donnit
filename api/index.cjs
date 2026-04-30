// Vercel serverless function entry — written as plain CommonJS JavaScript
// (NOT TypeScript) so Vercel cannot recompile it into an ESM file that
// statically imports "../server/app". An earlier deploy shipped an
// auto-compiled api/index.js that did exactly that, producing
// `Cannot find module '/var/task/server/app'` at runtime even after the
// repo source removed the static import. Checking in the JS source as the
// canonical entry eliminates that whole class of build-pipeline drift.
//
// vercel.json rewrites /api/* to this file. The Express app is bundled
// into ./_bundle.cjs by `npm run build` and loaded lazily. Every async
// step is wrapped so no exception can escape into Vercel's
// FUNCTION_INVOCATION_FAILED 500 page.

"use strict";

// dotenv is a no-op on Vercel (env vars come straight from the platform);
// the require may legitimately fail in environments without dotenv installed.
try {
  require("dotenv/config");
} catch (_ignored) {
  // ignore — env already present
}

// Build-time marker so /api/health (and curl -i) can confirm the deployed
// code matches the expected commit. Updated by the build command via
// scripts/stamp-build-marker, OR left at the literal default below if the
// build step did not run. The literal sentinel is intentional: when the
// user sees "DEV" in the marker they know the build pipeline did not
// regenerate the entry.
//
// We also expose a static schema/runtime label so the user can distinguish
// this safe loader from any stale compiled entry that might still be in
// the deployment cache.
const BUILD_MARKER = process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
const ENTRY_VERSION = "donnit-api-2"; // bump when changing this file

let cachedApp = null;
let inFlightInit = null;

function loadApp() {
  if (cachedApp) return Promise.resolve(cachedApp);
  if (inFlightInit) return inFlightInit;
  inFlightInit = (async () => {
    // Bundle load. If the build did not produce _bundle.cjs (or the include
    // path is wrong), this throws synchronously inside the Promise — caught
    // by the outer handler. Failed init clears inFlightInit so the next
    // request retries; we never cache a rejected promise.
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
  // req.url is e.g. "/api/integrations/gmail/oauth/callback?..." after the
  // vercel.json rewrite. Match both the rewritten and the platform-stripped
  // forms defensively.
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
      // last-resort: nothing we can do
    }
  }
}

module.exports = async function handler(req, res) {
  // Annotate every response so the user can verify the safe loader is in
  // play. Set BEFORE dispatching to Express so even Express-handled paths
  // include them.
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
};

// Process-level traps. Each Lambda reuses one Node process when warm, so
// a stray unhandled rejection from a misbehaving async path could crash
// the function. These traps log + swallow so the Lambda survives long
// enough to send a controlled response. They install once per process.
if (!global.__donnitTrapsInstalled) {
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
  global.__donnitTrapsInstalled = true;
}
