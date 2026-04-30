import express, { Response, NextFunction } from "express";
import type { Express, Request } from "express";
import type { Server } from "node:http";
import { registerRoutes } from "./routes";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Build the Express app and register API routes. Pass an http.Server when the
// caller intends to attach a websocket upgrade handler (the long-running
// `npm start` server). Vercel serverless invocations can pass `null` because
// there is no persistent http.Server in that environment.
export async function createApiApp(httpServer: Server | null): Promise<Express> {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }
        log(logLine);
      }
    });

    next();
  });

  await registerRoutes((httpServer ?? null) as unknown as Server, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    // Never echo `err.message` to the client — it may contain stack-derived
    // detail that we'd rather not surface. Log the trimmed message; respond
    // with a fixed string.
    console.error(
      "[donnit] route error:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown",
    );

    if (res.headersSent) {
      return next(err);
    }

    // The Gmail OAuth callback is a top-level browser navigation; the user
    // would otherwise see a raw Vercel crash page. Always redirect to the
    // SPA with a typed gmail=server_error param so the SPA can show a toast.
    if (req.path && /\/integrations\/gmail\/oauth\/callback$/.test(req.path)) {
      try {
        return res.status(302).setHeader("Location", "/?gmail=server_error").end();
      } catch {
        // fall through to JSON
      }
    }

    return res.status(status).json({ ok: false, message: "Internal Server Error" });
  });

  return app;
}
