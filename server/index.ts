import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { setBYOKSpendReporter } from "./llm";

// Wire up BYOK spend reporting: each successful LLM call updates
// the user's running monthly spend counter. Side-channel pattern
// avoids a circular import between llm.ts and storage.ts.
setBYOKSpendReporter(async (userId, provider, costUsd, tokens) => {
  try {
    await storage.addBYOKSpend(userId, provider, costUsd, tokens);
  } catch (err) {
    // Never let cost reporting break a user-facing flow
    console.warn("[byok-spend] reporter failed:", (err as Error).message);
  }
});
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Security headers — must come before everything else
app.use(helmet({
  contentSecurityPolicy: false,   // disabled: we serve a SPA
  crossOriginEmbedderPolicy: false, // allow embedding
  crossOriginResourcePolicy: { policy: "cross-origin" }, // widget script must load on third-party sites
}));

// Global rate limit: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use(globalLimiter);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Also parse text/plain as JSON — sendBeacon can send text/plain Content-Type
app.use(express.text({ type: "text/plain", limit: "1mb" }));
app.use((req: any, _res: any, next: any) => {
  if (typeof req.body === "string" && req.body.startsWith("{")) {
    try { req.body = JSON.parse(req.body); } catch {}
  }
  next();
});

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

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

(async () => {
  // Initialize database schema
  await storage.pushSchema();
  console.log("Database schema initialized");

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Serve the landing pages as static files
  app.use("/beta", express.static(path.join(process.cwd(), "public/beta"), { index: "index.html" }));
  app.use("/home", express.static(path.join(process.cwd(), "public/home"), { index: "index.html" }));
  // Also serve the home page at root / for the main domain
  app.get("/", (req, res, next) => {
    // Only serve landing page if request is for the root domain (not app subdomain)
    const host = req.get("host") || "";
    if (host.includes("app.")) return next(); // Let the SPA catch-all handle app.siteamoeba.com
    res.sendFile(path.join(process.cwd(), "public/home/index.html"));
  });
  app.get("/style.css", (req, res, next) => {
    const host = req.get("host") || "";
    if (host.includes("app.")) return next();
    res.sendFile(path.join(process.cwd(), "public/home/style.css"));
  });
  app.get("/app.js", (req, res, next) => {
    const host = req.get("host") || "";
    if (host.includes("app.")) return next();
    res.sendFile(path.join(process.cwd(), "public/home/app.js"));
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
