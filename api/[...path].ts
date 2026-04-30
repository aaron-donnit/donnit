import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { createApiApp } from "../server/app";

// Vercel catch-all serverless entry. Matches /api/<anything> and lets the
// Express app handle routing internally, so the existing /api/* handlers
// (auth, bootstrap, tasks, chat, gmail oauth, manual import, etc.) keep
// working without per-route function files.
//
// We build the Express app once per warm function instance and reuse it
// for subsequent requests. Vercel's @vercel/node runtime compiles this
// TypeScript file with esbuild, traces require()s, and packages the
// function with the dependencies it needs (express, @supabase/supabase-js,
// better-sqlite3, etc.).

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
