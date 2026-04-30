import "dotenv/config";
import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";

// Single Vercel serverless function that fronts the entire Express app.
// vercel.json rewrites /api/* to this file; Vercel preserves the original
// request URL on req.url, so Express can dispatch /api/integrations/...,
// /api/auth/..., etc., against its registered routes.
//
// Vercel compiles this file to ESM (package.json has "type": "module"). Node's
// strict ESM resolution rejects extensionless relative imports, so importing
// "../server/app" directly failed at runtime with ERR_MODULE_NOT_FOUND. The
// Vercel build (npm run build) pre-bundles the server tree into _bundle.cjs;
// we load it via createRequire to sidestep ESM resolution entirely and to also
// resolve the `@shared/*` tsconfig path alias at build time.
const requireBundle = createRequire(import.meta.url);

type CreateApiApp = (httpServer: null) => Promise<Express>;

let cachedApp: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!cachedApp) {
    const bundle = requireBundle("./_bundle.cjs") as { createApiApp: CreateApiApp };
    cachedApp = bundle.createApiApp(null);
  }
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
