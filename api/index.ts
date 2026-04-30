import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";

// Single Vercel serverless function that fronts the entire Express app.
// vercel.json rewrites /api/* to this file; Vercel preserves the original
// request URL on req.url, so Express can dispatch /api/integrations/...,
// /api/auth/..., etc., against its registered routes.
//
// The hard requirement of this entry is: NEVER let an exception escape into
// Vercel's "FUNCTION_INVOCATION_FAILED 500 — This Serverless Function has
// crashed." page. That happens whenever the Lambda throws an unhandled
// rejection or finishes without sending a response. To prevent that, every
// async step (env load, bundle require, app construction, request dispatch)
// is wrapped, and on any failure we emit a controlled response:
//   - For the Gmail OAuth callback path, a 302 to /?gmail=server_error so
//     the SPA can show a typed toast.
//   - For everything else under /api, a JSON 500 with a non-secret reason.
//   - For any other path, a generic 500 HTML.
//
// Vercel compiles this file to ESM (package.json has "type": "module"). Node's
// strict ESM resolution rejects extensionless relative imports, so the
// server tree is pre-bundled into _bundle.cjs by `npm run build` and loaded
// here through createRequire. The bundle is regenerated on every Vercel
// build; we explicitly do NOT check it into git.

type CreateApiApp = (httpServer: null) => Promise<Express>;
type ExpressAppFn = (req: IncomingMessage, res: ServerResponse) => void;

const requireBundle = createRequire(import.meta.url);

// Try to load dotenv but never let its absence/failure crash the function.
// Vercel injects env directly into process.env, so dotenv/config is a no-op
// in production. We still call it for parity with `npm run dev`.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  requireBundle("dotenv/config");
} catch {
  // ignore — env already present in process.env on Vercel
}

// We cache only RESOLVED apps. A rejected init (e.g., bundle missing on a
// broken deploy) must not poison subsequent invocations: we retry on every
// request until init succeeds. The retry cost is bounded by Lambda lifetime
// and is preferable to permanently-rejected functions.
let cachedApp: Express | null = null;
let inFlightInit: Promise<Express> | null = null;

async function loadApp(): Promise<Express> {
  if (cachedApp) return cachedApp;
  if (inFlightInit) return inFlightInit;
  inFlightInit = (async () => {
    // Bundle load. If the build did not produce _bundle.cjs (or the include
    // path is wrong), this throws synchronously inside the Promise — which
    // is caught by the outer handler.
    const bundle = requireBundle("./_bundle.cjs") as { createApiApp: CreateApiApp };
    const app = await bundle.createApiApp(null);
    cachedApp = app;
    return app;
  })().catch((err) => {
    // Reset so next request can retry from scratch.
    inFlightInit = null;
    throw err;
  });
  return inFlightInit;
}

function isOAuthCallback(req: IncomingMessage): boolean {
  // req.url may be "/api/integrations/gmail/oauth/callback?..." after the
  // vercel.json rewrite, OR "/integrations/gmail/oauth/callback?..." if the
  // platform stripped the /api prefix. Match both.
  const url = req.url ?? "";
  return /\/integrations\/gmail\/oauth\/callback(?:\?|$)/.test(url);
}

function safeError(res: ServerResponse, req: IncomingMessage, reason: string) {
  if (res.headersSent || res.writableEnded) return;
  if (isOAuthCallback(req)) {
    try {
      res.statusCode = 302;
      res.setHeader("Location", `/?gmail=${encodeURIComponent(reason)}`);
      res.end();
      return;
    } catch {
      // fall through to JSON
    }
  }
  try {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, reason }));
  } catch {
    try {
      res.end();
    } catch {
      // last-resort: nothing more we can do
    }
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  let app: Express;
  try {
    app = await loadApp();
  } catch (err) {
    // Bundle missing, init throw, or env so broken we can't even build the
    // Express app. Emit a controlled response. We log a brief, non-secret
    // marker so Vercel's function logs at least show what bucket the failure
    // fell into without leaking env values.
    console.error(
      "[donnit] api init failed:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown",
    );
    return safeError(res, req, "server_error");
  }
  try {
    return (app as unknown as ExpressAppFn)(req, res);
  } catch (err) {
    // Express itself threw synchronously before the response started.
    // Normally Express routes don't throw outside of middleware, but a top-
    // level guard keeps Vercel from reporting FUNCTION_INVOCATION_FAILED.
    console.error(
      "[donnit] api dispatch failed:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown",
    );
    return safeError(res, req, "server_error");
  }
}

// Defensive process-level traps. On Vercel each invocation reuses the same
// Node process when warm, so a stray unhandled rejection from a misbehaving
// async path could crash the function. These traps log and swallow so the
// Lambda survives long enough to send a controlled response. They are
// process-wide, so they only run once per Lambda lifetime.
if (!(globalThis as { __donnitTrapsInstalled?: boolean }).__donnitTrapsInstalled) {
  process.on("unhandledRejection", (reason) => {
    console.error(
      "[donnit] unhandledRejection:",
      reason instanceof Error ? reason.message.slice(0, 200) : "unknown",
    );
  });
  process.on("uncaughtException", (err) => {
    console.error(
      "[donnit] uncaughtException:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown",
    );
  });
  (globalThis as { __donnitTrapsInstalled?: boolean }).__donnitTrapsInstalled = true;
}
