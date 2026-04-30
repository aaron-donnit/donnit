import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { createApiApp } from "../server/app";

// Single Vercel serverless function that fronts the entire Express app.
// vercel.json rewrites /api/* to this file; Vercel preserves the original
// request URL on req.url, so Express can dispatch /api/integrations/...,
// /api/auth/..., etc., against its registered routes.

let cachedApp: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!cachedApp) {
    cachedApp = createApiApp(null);
  }
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
