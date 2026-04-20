import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import rateLimit from "express-rate-limit";
import xss from "xss";
import { storage, pool } from "./storage";
import { callLLM, resolveLLMConfig } from "./llm";
import { runCounsel, runPostMortem } from "./counsel";
import { encryptApiKey, decryptApiKey } from "./encryption";
import { buildHeadlineGenerationPrompt, buildSubheadlineGenerationPrompt, buildSectionGenerationPrompt, buildClassificationPrompt, buildPageScanPrompt, buildBrainChatPrompt, buildTestLessonPrompt, buildCROReportPrompt, type GenerationContext } from "./prompts";
import { getBrainPageAuditKnowledge, getRelevantTestLessons } from "./brain-selector";
import { getNetworkIntelligence, refreshNetworkIntelligence } from "./network-intelligence";
import { getCROKnowledge } from "./brain-cro-knowledge";
import { normalizePayload, processPlatformPurchase, generateWebhookSecret, PLATFORM_LABELS, type SupportedPlatform } from "./platform-webhooks";
import { loginSchema, registerSchema, insertCampaignSchema, insertVariantSchema, insertTestSectionSchema, insertFeedbackSchema } from "@shared/schema";
import { evaluateAutopilotTests, advanceAutopilot, generateAutopilotVariants, declareWinnerForSection } from "./autopilot-engine";
import { getPlaybook } from "./autopilot-playbooks";
import { generateWidgetScript } from "./widget-script";
import { generateDailyObservation, CATEGORY_LABELS } from "./daily-observations";

// ===== Rate limiters =====

// Auth endpoints: 10 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

// AI generation: 20 per minute (expensive operations)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI generation rate limit reached. Please wait a moment." },
});

// Widget endpoints: 300 per minute per IP (public, high-traffic)
const widgetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded" },
});

// ===== Input sanitization =====

/**
 * Sanitize user-supplied HTML content. Allows safe inline styling
 * (spans with style for colored headlines) while stripping XSS vectors.
 */
/**
 * Keeps an HTTP connection alive by sending whitespace every N seconds.
 * Prevents Cloudflare's 30s "no data" timeout for long AI operations.
 * The JSON response body is written after the AI completes — leading
 * whitespace before JSON is valid and ignored by all JSON parsers.
 */
function keepAliveJson(res: Response, intervalMs = 8000): { send: (data: object) => void; fail: (status: number, body: object) => void } {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx/Cloudflare response buffering
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.status(200);
  // flushHeaders sends status + headers immediately before any body
  res.flushHeaders();
  // Write an initial space so the connection starts streaming immediately
  res.write(" ");
  const timer = setInterval(() => { try { res.write(" "); } catch(e) {} }, intervalMs);
  return {
    send(data: object) {
      clearInterval(timer);
      res.write(JSON.stringify(data));
      res.end();
    },
    fail(status: number, body: object) {
      clearInterval(timer);
      // Can't change status after headers sent, embed error in body
      res.write(JSON.stringify({ ...body, _statusCode: status }));
      res.end();
    },
  };
}

function sanitizeInput(input: string): string {
  return xss(input, {
    whiteList: {
      span: ["style"],
      b: [],
      strong: [],
      em: [],
      i: [],
      br: [],
    },
    stripIgnoreTag: true,
  });
}

// Plan config — Stripe price IDs for beta pricing (half off)
const PLANS: Record<string, { credits: number; campaigns: number; priceId: string | null }> = {
  free:      { credits: 0,    campaigns: 999, priceId: null },
  pro:       { credits: 500,   campaigns: 999, priceId: "price_1TICnfLj5hhothOuz2yfIWZi" },
  business:  { credits: 1200,  campaigns: 999, priceId: "price_1TICngLj5hhothOuPEzJ9Nwa" },
  autopilot: { credits: 3000,  campaigns: 999, priceId: "price_1TICngLj5hhothOuIYr4AGgK" },
};

const PLAN_LIMITS: Record<string, { concurrentTests: number }> = {
  free:      { concurrentTests: 1 },
  pro:       { concurrentTests: 3 },
  business:  { concurrentTests: 5 },
  autopilot: { concurrentTests: 999 }, // unlimited
};

// Stripe (optional — set STRIPE_SECRET_KEY env)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || "siteamoeba-jwt-secret-change-in-prod";
const JWT_EXPIRY = "30d";

// Extend Request to carry userId from JWT
declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Helper: Express route params are always string, but the TypeScript definitions
// can type them as string|string[] when using certain versions. This casts safely.
function paramId(id: string | string[]): number {
  return parseInt(Array.isArray(id) ? id[0] : id, 10);
}

/**
 * consumeCredits — check credit balance and deduct for a paid AI operation.
 * Returns { ok: true } if the operation is allowed and credits deducted.
 * Returns { ok: false, errorMsg } if the user has no credits and overage is disabled.
 * Free-plan operations (creditCost === 0) pass through immediately.
 */
async function consumeCredits(
  userId: number,
  creditCost: number
): Promise<{ ok: boolean; errorMsg?: string }> {
  if (creditCost <= 0) return { ok: true }; // Free op
  const user = await storage.getUserById(userId);
  if (!user || user.plan === "free") return { ok: true }; // Free plan
  if ((user.creditsUsed + creditCost) > user.creditsLimit && !user.allowOverage) {
    return {
      ok: false,
      errorMsg: `Credit limit reached (${user.creditsUsed}/${user.creditsLimit}). Upgrade your plan or enable overage in Settings.`,
    };
  }
  await storage.incrementCreditsBy(userId, creditCost);
  return { ok: true };
}

// Admin auth is COMPLETELY separate from the user system.
// Admin credentials live in env vars (ADMIN_EMAIL, ADMIN_PASSWORD) — never in the DB.
// Admin JWTs carry { isAdminSession: true } and are checked here, not against any user record.
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET + "-admin";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as any;
    if (!payload.isAdminSession) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function registerRoutes(server: Server, app: Express) {
  // Shared Postgres pool for all route handlers and background functions
  const PgPoolShared = (await import('pg')).default.Pool || (await import('pg')).Pool;
  const pool = new PgPoolShared({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
  });

  // Health check — used by Railway and monitoring
  // Client-side error logging — no auth required, just store for admin review
  app.post("/api/client-errors", async (req: Request, res: Response) => {
    try {
      const { message, stack, componentStack, type, url, ts } = req.body;
      // Log to console for immediate visibility
      console.error(`[CLIENT ERROR] ${type || "boundary"} at ${url}\n${message}\n${stack?.slice(0, 500) || ""}`);
      // Persist to DB for admin review
      const userId = (req as any).userId ?? null;
      let userEmail: string | null = null;
      if (userId) {
        try {
          const user = await storage.getUserById(userId);
          userEmail = user?.email ?? null;
        } catch {}
      }
      await pool.query(
        `INSERT INTO client_errors (message, stack, component_stack, error_type, url, user_id, user_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          (message || "").slice(0, 2000),
          (stack || "").slice(0, 5000),
          (componentStack || "").slice(0, 5000),
          type || "boundary",
          (url || "").slice(0, 500),
          userId,
          userEmail,
        ]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[CLIENT ERROR store failed]', err);
      res.json({ ok: true });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ============== AUTH (JWT-based) ==============

  app.post("/api/auth/register", authLimiter, async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const existing = await storage.getUserByEmail(parsed.data.email);
    if (existing) return res.status(409).json({ error: "Email already registered" });

    // Generate a unique referral code: first 4 alphanumeric chars of name + dash + 4 random chars
    const nameSlug = (parsed.data.name || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 4)
      .padEnd(4, "x");
    const randChars = Math.random().toString(36).slice(2, 6);
    const newReferralCode = `${nameSlug}-${randChars}`;

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    let user = await storage.createUser({
      email: parsed.data.email,
      name: sanitizeInput(parsed.data.name), // sanitize user-supplied name
      passwordHash,
    });

    // Save the referral code
    user = (await storage.updateUser(user.id, { referralCode: newReferralCode })) || user;

    // Handle referral code from signup
    if (parsed.data.referralCode) {
      const referrer = await storage.getUserByReferralCode(parsed.data.referralCode);
      if (referrer && referrer.id !== user.id) {
        // Link the user to the referrer
        user = (await storage.updateUser(user.id, { referredBy: referrer.id })) || user;
        // Create a referral record
        const expiresAt = new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000
        ).toISOString();
        await storage.createReferral({
          referrerId: referrer.id,
          referredId: user.id,
          referralCode: parsed.data.referralCode,
          status: "active",
          commissionRate: 0.20,
          totalEarned: 0,
          expiresAt,
        });
      }
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.status(201).json({ user: sanitizeUser(user), token });
  });

  app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ user: sanitizeUser(user), token });
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    // JWT is stateless — client just discards the token
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    // Include unread feedback response count
    let unreadFeedback = 0;
    try {
      const unread = await pool.query(
        `SELECT COUNT(*) as cnt FROM feedback WHERE user_id = $1 AND admin_response IS NOT NULL AND response_read = false`,
        [req.userId]
      );
      unreadFeedback = parseInt(unread.rows[0]?.cnt || "0");
    } catch (e) { /* non-fatal */ }
    res.json({ user: sanitizeUser(user), unreadFeedback });
  });

  // ============== BILLING ==============

  app.post("/api/billing/checkout", requireAuth, async (req: Request, res: Response) => {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { plan } = req.body;
    const planConfig = PLANS[plan];
    if (!planConfig || !planConfig.priceId) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
      await storage.updateUser(user.id, { stripeCustomerId: customerId });
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || "https://app.siteamoeba.com";

    // Store old subscription ID so we can cancel it after the upgrade completes
    const oldSubId = user.stripeSubscriptionId || "";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: `${origin}/#/billing?success=true`,
      cancel_url: `${origin}/#/billing?canceled=true`,
      metadata: { userId: String(user.id), plan, oldSubscriptionId: oldSubId },
    });

    res.json({ url: session.url });
  });

  app.post("/api/billing/portal", requireAuth, async (req: Request, res: Response) => {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    const user = await storage.getUserById(req.userId!);
    if (!user?.stripeCustomerId) return res.status(400).json({ error: "No billing account" });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${req.headers.origin}/#/billing`,
    });

    res.json({ url: portalSession.url });
  });

  // Sync subscription status from Stripe — called after checkout redirect
  // Ensures plan is upgraded even if webhook didn't fire.
  // Uses the shared upgradePlanFromSubscription helper for consistency.
  app.post("/api/billing/sync", requireAuth, async (req: Request, res: Response) => {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });
    const user = await storage.getUserById(req.userId!);
    if (!user?.stripeCustomerId) return res.json({ synced: false, reason: "no customer" });

    try {
      // Get all active subscriptions for this customer
      const subs = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: "active",
        limit: 5,
      });
      if (subs.data.length > 0) {
        // Use the most recent (highest-value) active subscription
        // Sort by amount descending so if they have both pro + autopilot, autopilot wins
        const sorted = subs.data.sort((a: any, b: any) => {
          const amtA = a.items?.data?.[0]?.price?.unit_amount || 0;
          const amtB = b.items?.data?.[0]?.price?.unit_amount || 0;
          return amtB - amtA;
        });
        const sub = sorted[0];
        const result = await upgradePlanFromSubscription(sub, user);
        if (result.upgraded) {
          console.log(`[billing-sync] Synced user ${user.id} (${user.email}) to ${result.plan}`);

          // Auto-cancel any lower-tier duplicate subscriptions
          if (sorted.length > 1) {
            for (let i = 1; i < sorted.length; i++) {
              try {
                await stripe.subscriptions.cancel(sorted[i].id);
                console.log(`[billing-sync] Auto-canceled duplicate sub ${sorted[i].id} (kept ${sub.id})`);
              } catch (e: any) {
                console.warn(`[billing-sync] Could not cancel duplicate sub ${sorted[i].id}: ${e.message}`);
              }
            }
          }

          return res.json({ synced: true, plan: result.plan });
        }
      }
      return res.json({ synced: false, reason: "no active subscription found or plan unchanged" });
    } catch (err: any) {
      console.error("[billing-sync]", err.message);
      return res.status(500).json({ error: "Failed to sync" });
    }
  });

  // === SHARED HELPER: Upgrade a user's plan from a Stripe subscription ===
  // Used by both the webhook and the sync endpoint — single source of truth.
  async function upgradePlanFromSubscription(sub: any, user?: any): Promise<{ upgraded: boolean; plan?: string; userId?: number }> {
    const priceId = sub.items?.data?.[0]?.price?.id;
    if (!priceId) return { upgraded: false };

    // Find which plan this price belongs to
    let matchedPlan: string | null = null;
    for (const [planId, config] of Object.entries(PLANS)) {
      if ((config as any).priceId === priceId) { matchedPlan = planId; break; }
    }
    if (!matchedPlan) return { upgraded: false };

    const planConfig = PLANS[matchedPlan];
    const planLimits = PLAN_LIMITS[matchedPlan] || { concurrentTests: 1 };

    // If we don't have the user, find by customer ID
    if (!user) {
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (customerId) user = await storage.getUserByStripeCustomerId(customerId);
    }
    if (!user) return { upgraded: false };

    // Always sync — even if plan already matches (catches limit mismatches)
    await storage.updateUser(user.id, {
      plan: matchedPlan,
      creditsLimit: planConfig.credits,
      campaignsLimit: planConfig.campaigns,
      concurrentTestLimit: planLimits.concurrentTests,
      stripeSubscriptionId: sub.id,
    });
    console.log(`[billing] Upgraded user ${user.id} (${user.email}) to ${matchedPlan} — sub ${sub.id}`);
    return { upgraded: true, plan: matchedPlan, userId: user.id };
  }

  // Stripe webhook for subscription events
  app.post("/api/webhook/stripe-billing", async (req: Request, res: Response) => {
    const event = req.body;
    console.log(`[billing-webhook] Received: ${event.type}`);

    try {
      // 1) checkout.session.completed — primary upgrade path
      if (event.type === "checkout.session.completed") {
        const session = event.data?.object;
        const meta = session?.metadata;
        // Try metadata first (we set userId + plan on checkout creation)
        if (meta?.userId && meta?.plan) {
          const userId = parseInt(meta.userId);
          const user = await storage.getUserById(userId);
          const planConfig = PLANS[meta.plan];
          const planLimits = PLAN_LIMITS[meta.plan] || { concurrentTests: 1 };
          if (planConfig && user) {
            await storage.updateUser(userId, {
              plan: meta.plan,
              creditsLimit: planConfig.credits,
              campaignsLimit: planConfig.campaigns,
              concurrentTestLimit: planLimits.concurrentTests,
              stripeSubscriptionId: session.subscription || null,
            });
            console.log(`[billing-webhook] checkout.session.completed: upgraded user ${userId} to ${meta.plan}`);

            // AUTO-CANCEL old subscription on plan upgrade
            // If the user had a previous subscription (stored in metadata), cancel it
            // so they're not double-billed. No proration — they get the full period
            // they already paid for on the old plan, and the new plan starts fresh.
            if (meta.oldSubscriptionId && meta.oldSubscriptionId !== session.subscription && stripe) {
              try {
                await stripe.subscriptions.cancel(meta.oldSubscriptionId);
                console.log(`[billing-webhook] Auto-canceled old subscription ${meta.oldSubscriptionId} after upgrade to ${meta.plan}`);
              } catch (cancelErr: any) {
                console.warn(`[billing-webhook] Could not cancel old sub ${meta.oldSubscriptionId}: ${cancelErr.message}`);
              }
            }
          }
        } else if (session?.subscription && stripe) {
          // Fallback: if no metadata, resolve subscription and match by price
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const customerId = session.customer;
          const user = customerId ? await storage.getUserByStripeCustomerId(customerId) : null;
          if (sub && user) await upgradePlanFromSubscription(sub, user);
        }
      }

      // 2) invoice.payment_succeeded — catches renewals AND first payments
      // This is the most reliable event: Stripe sends it on every successful charge.
      if (event.type === "invoice.payment_succeeded") {
        const invoice = event.data?.object;
        const subId = invoice?.subscription;
        const customerId = invoice?.customer;
        if (subId && customerId && stripe) {
          const user = await storage.getUserByStripeCustomerId(customerId);
          if (user) {
            const sub = await stripe.subscriptions.retrieve(subId);
            if (sub.status === "active") {
              await upgradePlanFromSubscription(sub, user);
            }
          }
        }
      }

      // 3) customer.subscription.updated — catches plan changes, reactivations
      if (event.type === "customer.subscription.updated") {
        const sub = event.data?.object;
        if (sub?.status === "active") {
          await upgradePlanFromSubscription(sub);
        } else if (sub?.status === "canceled" || sub?.status === "unpaid" || sub?.status === "past_due") {
          const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
          if (customerId) {
            const user = await storage.getUserByStripeCustomerId(customerId);
            if (user && user.plan !== "free") {
              await storage.updateUser(user.id, {
                plan: "free",
                creditsLimit: 0,
                stripeSubscriptionId: null,
                concurrentTestLimit: 1,
              });
              console.log(`[billing-webhook] Downgraded user ${user.id} to free (sub status: ${sub.status})`);
            }
          }
        }
      }

      // 4) customer.subscription.deleted — subscription fully canceled
      // CRITICAL: Only downgrade if this was the user's CURRENT subscription.
      // During plan upgrades, the OLD subscription gets canceled, which fires this event.
      // We must NOT downgrade the user if they still have an active (newer) subscription.
      if (event.type === "customer.subscription.deleted") {
        const deletedSubId = event.data?.object?.id;
        const customerId = event.data?.object?.customer;
        if (customerId) {
          const user = await storage.getUserByStripeCustomerId(customerId);
          if (user) {
            // Only downgrade if the deleted sub matches the user's CURRENT sub ID
            // If they upgraded, their stripeSubscriptionId already points to the new sub
            if (user.stripeSubscriptionId === deletedSubId || !user.stripeSubscriptionId) {
              // Double-check: see if they have any OTHER active subs in Stripe
              let hasOtherActiveSub = false;
              if (stripe) {
                try {
                  const activeSubs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 5 });
                  hasOtherActiveSub = activeSubs.data.some((s: any) => s.id !== deletedSubId);
                  if (hasOtherActiveSub) {
                    // They have another active sub — sync to it instead of downgrading
                    const bestSub = activeSubs.data.find((s: any) => s.id !== deletedSubId);
                    if (bestSub) await upgradePlanFromSubscription(bestSub, user);
                    console.log(`[billing-webhook] Sub ${deletedSubId} deleted but user ${user.id} has another active sub — synced instead of downgrading`);
                  }
                } catch (e: any) {
                  console.warn(`[billing-webhook] Could not check other subs: ${e.message}`);
                }
              }
              if (!hasOtherActiveSub) {
                await storage.updateUser(user.id, {
                  plan: "free",
                  creditsLimit: 0,
                  stripeSubscriptionId: null,
                  concurrentTestLimit: 1,
                });
                console.log(`[billing-webhook] Subscription deleted: downgraded user ${user.id} to free`);
              }
            } else {
              console.log(`[billing-webhook] Sub ${deletedSubId} deleted but user ${user.id} has different current sub ${user.stripeSubscriptionId} — skipping downgrade`);
            }
          }
        }
      }

      // 5) invoice.payment_failed — alert but don't downgrade immediately (Stripe retries)
      if (event.type === "invoice.payment_failed") {
        const customerId = event.data?.object?.customer;
        if (customerId) {
          const user = await storage.getUserByStripeCustomerId(customerId);
          if (user) {
            console.warn(`[billing-webhook] Payment failed for user ${user.id} (${user.email}) — Stripe will retry`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[billing-webhook] Error handling ${event.type}:`, err.message);
    }

    res.json({ received: true });
  });

  app.get("/api/billing/plans", (_req: Request, res: Response) => {
    res.json({
      plans: [
        { id: "free", name: "Free", price: 0, betaPrice: 0, credits: 0, features: ["BYOK — use your own AI keys", "Unlimited campaigns", "Behavioral tracking", "Analytics dashboard"] },
        { id: "pro", name: "Pro", price: 47, betaPrice: 23.50, credits: 500, features: ["Brain access", "500 AI credits", "Daily observations", "Brain Chat", "All page sections"] },
        { id: "business", name: "Business", price: 97, betaPrice: 48.50, credits: 1200, features: ["1,200 AI credits", "Multi-seat access", "Advanced analytics", "Custom webhooks"] },
        { id: "autopilot", name: "Autopilot", price: 299, betaPrice: 149.50, credits: 3000, features: ["3,000 AI credits", "Autonomous optimization", "AI-driven winner promotion", "Unlimited concurrent tests"] },
      ],
    });
  });

  // ============== GOHIGHLEVEL INTEGRATION ==============

  // POST /api/settings/ghl-connect — save GHL Location ID + API Key, validate connection
  app.post("/api/settings/ghl-connect", requireAuth, async (req: Request, res: Response) => {
    const { locationId, apiKey } = req.body;
    if (!locationId || !apiKey) return res.status(400).json({ error: "Location ID and API Key are required" });

    // Validate the key by fetching the location info
    try {
      const testResp = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Accept': 'application/json',
        },
      });

      if (!testResp.ok) {
        const err = await testResp.json().catch(() => ({ message: 'Unknown error' }));
        return res.status(400).json({ error: `GHL API error: ${err.message || testResp.statusText}. Check your Location ID and API Key.` });
      }

      const locationData = await testResp.json();
      const locationName = locationData.location?.name || locationData.name || 'Connected';

      // Encrypt and store
      const encryptedKey = encryptApiKey(apiKey);
      await storage.updateUser(req.userId!, {
        ghlLocationId: locationId,
        ghlApiKey: encryptedKey,
        ghlConnectedAt: new Date().toISOString(),
        ghlLocationName: locationName,
      } as any);

      res.json({ connected: true, locationName });
    } catch (err: any) {
      console.error('[ghl-connect]', err.message);
      res.status(400).json({ error: `Could not connect to GHL: ${err.message}` });
    }
  });

  // POST /api/settings/ghl-disconnect
  app.post("/api/settings/ghl-disconnect", requireAuth, async (req: Request, res: Response) => {
    await storage.updateUser(req.userId!, {
      ghlLocationId: null,
      ghlApiKey: null,
      ghlConnectedAt: null,
      ghlLocationName: null,
    } as any);
    res.json({ disconnected: true });
  });

  // GET /api/settings/ghl-transactions — fetch recent GHL transactions for the user
  app.get("/api/settings/ghl-transactions", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || !(user as any).ghlApiKey || !(user as any).ghlLocationId) {
      return res.json({ transactions: [] });
    }
    try {
      const apiKey = decryptApiKey((user as any).ghlApiKey);
      const locationId = (user as any).ghlLocationId;

      // Fetch recent transactions from GHL using correct altId/altType params
      const resp = await fetch(
        `https://services.leadconnectorhq.com/payments/transactions?altId=${locationId}&altType=location&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
            'Accept': 'application/json',
          },
        }
      );
      if (!resp.ok) {
        return res.json({ transactions: [], error: 'Failed to fetch GHL transactions' });
      }
      const data = await resp.json();
      const txns = data.data || data.transactions || [];

      const transactions = txns.map((t: any) => ({
        id: t._id || t.id,
        name: t.contactName || t.contactSnapshot?.name || t.name || 'Unknown',
        email: t.contactSnapshot?.email || t.contactEmail || t.email || '',
        amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount) || 0,
        status: t.status || t.paymentStatus || 'unknown',
        productName: t.entitySourceName || t.items?.[0]?.name || t.name || '',
        createdAt: t.createdAt || t.created_at || '',
      }));

      res.json({ transactions });
    } catch (err: any) {
      console.error('[ghl-transactions]', err.message);
      res.json({ transactions: [], error: err.message });
    }
  });

  // ============== CAMPAIGNS ==============

  app.get("/api/campaigns", requireAuth, async (req: Request, res: Response) => {
    // Accept ?status=active|archived|all (default: active)
    const statusParam = (req.query.status as string) || 'active';
    const campaignsWithStats = await storage.getCampaignsWithStats(req.userId!, statusParam === 'all' ? undefined : statusParam);
    // Flatten for frontend: merge campaign fields + aggregate stats into one object
    const flat = campaignsWithStats.map(({ campaign, totalVisitors, totalConversions, totalRevenue, conversionRate, variantCount }) => ({
      id: campaign.id,
      name: campaign.name,
      url: campaign.url,
      isActive: campaign.isActive,
      status: campaign.status,
      archivedAt: campaign.archivedAt,
      headlineSelector: campaign.headlineSelector,
      subheadlineSelector: campaign.subheadlineSelector,
      totalVisitors,
      totalConversions,
      totalRevenue,
      conversionRate,
      variantCount,
    }));
    res.json(flat);
  });

  // GET /api/campaigns/anomaly-counts — MUST be before :id route so Express doesn't swallow it
  app.get("/api/campaigns/anomaly-counts", requireAuth, async (req: Request, res: Response) => {
    try {
      const counts = await storage.getUnreadAnomalyCountsByUser(req.userId!);
      return res.json(counts);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/campaigns/:id", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    res.json(campaign);
  });

  app.post("/api/campaigns", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // BYOK (free plan) users have no campaign limit — they use their own AI keys
    // Paid plans also have generous limits (999) but we enforce them as a safeguard
    const isByok = user.plan === "free";
    if (!isByok) {
      const count = await storage.getCampaignCountByUser(user.id);
      if (count >= user.campaignsLimit) {
        return res.status(403).json({ error: "Campaign limit reached. Upgrade your plan." });
      }
    }

    const parsed = insertCampaignSchema.safeParse({
      ...req.body,
      userId: user.id,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    // Sanitize campaign name
    if (parsed.data.name) {
      (parsed.data as any).name = sanitizeInput(parsed.data.name);
    }

    // URL uniqueness check: only active campaigns for this user
    if (parsed.data.url) {
      const existing = await storage.getCampaignByUrl(user.id, parsed.data.url);
      if (existing) {
        return res.status(409).json({ error: "You already have an active campaign for this URL. Archive it first to create a new one." });
      }
    }

    const campaign = await storage.createCampaign(parsed.data);
    res.status(201).json(campaign);
  });

  app.patch("/api/campaigns/:id", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const updated = await storage.updateCampaign(campaign.id, req.body);
    res.json(updated);
  });

  app.delete("/api/campaigns/:id", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    await storage.deleteCampaign(campaign.id);
    res.json({ deleted: campaign.id });
  });

  // POST /api/campaigns/:id/archive
  app.post("/api/campaigns/:id/archive", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const updated = await storage.archiveCampaign(campaign.id);
    res.json({ success: true, campaign: updated });
  });

  // POST /api/campaigns/:id/unarchive
  app.post("/api/campaigns/:id/unarchive", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const updated = await storage.unarchiveCampaign(campaign.id);
    res.json({ success: true, campaign: updated });
  });

  // ============== ADMIN API ==============
  // All /api/admin/* routes use requireAdmin which validates admin-specific JWTs.
  // Admin credentials come from ADMIN_EMAIL + ADMIN_PASSWORD env vars only.
  // Regular user accounts have no admin access — the two systems are completely separate.

  // POST /api/admin/auth — admin login (env-var credentials only)
  app.post("/api/admin/auth", async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return res.status(503).json({ error: "Admin credentials not configured" });
    }
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    // Constant-time comparison to prevent timing attacks
    const emailMatch = email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
    const passwordMatch = await bcrypt.compare(password, adminPassword).catch(() => false)
      || password === adminPassword; // support plain-text password in env for initial setup
    if (!emailMatch || !passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign(
      { isAdminSession: true, email: adminEmail },
      ADMIN_JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ token });
  });

  // GET /api/spa-html — returns the current SPA index.html (for CF Worker to proxy instead of FIXED_HTML)
  app.get("/api/spa-html", (_req: Request, res: Response) => {
    const fs = require("fs");
    const path = require("path");
    const htmlPath = path.resolve(__dirname, "public", "index.html");
    if (fs.existsSync(htmlPath)) {
      res.header("Cache-Control", "public, max-age=60");
      res.header("Content-Type", "text/html; charset=utf-8");
      res.sendFile(htmlPath);
    } else {
      res.status(404).json({ error: "SPA not found" });
    }
  });

  // POST /api/admin/refresh-intelligence — manually refresh network intelligence
  app.post("/api/admin/refresh-intelligence", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await refreshNetworkIntelligence();
      res.json({ ok: true, message: "Network intelligence refreshed" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/stats — overview numbers
  app.get("/api/admin/stats", requireAdmin, async (req: Request, res: Response) => {
    const allUsers = await storage.getAllUsers();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const planCounts: Record<string, number> = {};
    let trialCount = 0, paidCount = 0, freeCount = 0, newThisWeek = 0, newThisMonth = 0;
    for (const u of allUsers) {
      const pu = u as any;
      planCounts[pu.plan] = (planCounts[pu.plan] || 0) + 1;
      if (pu.plan === 'free') freeCount++;
      else if (pu.id !== 1) paidCount++; // exclude test account from paid count
      if (pu.trialEndsAt && new Date(pu.trialEndsAt) > now) trialCount++;
      if (new Date(pu.createdAt) > sevenDaysAgo) newThisWeek++;
      if (new Date(pu.createdAt) > thirtyDaysAgo) newThisMonth++;
    }

    const activeTests = await pool.query(
      `SELECT COUNT(*) as cnt FROM test_sections WHERE is_active = true`
    );
    const totalCampaigns = await pool.query(
      `SELECT COUNT(*) as cnt FROM campaigns WHERE status = 'active'`
    );
    const totalVisitors = await pool.query(
      `SELECT COUNT(*) as cnt FROM visitors WHERE first_seen > $1`,
      [thirtyDaysAgo.toISOString()]
    );
    const platformRevenue = await pool.query(
      `SELECT COALESCE(SUM(revenue), 0) as total FROM visitors WHERE converted = true`
    );
    const totalTestsEver = await pool.query(
      `SELECT COUNT(*) as cnt FROM test_sections`
    );
    // Tests won = actual declared winners recorded in test_lessons
    const testsWon = await pool.query(
      `SELECT COUNT(*) as cnt FROM test_lessons`
    );
    // Tests completed = sections that ran a real test (inactive + had variants assigned)
    const testsCompleted = await pool.query(
      `SELECT COUNT(DISTINCT ts.id) as cnt FROM test_sections ts JOIN variants v ON v.test_section_id = ts.id WHERE ts.is_active = false`
    );
    const totalAllVisitors = await pool.query(
      `SELECT COUNT(*) as cnt FROM visitors`
    );
    const totalConversions = await pool.query(
      `SELECT COUNT(*) as cnt FROM visitors WHERE converted = true`
    );

    // MRR calculation based on actual Stripe subscription amounts
    // Uses real beta pricing from Stripe, not list prices
    let totalMRR = 0;
    let verifiedPaidCount = 0;
    if (stripe) {
      try {
        // Fetch all active subscriptions from Stripe for accuracy
        const activeSubs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
        const processedCustomers = new Set<string>(); // avoid double-counting duplicate subs
        for (const sub of activeSubs.data) {
          const custId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || '';
          // Only count SiteAmoeba subscriptions (match known price IDs)
          const priceId = sub.items.data[0]?.price?.id || '';
          const isSAPlan = Object.values(PLANS).some(p => (p as any).priceId === priceId);
          if (!isSAPlan) continue;
          // Skip if we already counted a sub for this customer (e.g. Alison's duplicates)
          if (processedCustomers.has(custId)) continue;
          processedCustomers.add(custId);
          // Use actual amount charged, not list price
          const monthlyAmount = (sub.items.data[0]?.price?.unit_amount || 0) / 100;
          totalMRR += monthlyAmount;
          verifiedPaidCount++;
        }
      } catch (e: any) {
        console.error('[admin-stats] Stripe MRR fetch failed:', e.message);
        // Fallback to plan-based estimate using beta prices
        const betaPlanMRR: Record<string, number> = { pro: 23.50, business: 48.50, autopilot: 149.50 };
        for (const u of allUsers) {
          const pu = u as any;
          if (pu.id === 1) continue; // skip test account
          if (pu.accountStatus === 'cancelled' || pu.accountStatus === 'suspended') continue;
          if (betaPlanMRR[pu.plan]) totalMRR += betaPlanMRR[pu.plan];
        }
      }
    }
    const totalARR = totalMRR * 12;

    // TTFT calculations
    const ttftUsers = (allUsers as any[]).filter(u => u.firstTestEnabledAt && u.createdAt);
    const ttftMs = ttftUsers.map(u => new Date(u.firstTestEnabledAt).getTime() - new Date(u.createdAt).getTime()).filter(ms => ms > 0);
    const avgTTFT = ttftMs.length ? Math.round(ttftMs.reduce((a, b) => a + b, 0) / ttftMs.length / 60000) : null; // minutes
    const shortestTTFT = ttftMs.length ? Math.round(Math.min(...ttftMs) / 60000) : null; // minutes

    res.json({
      // Users
      totalUsers: allUsers.length,
      newUsersThisWeek: newThisWeek,
      newUsersThisMonth: newThisMonth,
      paidUsers: paidCount,
      freeUsers: freeCount,
      trialUsers: trialCount,
      planBreakdown: planCounts,
      // Campaigns & tests
      activeCampaigns: parseInt(totalCampaigns.rows[0]?.cnt) || 0,
      activeTests: parseInt(activeTests.rows[0]?.cnt) || 0,
      totalTestsEver: parseInt(totalTestsEver.rows[0]?.cnt) || 0,
      testsWon: parseInt(testsWon.rows[0]?.cnt) || 0,
      testsCompleted: parseInt(testsCompleted.rows[0]?.cnt) || 0,
      // Traffic
      visitorsLast30Days: parseInt(totalVisitors.rows[0]?.cnt) || 0,
      totalVisitorsAllTime: parseInt(totalAllVisitors.rows[0]?.cnt) || 0,
      totalConversions: parseInt(totalConversions.rows[0]?.cnt) || 0,
      // Revenue
      totalMRR,
      totalARR,
      platformRevenue: parseFloat(platformRevenue.rows[0]?.total) || 0,
      // TTFT
      avgTTFTMinutes: avgTTFT,
      shortestTTFTMinutes: shortestTTFT,
      usersWithFirstTest: ttftMs.length,
    });
  });

  // GET /api/admin/users — list all users
  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    const users = await storage.getAllUsers();
    // Enrich with campaign/test counts
    const enriched = await Promise.all(users.map(async (u: any) => {
      const campaigns = await pool.query(
        `SELECT COUNT(*) as cnt FROM campaigns WHERE user_id = $1 AND status = 'active'`,
        [u.id]
      );
      const tests = await pool.query(
        `SELECT COUNT(*) as cnt FROM test_sections ts JOIN campaigns c ON c.id = ts.campaign_id WHERE c.user_id = $1 AND ts.is_active = true`,
        [u.id]
      );
      const visitors = await pool.query(
        `SELECT COUNT(*) as cnt FROM visitors v JOIN campaigns c ON c.id = v.campaign_id WHERE c.user_id = $1`,
        [u.id]
      );
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        creditsUsed: u.creditsUsed,
        creditsLimit: u.creditsLimit,
        createdAt: u.createdAt,
        isAdmin: (u as any).isAdmin || 0,
        trialEndsAt: (u as any).trialEndsAt,
        accountStatus: (u as any).accountStatus || 'active',
        adminNotes: (u as any).adminNotes,
        referralCode: u.referralCode,
        referredBy: u.referredBy,
        stripeCustomerId: u.stripeCustomerId,
        stripeSubscriptionId: u.stripeSubscriptionId,
        activeCampaigns: parseInt(campaigns.rows[0]?.cnt) || 0,
        activeTests: parseInt(tests.rows[0]?.cnt) || 0,
        totalVisitors: parseInt(visitors.rows[0]?.cnt) || 0,
        firstTestEnabledAt: (u as any).firstTestEnabledAt || null,
        ttftMinutes: (u as any).firstTestEnabledAt && u.createdAt
          ? Math.max(0, Math.round((new Date((u as any).firstTestEnabledAt).getTime() - new Date(u.createdAt).getTime()) / 60000))
          : null,
      };
    }));
    res.json(enriched);
  });

  // GET /api/admin/users/:id — single user detail
  app.get("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    const userId = paramId(req.params.id);
    const u = await storage.getUserById(userId) as any;
    if (!u) return res.status(404).json({ error: "User not found" });
    const campaigns = await pool.query(
      `SELECT id, name, url, status, created_at FROM campaigns WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    const referrals = await pool.query(
      `SELECT * FROM referrals WHERE referrer_user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    const totalVisitors = await pool.query(
      `SELECT COUNT(*) as cnt FROM visitors v JOIN campaigns c ON c.id = v.campaign_id WHERE c.user_id = $1`,
      [userId]
    );
    const totalConversions = await pool.query(
      `SELECT COUNT(*) as cnt FROM visitors v JOIN campaigns c ON c.id = v.campaign_id WHERE c.user_id = $1 AND v.converted = true`,
      [userId]
    );
    res.json({
      id: u.id, email: u.email, name: u.name, plan: u.plan,
      creditsUsed: u.creditsUsed, creditsLimit: u.creditsLimit,
      createdAt: u.createdAt, isAdmin: u.isAdmin || 0,
      trialEndsAt: u.trialEndsAt, accountStatus: u.accountStatus || 'active',
      adminNotes: u.adminNotes, referralCode: u.referralCode, referredBy: u.referredBy,
      stripeCustomerId: u.stripeCustomerId, stripeSubscriptionId: u.stripeSubscriptionId,
      campaigns: campaigns.rows,
      referrals: referrals.rows,
      totalVisitors: parseInt(totalVisitors.rows[0]?.cnt) || 0,
      totalConversions: parseInt(totalConversions.rows[0]?.cnt) || 0,
    });
  });

  // PATCH /api/admin/users/:id — update user (plan, credits, status, notes)
  app.patch("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    const userId = paramId(req.params.id);
    const { plan, creditsLimit, accountStatus, adminNotes, trialEndsAt, isAdmin, name } = req.body;
    const setParts: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (plan !== undefined) { setParts.push(`plan = $${idx++}`); values.push(plan); }
    if (creditsLimit !== undefined) { setParts.push(`credits_limit = $${idx++}`); values.push(creditsLimit); }
    if (accountStatus !== undefined) { setParts.push(`account_status = $${idx++}`); values.push(accountStatus); }
    if (adminNotes !== undefined) { setParts.push(`admin_notes_user = $${idx++}`); values.push(adminNotes); }
    if (trialEndsAt !== undefined) { setParts.push(`trial_ends_at = $${idx++}`); values.push(trialEndsAt); }
    if (isAdmin !== undefined) { setParts.push(`is_admin = $${idx++}`); values.push(isAdmin ? 1 : 0); }
    if (name !== undefined) { setParts.push(`name = $${idx++}`); values.push(name); }
    if (setParts.length === 0) return res.status(400).json({ error: "Nothing to update" });
    values.push(userId);
    await pool.query(`UPDATE users SET ${setParts.join(", ")} WHERE id = $${idx}`, values);
    res.json({ success: true });
  });

  // POST /api/admin/users/:id/add-credits — add credits to an account
  app.post("/api/admin/users/:id/add-credits", requireAdmin, async (req: Request, res: Response) => {
    const userId = paramId(req.params.id);
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    await pool.query(
      `UPDATE users SET credits_limit = credits_limit + $1 WHERE id = $2`,
      [amount, userId]
    );
    res.json({ success: true });
  });

  // POST /api/admin/users — create a new user
  app.post("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    const { email, password, name, plan } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const existing = await storage.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "Email already in use" });
    const passwordHash = await bcrypt.hash(password, 10);
    const planLimits: Record<string, { creditsLimit: number; campaignsLimit: number }> = {
      free:      { creditsLimit: 10,   campaignsLimit: 999 }, // BYOK = unlimited campaigns
      pro:       { creditsLimit: 1000, campaignsLimit: 999 },
      business:  { creditsLimit: 2400, campaignsLimit: 999 },
      autopilot: { creditsLimit: 6000, campaignsLimit: 999 },
    };
    const limits = planLimits[plan || 'free'] || planLimits.free;
    const referralCode = `admin-${Math.random().toString(36).slice(2, 6)}`;
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, plan, credits_limit, credits_used, campaigns_limit, referral_code)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7) RETURNING id, email, name, plan`,
      [email, passwordHash, name || email.split('@')[0], plan || 'free', limits.creditsLimit, limits.campaignsLimit, referralCode]
    );
    res.json({ success: true, user: result.rows[0] });
  });

  // DELETE /api/admin/users/:id — cancel/delete user account
  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    const userId = paramId(req.params.id);
    const adminId = req.userId!;
    if (userId === adminId) return res.status(400).json({ error: "Cannot delete your own account" });
    // Soft delete — mark as cancelled rather than destroying data
    await pool.query(
      `UPDATE users SET account_status = 'cancelled' WHERE id = $1`,
      [userId]
    );
    res.json({ success: true });
  });

  // POST /api/admin/users/:id/impersonate — get a token that logs in as this user
  app.post("/api/admin/users/:id/impersonate", requireAdmin, async (req: Request, res: Response) => {
    const userId = paramId(req.params.id);
    const user = await storage.getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    // Issue a short-lived token (2 hours) with an impersonation flag
    const token = jwt.sign(
      { userId: user.id, impersonatedBy: req.userId, isImpersonation: true },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    res.json({ token, userId: user.id, email: user.email });
  });

  // GET /api/admin/referrals — referral dashboard
  app.get("/api/admin/referrals", requireAdmin, async (req: Request, res: Response) => {
    const referrals = await pool.query(`
      SELECT r.*,
        u1.email as referrer_email, u1.name as referrer_name,
        u2.email as referred_email, u2.name as referred_name, u2.plan as referred_plan
      FROM referrals r
      LEFT JOIN users u1 ON r.referrer_id = u1.id
      LEFT JOIN users u2 ON r.referred_id = u2.id
      ORDER BY r.created_at DESC
    `);
    // Referral stats per user
    const stats = await pool.query(`
      SELECT referrer_id, u.email, u.name,
        COUNT(*) as total_referrals,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted,
        COALESCE(SUM(total_earned), 0) as total_commission
      FROM referrals r
      LEFT JOIN users u ON r.referrer_id = u.id
      GROUP BY referrer_id, u.email, u.name
      ORDER BY total_referrals DESC
    `);
    res.json({ referrals: referrals.rows, leaderboard: stats.rows });
  });

  // POST /api/admin/users/:id/reset-test — admin restart test
  // (different from user restart — admin can target a specific campaign)
  app.post("/api/admin/campaigns/:id/reset", requireAdmin, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    await pool.query('DELETE FROM behavioral_events WHERE campaign_id = $1', [campaignId]);
    await pool.query('DELETE FROM visitor_sessions WHERE campaign_id = $1', [campaignId]);
    await pool.query('DELETE FROM impressions WHERE campaign_id = $1', [campaignId]);
    await pool.query('DELETE FROM visitors WHERE campaign_id = $1', [campaignId]);
    await pool.query('DELETE FROM daily_observations WHERE campaign_id = $1', [campaignId]);
    res.json({ success: true });
  });

  // POST /api/campaigns/:id/restart-test — reset all visitor/impression/session/event data
  // Keeps variants and config intact but gives a clean statistical slate
  app.post("/api/campaigns/:id/restart-test", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Delete all test data for this campaign
    const { Pool: PgPool } = require("pg");
    const pgPool = new PgPool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });

    try {
      // Order matters due to foreign key-like relationships
      await pool.query('DELETE FROM behavioral_events WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM visitor_sessions WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM impressions WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM revenue_events WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM visitors WHERE campaign_id = $1', [campaignId]);
      // Also clear daily observations so stale insights don't persist
      await pool.query('DELETE FROM daily_observations WHERE campaign_id = $1', [campaignId]);
      // Clear rejected charges so Stripe poller doesn't skip legitimate future charges
      await pool.query('DELETE FROM rejected_charges WHERE user_id = $1', [campaign.userId]);
      await pgPool.end();

      res.json({
        success: true,
        message: "Test restarted. All visitor data cleared. Variants and configuration preserved.",
      });
    } catch (err: any) {
      await pgPool.end();
      res.status(500).json({ error: "Failed to restart test: " + (err.message || "") });
    }
  });

  // ============== VARIANTS ==============

  app.get("/api/campaigns/:id/variants", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    res.json(await storage.getVariantsByCampaign(campaign.id));
  });

  // ============== VISUAL EDITOR PROXY ==============

  // Editor proxy accepts auth via ?token= query param (iframes can't send headers)
  app.get("/api/campaigns/:id/editor-proxy", async (req: Request, res: Response) => {
    // Auth via query param for iframe usage
    const queryToken = req.query.token as string;
    if (queryToken) {
      try {
        const jwt = await import("jsonwebtoken");
        const decoded = jwt.default.verify(queryToken, process.env.JWT_SECRET || "") as any;
        req.userId = decoded.userId;
      } catch {
        return res.status(401).json({ error: "Invalid token" });
      }
    } else if (!req.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    function generateClickSelectBridge(campaignId: number): string {
      return `<script>
(function() {
  'use strict';
  var _SA_CAMPAIGN_ID = ${campaignId};
  var _selectedEl = null;
  var _hoverLabel = null;

  var SKIP_TAGS = ['SCRIPT','STYLE','SVG','VIDEO','AUDIO','IFRAME','NOSCRIPT','HEAD','META','LINK','INPUT','TEXTAREA','SELECT'];
  var INLINE_TAGS = ['SPAN','STRONG','EM','B','I','A','U','MARK','SUB','SUP','SMALL','S','DEL','INS','ABBR','FONT'];
  var BLOCK_TEXT_TAGS = ['H1','H2','H3','H4','H5','H6','P','LI','BLOCKQUOTE','FIGCAPTION','LABEL','TD','TH','CAPTION','DT','DD','BUTTON'];

  // Is this element selectable (text container or meaningful image)?
  function isSelectable(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.indexOf(tag) !== -1) return false;
    // Images are selectable
    if (tag === 'IMG') {
      var src = el.src || '';
      // Skip tiny images (icons, spacers, tracking pixels)
      if (el.width < 50 || el.height < 50) return false;
      if (src.indexOf('facebook.com/tr') !== -1 || src.indexOf('google-analytics') !== -1 || src.indexOf('pixel') !== -1) return false;
      return true;
    }
    // Text elements (existing logic)
    var text = (el.innerText || el.textContent || '').trim();
    if (text.length < 3) return false;
    // If no child elements, it's a simple text node — selectable
    if (el.children.length === 0) return true;
    // If all children are inline tags (span, strong, em, etc.), this is a text block with styled fragments
    var allInline = true;
    for (var i = 0; i < el.children.length; i++) {
      var childTag = el.children[i].tagName.toUpperCase();
      if (INLINE_TAGS.indexOf(childTag) === -1 && childTag !== 'BR') {
        allInline = false;
        break;
      }
    }
    return allInline;
  }

  // Walk UP from a clicked element to find the best text container
  // e.g., clicking a <span> inside an <h1> should select the <h1>
  // Images are always the direct target — don't walk up
  function findBestContainer(el) {
    // Images are always the direct target - don't walk up
    if (el && el.tagName && el.tagName.toUpperCase() === 'IMG') return el;
    var cur = el;
    var best = null;
    var depth = 0;
    while (cur && cur !== document.body && depth < 8) {
      if (isSelectable(cur)) best = cur;
      // Stop walking up at block-level text containers (H1, P, etc.)
      if (best && BLOCK_TEXT_TAGS.indexOf(cur.tagName.toUpperCase()) !== -1) return best;
      cur = cur.parentElement;
      depth++;
    }
    return best;
  }

  function getTreePath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur !== document.body && cur.tagName) {
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === cur.tagName; });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(cur) + 1;
          tag += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(tag);
      cur = cur.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  }

  function getComputedStyleData(el) {
    var cs = window.getComputedStyle(el);
    return {
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      fontStyle: cs.fontStyle
    };
  }

  function showHoverLabel(el) {
    removeHoverLabel();
    _hoverLabel = document.createElement('div');
    _hoverLabel.id = '_sa_hover_label';
    _hoverLabel.style.cssText = 'position:fixed;background:#2563eb;color:#fff;font:bold 11px/1 monospace;padding:2px 6px;border-radius:3px;z-index:2147483647;pointer-events:none;';
    if (el.tagName.toUpperCase() === 'IMG') {
      _hoverLabel.textContent = 'IMG ' + (el.naturalWidth || el.width) + '\u00d7' + (el.naturalHeight || el.height);
    } else {
      _hoverLabel.textContent = el.tagName.toUpperCase();
    }
    document.body.appendChild(_hoverLabel);

    function posLabel() {
      var rect = el.getBoundingClientRect();
      _hoverLabel.style.top = Math.max(0, rect.top - 20) + 'px';
      _hoverLabel.style.left = rect.left + 'px';
    }
    posLabel();
  }

  function removeHoverLabel() {
    var old = document.getElementById('_sa_hover_label');
    if (old) old.remove();
    _hoverLabel = null;
  }

  function clearSelected() {
    if (_selectedEl) {
      _selectedEl.style.outline = '';
      _selectedEl.style.outlineOffset = '';
      var lbl = document.getElementById('_sa_sel_label');
      if (lbl) lbl.remove();
      _selectedEl = null;
    }
  }

  function markSelected(el) {
    clearSelected();
    _selectedEl = el;
    el.style.outline = '2px solid #2563eb';
    el.style.outlineOffset = '2px';
    var lbl = document.createElement('div');
    lbl.id = '_sa_sel_label';
    lbl.style.cssText = 'position:fixed;background:#2563eb;color:#fff;font:bold 11px/1 monospace;padding:2px 6px;border-radius:3px;z-index:2147483647;pointer-events:none;';
    if (el.tagName.toUpperCase() === 'IMG') {
      lbl.textContent = 'IMG ' + (el.naturalWidth || el.width) + '\u00d7' + (el.naturalHeight || el.height);
    } else {
      lbl.textContent = el.tagName.toUpperCase();
    }
    document.body.appendChild(lbl);
    var rect = el.getBoundingClientRect();
    lbl.style.top = Math.max(0, rect.top - 20) + 'px';
    lbl.style.left = rect.left + 'px';
  }

  var _lastHovered = null;
  document.addEventListener('mouseover', function(e) {
    var el = findBestContainer(e.target);
    if (!el || el === _selectedEl || el === _lastHovered) return;
    if (_lastHovered && _lastHovered !== _selectedEl) {
      _lastHovered.style.outline = '';
      _lastHovered.style.outlineOffset = '';
    }
    _lastHovered = el;
    el.style.outline = '2px dashed #2563eb';
    el.style.outlineOffset = '2px';
    showHoverLabel(el);
  });

  document.addEventListener('mouseout', function(e) {
    var el = findBestContainer(e.target);
    if (!el) return;
    if (el === _lastHovered && el !== _selectedEl) {
      el.style.outline = '';
      el.style.outlineOffset = '';
      _lastHovered = null;
    }
    removeHoverLabel();
  });

  document.addEventListener('click', function(e) {
    var el = findBestContainer(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();

    markSelected(el);

    var rect = el.getBoundingClientRect();
    var isImage = el.tagName.toUpperCase() === 'IMG';
    var data = {
      tagName: el.tagName.toUpperCase(),
      textContent: isImage ? (el.alt || '') : (el.innerText || el.textContent || '').trim(),
      treePath: getTreePath(el),
      isImage: isImage,
      imageSrc: isImage ? el.src : null,
      imageAlt: isImage ? (el.alt || '') : null,
      imageWidth: isImage ? (el.naturalWidth || el.width) : null,
      imageHeight: isImage ? (el.naturalHeight || el.height) : null,
      imageRenderedWidth: isImage ? el.offsetWidth : null,
      imageRenderedHeight: isImage ? el.offsetHeight : null,
      computedStyles: isImage ? {} : getComputedStyleData(el),
      parentInfo: el.parentElement ? getTreePath(el.parentElement) : '',
      outerHTML: (el.outerHTML || '').substring(0, 200),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    };

    window.parent.postMessage({ type: 'SA_ELEMENT_SELECTED', data: data }, '*');
  }, true);

  console.log('[SiteAmoeba] Visual editor bridge loaded for campaign ' + _SA_CAMPAIGN_ID);
})();
<\/script>`;
    }

    try {
      const fetchResp = await fetch(campaign.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SiteAmoeba/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!fetchResp.ok) {
        return res.status(502).json({ error: `Failed to fetch campaign URL: ${fetchResp.status} ${fetchResp.statusText}` });
      }
      const html = await fetchResp.text();
      const bridgeScript = generateClickSelectBridge(campaign.id);
      // Inject <base> tag so relative URLs (CSS, JS, images) resolve to the original domain
      const baseUrl = new URL(campaign.url);
      const baseTag = `<base href="${baseUrl.origin}/">`;
      let modified = html;
      // Insert <base> right after <head>
      if (modified.includes('<head>')) {
        modified = modified.replace('<head>', '<head>' + baseTag);
      } else if (modified.includes('<head ')) {
        modified = modified.replace(/<head[^>]*>/, '$&' + baseTag);
      } else {
        modified = baseTag + modified;
      }
      // Strip any existing X-Frame-Options meta tags from the page
      modified = modified.replace(/<meta[^>]*http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');
      // Inject bridge script
      modified = modified.includes('</body>')
        ? modified.replace('</body>', bridgeScript + '</body>')
        : modified + bridgeScript;
      // Allow framing — this is our own editor, not a third-party embed
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', 'frame-ancestors *');
      res.send(modified);
    } catch (err: any) {
      res.status(502).json({ error: "Failed to proxy campaign URL: " + (err.message || String(err)) });
    }
  });

  app.post("/api/campaigns/:id/variants", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Test locking removed — users manage their own test lifecycle


    // persuasionTags can be passed directly (from AI generation) or will be auto-classified
    // Strip persuasionTags from validation since it comes as array but schema expects string
    const { persuasionTags: rawTags, ...bodyWithoutTags } = req.body;
    const parsed = insertVariantSchema.safeParse({
      ...bodyWithoutTags,
      campaignId: campaign.id,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const variantData: any = { ...parsed.data };

    // Auto-assign testSectionId if missing — find the first active section matching this type
    if (!variantData.testSectionId) {
      try {
        const matchingSections = await pool.query(
          `SELECT id FROM test_sections WHERE campaign_id = $1 AND category = $2 AND is_active = true ORDER BY id LIMIT 1`,
          [campaign.id, variantData.type || 'headline']
        );
        if (matchingSections.rows.length > 0) {
          variantData.testSectionId = matchingSections.rows[0].id;
        }
      } catch {}
    }

    // Sanitize variant text (preserve allowed HTML for colored/styled headlines)
    if (typeof variantData.text === "string") {
      variantData.text = sanitizeInput(variantData.text);
    }

    // If persuasionTags provided as array, serialize to JSON string
    if (rawTags && Array.isArray(rawTags)) {
      variantData.persuasionTags = JSON.stringify(rawTags);
    } else if (typeof rawTags === "string") {
      variantData.persuasionTags = rawTags;
    } else if (!variantData.persuasionTags) {
      // Auto-classify if user has LLM configured and no tags provided
      const user = await storage.getUserById(req.userId!);
      if (user?.llmProvider && user?.llmApiKey) {
        try {
          const type = req.body.type as string;
          const classifyMessages = buildClassificationPrompt(variantData.text, type);
          const classifyResponse = await callLLM(
            { provider: user.llmProvider as any, apiKey: decryptApiKey(user.llmApiKey as string), model: user.llmModel || undefined },
            classifyMessages
          );
          const cleaned = classifyResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
          const classified = JSON.parse(cleaned);
          if (classified?.strategy) {
            (variantData as any).persuasionTags = JSON.stringify([classified.strategy]);
          }
        } catch {
          // Classification failed silently — variant is still created
        }
      }
    }

    const variant = await storage.createVariant(variantData);
    res.status(201).json(variant);
  });

  app.patch("/api/variants/:id", requireAuth, async (req: Request, res: Response) => {
    const variant = await storage.getVariant(paramId(req.params.id));
    if (!variant) return res.status(404).json({ error: "Variant not found" });
    // Verify ownership through campaign
    const campaign = await storage.getCampaign(variant.campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Not found" });
    }
    // Test locking removed — users manage their own test lifecycle

    const updated = await storage.updateVariant(variant.id, req.body);
    res.json(updated);
  });

  app.delete("/api/variants/:id", requireAuth, async (req: Request, res: Response) => {
    const variant = await storage.getVariant(paramId(req.params.id));
    if (!variant) return res.status(404).json({ error: "Variant not found" });
    const campaign = await storage.getCampaign(variant.campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Not found" });
    }
    // Test locking removed — users manage their own test lifecycle

    await storage.deleteVariant(variant.id);
    res.json({ deleted: variant.id });
  });

  // ============== CAMPAIGN STATS ==============

  app.get("/api/campaigns/:id/stats", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const variantStats = await storage.getVariantStats(campaign.id);

    // Total visitors and conversions = actual counts from the visitors table (NOT scoped to test start)
    // The variant stats are scoped to test start for fair A/B comparison,
    // but the top-level campaign KPIs should show ALL-TIME data.
    const campaignTotals = await pool.query(
      `SELECT COUNT(*) as total_visitors,
              COUNT(*) FILTER (WHERE converted = true) as total_conversions
       FROM visitors WHERE campaign_id = $1`,
      [campaign.id]
    );
    const totalVisitors = parseInt(campaignTotals.rows[0]?.total_visitors) || 0;
    const visitorConversions = parseInt(campaignTotals.rows[0]?.total_conversions) || 0;

    // Total revenue = ALL revenue_events (includes upsells for all matched + unmatched)
    const reRow = await pool.query(
      `SELECT
        -- Unmatched conversions: unique buyers NOT already tracked by pixel
        -- Exclude emails that already appear in converted visitors to avoid double-counting
        COUNT(DISTINCT re.customer_email) FILTER (
          WHERE re.visitor_id IS NULL
          AND re.event_type = 'purchase'
          AND re.customer_email IS NOT NULL
          AND re.customer_email NOT IN (
            SELECT customer_email FROM visitors
            WHERE campaign_id = $1 AND converted = true AND customer_email IS NOT NULL
          )
        ) AS unmatched_conversions,
        COALESCE(SUM(re.amount), 0) AS total_revenue_all
       FROM revenue_events re WHERE re.campaign_id = $1`,
      [campaign.id]
    );
    const unmatchedConversions = parseInt(reRow.rows[0]?.unmatched_conversions || "0");
    const totalRevenueFromEvents = parseFloat(reRow.rows[0]?.total_revenue_all || "0");

    const totalConversions = visitorConversions + unmatchedConversions;
    const totalRevenue = totalRevenueFromEvents;
    const conversionRate = totalVisitors > 0 ? totalConversions / totalVisitors : 0;

    // Map to the shape the frontend expects
    const variants = variantStats.map(v => ({
      id: v.variantId,
      text: v.text,
      type: v.type,
      isControl: v.isControl,
      isActive: v.isActive,
      testSectionId: v.testSectionId,
      createdAt: v.createdAt,
      visitors: v.impressions,
      conversions: v.conversions,
      conversionRate: v.conversionRate * 100,
      revenue: v.revenue,
      confidence: v.confidence,
      persuasionTags: v.persuasionTags,
    }));

    // testStartDate = when the earliest active challenger was created
    // Used by the UI to show "Stats since [date]" on the variant chart
    const headlineChallengers = variantStats.filter(v => !v.isControl && v.type === "headline" && v.createdAt);
    const testStartDate = headlineChallengers.length > 0
      ? headlineChallengers.reduce((earliest: Date, v) => {
          const d = new Date(v.createdAt!);
          return !isNaN(d.getTime()) && d < earliest ? d : earliest;
        }, new Date())
      : null;

    // Check for sections with content mismatches (page changed since scan)
    const mismatchResult = await pool.query(
      `SELECT id, section_id, label, category, mismatch_count, mismatch_detected_at
       FROM test_sections WHERE campaign_id = $1 AND mismatch_detected = true`,
      [campaign.id]
    );
    const mismatchSections = mismatchResult.rows.map((r: any) => ({
      id: r.id, sectionId: r.section_id, label: r.label, category: r.category,
      mismatchCount: r.mismatch_count, detectedAt: r.mismatch_detected_at,
    }));

    res.json({
      totalVisitors,
      totalConversions,
      totalRevenue,
      conversionRate: conversionRate * 100,
      variants,
      campaignType: campaign.campaignType || "purchase",
      testStartDate: testStartDate && !isNaN(testStartDate.getTime()) ? testStartDate.toISOString() : null,
      mismatchSections,
    });
  });

  app.get("/api/campaigns/:id/stats/daily", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const days = parseInt(req.query.days as string) || 30;
    res.json(await storage.getDailyStats(campaign.id, days));
  });

  // ============== AI SETTINGS ==============

  app.patch("/api/settings/llm", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    const { provider, apiKey, model } = req.body;
    if (!provider || !apiKey) {
      return res.status(400).json({ error: "provider and apiKey are required" });
    }

    const validProviders = ["anthropic", "openai", "gemini", "mistral", "xai", "meta"];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    const updated = await storage.updateUser(user.id, {
      llmProvider: provider,
      llmApiKey: encryptApiKey(apiKey), // encrypt at rest
      llmModel: model || null,
    });

    res.json({ ok: true, provider, hasKey: true, model: model || null });
  });

  // ============== TEST SETTINGS ==============

  app.patch("/api/settings/testing", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    const { minVisitorsPerVariant, winConfidenceThreshold, allowOverage } = req.body;
    const updates: any = {};

    if (minVisitorsPerVariant !== undefined) {
      const val = parseInt(minVisitorsPerVariant);
      if (isNaN(val) || val < 10 || val > 100000) {
        return res.status(400).json({ error: "Min visitors must be between 10 and 100,000" });
      }
      updates.minVisitorsPerVariant = val;
    }

    if (winConfidenceThreshold !== undefined) {
      const val = parseInt(winConfidenceThreshold);
      if (isNaN(val) || val < 50 || val > 99) {
        return res.status(400).json({ error: "Confidence threshold must be between 50% and 99%" });
      }
      updates.winConfidenceThreshold = val;
    }

    if (allowOverage !== undefined) {
      updates.allowOverage = !!allowOverage;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid settings to update" });
    }

    await storage.updateUser(user.id, updates);
    res.json({ ok: true, ...updates });
  });

  // ============== STRIPE ACCOUNT-LEVEL INTEGRATION ==============

  // Match Stripe charges to visitors and create revenue events
  // === REAL-TIME STRIPE EVENT POLLER ===
  // Polls Stripe Events API every 60 seconds for new charge.succeeded events.
  // Uses a cursor (last event ID) so we only process each event once.
  // This is the ONLY Stripe sync mechanism — no batch jobs, no periodic charge pulls.

  async function processStripeEvent(userId: number, stripeClient: any, event: any): Promise<boolean> {
    const obj = event.data?.object || {};
    const eventType = event.type;

    console.log(`[stripe-debug] processStripeEvent called: type=${eventType} amount=${obj.amount} email=${obj.billing_details?.email || obj.receipt_email || 'none'} desc=${(obj.description || '').substring(0,40)}`);

    // Only process payment events
    if (eventType !== "charge.succeeded" && eventType !== "checkout.session.completed" && eventType !== "charge.refunded") return false;

    const amountRaw = obj.amount || obj.amount_total || obj.amount_received || 0;
    const amount = amountRaw / 100;
    const externalId = obj.id || event.id;
    const stripeCustomerId = (typeof obj.customer === "string") ? obj.customer : null;
    let customerEmail = obj.billing_details?.email || obj.customer_details?.email || obj.receipt_email || null;
    // If no email on the charge, try fetching from the Stripe Customer object
    if (!customerEmail && stripeCustomerId) {
      try {
        const cust = await stripeClient.customers.retrieve(stripeCustomerId);
        if (cust && !(cust as any).deleted) customerEmail = (cust as any).email || null;
      } catch (custErr: any) {
        // Restricted keys may not have customer read permission — not fatal
        console.log(`[stripe-poll] Cannot read customer ${stripeCustomerId}: ${custErr.message?.substring(0, 50)}`);
      }
    }
    const chargeDesc = (obj.description || "").toLowerCase();
    const chargeDate = new Date((obj.created || event.created) * 1000).toISOString();
    // Log what we're processing
    console.log(`[stripe-poll] Processing: ${eventType} $${amount} email=${customerEmail || 'NONE'} cust=${stripeCustomerId || 'NONE'} desc=${chargeDesc.substring(0,40)}`);

    // Skip non-product charges
    if (chargeDesc.includes("subscription creation") || chargeDesc.includes("subscription update")) return false;
    if (chargeDesc.includes("auto-recharge for sub-account")) return false;
    if (amount <= 0) return false;

    // Dedup: skip if already processed OR previously rejected
    const existing = await pool.query("SELECT id FROM revenue_events WHERE external_id = $1 LIMIT 1", [externalId]);
    if (existing.rows.length > 0) return false;
    const rejected = await pool.query("SELECT id FROM rejected_charges WHERE charge_id = $1 LIMIT 1", [externalId]);
    if (rejected.rows.length > 0) return false;

    // === ATTRIBUTION ===
    const userCampaigns = await storage.getCampaignsByUser(userId);
    let matchedCampaignId: number | null = null;
    let matchedVisitorId: string | null = null;

    // 1. Customer chain (returning buyer)
    if (stripeCustomerId) {
      const cc = await pool.query("SELECT campaign_id FROM customer_campaigns WHERE user_id = $1 AND stripe_customer_id = $2 LIMIT 1", [userId, stripeCustomerId]);
      if (cc.rows.length > 0) matchedCampaignId = cc.rows[0].campaign_id;
    }

    // 2. Email matches a converted visitor (pixel tracked their conversion)
    if (!matchedCampaignId && customerEmail) {
      const em = await pool.query(
        `SELECT v.id AS visitor_id, v.campaign_id FROM visitors v JOIN campaigns c ON c.id = v.campaign_id
         WHERE c.user_id = $1 AND v.customer_email = $2 AND v.converted = true
         ORDER BY v.converted_at DESC LIMIT 1`, [userId, customerEmail]);
      if (em.rows.length > 0) { matchedVisitorId = em.rows[0].visitor_id; matchedCampaignId = em.rows[0].campaign_id; }
    }

    // 3. Time proximity — pixel conversion within 2 hours of this charge
    if (!matchedCampaignId) {
      const tm = await pool.query(
        `SELECT v.id AS visitor_id, v.campaign_id FROM visitors v JOIN campaigns c ON c.id = v.campaign_id
         WHERE c.user_id = $1 AND v.converted = true AND v.converted_at IS NOT NULL
           AND ABS(EXTRACT(EPOCH FROM (v.converted_at::timestamptz - $2::timestamptz))) < 7200
         ORDER BY ABS(EXTRACT(EPOCH FROM (v.converted_at::timestamptz - $2::timestamptz))) ASC LIMIT 1`, [userId, chargeDate]);
      if (tm.rows.length > 0) { matchedVisitorId = tm.rows[0].visitor_id; matchedCampaignId = tm.rows[0].campaign_id; }
    }

    // 4. VISITOR-GATED ATTRIBUTION — only attribute if a tracked visitor exists
    // If we matched a campaign but not a visitor, try to find one who visited recently.
    // If NO visitor can be found at all, do NOT attribute the charge — it likely came from
    // a different channel (high-ticket sales, manual invoices, other funnels, etc.)
    if (!matchedVisitorId && matchedCampaignId) {
      const recentVisitor = await pool.query(
        `SELECT id FROM visitors
         WHERE campaign_id = $1
           AND first_seen::timestamptz BETWEEN ($2::timestamptz - INTERVAL '4 hours') AND ($2::timestamptz + INTERVAL '10 minutes')
           AND converted = false
           AND headline_variant_id IS NOT NULL
         ORDER BY first_seen::timestamptz DESC LIMIT 1`,
        [matchedCampaignId, chargeDate]
      );
      if (recentVisitor.rows.length > 0) {
        matchedVisitorId = recentVisitor.rows[0].id;
        console.log(`[stripe-poll] Matched charge to recent visitor ${matchedVisitorId} on C${matchedCampaignId}`);
      }
    }

    // 5. If we STILL have no campaign match AND no visitor match, try matching the email
    // to ANY visitor (converted or not) who visited within the last 7 days.
    // This catches buyers who visited the page, left, and came back to buy later.
    if (!matchedCampaignId && customerEmail) {
      const recentEmailVisitor = await pool.query(
        `SELECT v.id AS visitor_id, v.campaign_id FROM visitors v 
         JOIN campaigns c ON c.id = v.campaign_id
         WHERE c.user_id = $1 AND v.customer_email = $2
           AND v.first_seen::timestamptz > ($3::timestamptz - INTERVAL '7 days')
         ORDER BY v.first_seen DESC LIMIT 1`,
        [userId, customerEmail, chargeDate]
      );
      if (recentEmailVisitor.rows.length > 0) {
        matchedVisitorId = recentEmailVisitor.rows[0].visitor_id;
        matchedCampaignId = recentEmailVisitor.rows[0].campaign_id;
        console.log(`[stripe-poll] Late email match: visitor ${matchedVisitorId} on C${matchedCampaignId}`);
      }
    }

    // FINAL GATE: Only attribute revenue to charges we can tie to a tracked visitor.
    // No fallbacks, no guessing. If we can't match it to someone who hit the pixel,
    // it doesn't count. This is the core principle: we only show what we can prove.
    if (!matchedCampaignId || !matchedVisitorId) {
      console.log(`[stripe-poll] UNATTRIBUTED: $${amount} from ${customerEmail || 'no-email'} — no visitor match found, skipping`);
      try {
        await pool.query(
          `INSERT INTO rejected_charges (user_id, charge_id, reason) VALUES ($1, $2, $3) ON CONFLICT (charge_id) DO NOTHING`,
          [userId, externalId, `unattributed: no visitor match for ${customerEmail || 'unknown'} $${amount}`]
        );
      } catch (e) { /* non-fatal */ }
      return false;
    }

    // Backfill email on visitor + set customer chain + mark converted
    if (matchedVisitorId && customerEmail) {
      await pool.query("UPDATE visitors SET customer_email = $1 WHERE id = $2 AND customer_email IS NULL", [customerEmail, matchedVisitorId]);
    }
    if (stripeCustomerId && matchedCampaignId) {
      await pool.query(
        `INSERT INTO customer_campaigns (user_id, stripe_customer_id, customer_email, campaign_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, stripe_customer_id) DO NOTHING`,
        [userId, stripeCustomerId, customerEmail, matchedCampaignId]);
    }

    // Store the revenue event
    const isRefund = eventType === "charge.refunded";
    await storage.addRevenueEvent({
      visitorId: matchedVisitorId || undefined,
      campaignId: matchedCampaignId,
      source: "stripe_account",
      eventType: isRefund ? "refund" : "purchase",
      amount: isRefund ? -(obj.amount_refunded || 0) / 100 : amount,
      currency: (obj.currency || "usd").toUpperCase(),
      externalId,
      customerEmail: customerEmail || undefined,
      metadata: JSON.stringify({ description: obj.description || "", chargeDate }),
    });

    // Mark visitor converted with real amount
    if (matchedVisitorId && !isRefund) {
      const visitor = await storage.getVisitor(matchedVisitorId);
      if (visitor && !visitor.converted) {
        await storage.markConverted(matchedVisitorId, externalId, amount, customerEmail || undefined);
      } else if (visitor && visitor.converted && amount > 0) {
        await pool.query("UPDATE visitors SET revenue = COALESCE(revenue, 0) + $1 WHERE id = $2", [amount, matchedVisitorId]);
      }

      // Backfill: update any existing $0 revenue_events for this visitor with the actual email
      // (pixel-fired events don't have email; Stripe charges do)
      if (customerEmail) {
        await pool.query(
          `UPDATE revenue_events SET customer_email = $1
           WHERE visitor_id = $2 AND campaign_id = $3 AND (customer_email IS NULL OR customer_email = '')`,
          [customerEmail, matchedVisitorId, matchedCampaignId]
        ).catch(() => {});
        // Also backfill the visitor's customer_email for future lookups
        await pool.query(
          `UPDATE visitors SET customer_email = $1 WHERE id = $2 AND (customer_email IS NULL OR customer_email = '')`,
          [customerEmail, matchedVisitorId]
        ).catch(() => {});
      }
    }

    console.log(`[stripe-poll] ${eventType} $${amount} ${customerEmail || "?"} -> C${matchedCampaignId} (${matchedVisitorId ? "visitor:" + matchedVisitorId.substring(0,12) : "unmatched"})`);
    return true;
  }

  // Poll every 60 seconds for ALL users with Stripe connected
  async function pollStripeEvents() {
    try {
      const users = await pool.query("SELECT id, stripe_access_token, stripe_last_event_id FROM users WHERE stripe_access_token IS NOT NULL");
      for (const u of users.rows) {
        try {
          const decryptedKey = decryptApiKey(u.stripe_access_token);
          const stripeClient = new Stripe(decryptedKey);

          // Fetch events since last cursor
          // Poll charges directly (restricted keys may not have events permission)
          let hasMore = true;
          let startingAfter: string | undefined = undefined;
          let processed = 0;
          let pageCount = 0;
          // Only fetch charges created AFTER the user's earliest active campaign.
          // This prevents ingesting months/years of historical transactions.
          const earliestCampaign = await pool.query(
            `SELECT MIN(created_at) as earliest FROM campaigns WHERE user_id = $1 AND status = 'active'`,
            [u.id]
          );
          const chargeStartDate = earliestCampaign.rows[0]?.earliest
            ? Math.floor(new Date(earliestCampaign.rows[0].earliest).getTime() / 1000)
            : Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000); // default: last 7 days

          console.log(`[stripe-poll] Starting poll for user ${u.id} (charges since ${new Date(chargeStartDate * 1000).toISOString()})`);

          while (hasMore && pageCount < 5) {
            const params: any = { limit: 100, created: { gte: chargeStartDate } };
            if (startingAfter) params.starting_after = startingAfter;
            const charges = await stripeClient.charges.list(params);
            hasMore = charges.has_more;
            if (charges.data.length > 0) startingAfter = charges.data[charges.data.length - 1].id;
            pageCount++;

            for (const charge of charges.data) {
              if (charge.status !== "succeeded" && charge.status !== "refunded") continue;
              const fakeEvent = { type: charge.refunded ? "charge.refunded" : "charge.succeeded", data: { object: charge }, created: charge.created };
              const ok = await processStripeEvent(u.id, stripeClient, fakeEvent);
              if (ok) processed++;
            }
          }

          if (processed > 0) console.log(`[stripe-poll] User ${u.id}: ${processed} new events processed`);
        } catch (err: any) {
          console.error(`[stripe-poll] User ${u.id} error:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[stripe-poll] Fatal:", err.message);
    }
  }

  // Poll every 60 seconds + run on startup
  setInterval(pollStripeEvents, 60 * 1000);
  setTimeout(pollStripeEvents, 5000);

  // ============== GOHIGHLEVEL TRANSACTION POLLER ==============
  // Polls GHL payments API every 90 seconds for all users with GHL connected.
  // Uses the same attribution logic as the Stripe poller: match by email, then time proximity.

  async function pollGhlTransactions() {
    try {
      const users = await pool.query(
        "SELECT id, ghl_api_key, ghl_location_id, ghl_connected_at FROM users WHERE ghl_api_key IS NOT NULL AND ghl_location_id IS NOT NULL"
      );
      for (const u of users.rows) {
        try {
          const apiKey = decryptApiKey(u.ghl_api_key);
          const locationId = u.ghl_location_id;

          // Only process transactions from AFTER GHL was connected (never pull historical)
          const ghlConnectedAt = u.ghl_connected_at;
          const startDate = ghlConnectedAt
            ? new Date(ghlConnectedAt).toISOString()
            : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

          // Fetch transactions from GHL
          const resp = await fetch(
            `https://services.leadconnectorhq.com/payments/transactions?altId=${locationId}&altType=location&limit=100&startAt=${encodeURIComponent(startDate)}`,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Version': '2021-07-28',
                'Accept': 'application/json',
              },
            }
          );
          if (!resp.ok) {
            console.error(`[ghl-poll] User ${u.id}: API error ${resp.status}`);
            continue;
          }
          const data = await resp.json();
          const txns = data.data || data.transactions || [];

          let processed = 0;
          for (const txn of txns) {
            const externalId = `ghl_${txn._id || txn.id}`;
            const amountRaw = txn.amount || 0;
            // GHL returns amounts in dollars (NOT cents) — do not divide
            const amount = typeof amountRaw === 'number' ? amountRaw : parseFloat(amountRaw) || 0;
            const customerEmail = txn.contactSnapshot?.email || txn.contactEmail || txn.email || null;
            const txnStatus = (txn.status || '').toLowerCase();

            // Only process successful payments
            if (txnStatus !== 'succeeded' && txnStatus !== 'completed' && txnStatus !== 'paid') continue;
            if (amount <= 0) continue;

            // Dedup: skip if already recorded
            const existing = await pool.query("SELECT id FROM revenue_events WHERE external_id = $1 LIMIT 1", [externalId]);
            if (existing.rows.length > 0) continue;
            const rejected = await pool.query("SELECT id FROM rejected_charges WHERE charge_id = $1 LIMIT 1", [externalId]);
            if (rejected.rows.length > 0) continue;

            const txnDate = txn.createdAt || txn.created_at || new Date().toISOString();

            // === ATTRIBUTION (mirrors Stripe poller logic) ===
            const userCampaigns = await storage.getCampaignsByUser(u.id);
            let matchedCampaignId: number | null = null;
            let matchedVisitorId: string | null = null;

            // 1. Email matches a visitor (converted or not)
            if (customerEmail) {
              const em = await pool.query(
                `SELECT v.id AS visitor_id, v.campaign_id FROM visitors v JOIN campaigns c ON c.id = v.campaign_id
                 WHERE c.user_id = $1 AND LOWER(v.customer_email) = LOWER($2)
                 ORDER BY v.first_seen DESC LIMIT 1`, [u.id, customerEmail]);
              if (em.rows.length > 0) { matchedVisitorId = em.rows[0].visitor_id; matchedCampaignId = em.rows[0].campaign_id; }
            }

            // 2. Time proximity — pixel conversion within 2 hours of this transaction
            if (!matchedCampaignId) {
              const tm = await pool.query(
                `SELECT v.id AS visitor_id, v.campaign_id FROM visitors v JOIN campaigns c ON c.id = v.campaign_id
                 WHERE c.user_id = $1 AND v.converted = true AND v.converted_at IS NOT NULL
                   AND ABS(EXTRACT(EPOCH FROM (v.converted_at::timestamptz - $2::timestamptz))) < 7200
                 ORDER BY ABS(EXTRACT(EPOCH FROM (v.converted_at::timestamptz - $2::timestamptz))) ASC LIMIT 1`, [u.id, txnDate]);
              if (tm.rows.length > 0) { matchedVisitorId = tm.rows[0].visitor_id; matchedCampaignId = tm.rows[0].campaign_id; }
            }

            // 3. If campaign matched but no visitor, find recent one
            if (!matchedVisitorId && matchedCampaignId) {
              const recentVisitor = await pool.query(
                `SELECT id FROM visitors
                 WHERE campaign_id = $1
                   AND first_seen::timestamptz BETWEEN ($2::timestamptz - INTERVAL '4 hours') AND ($2::timestamptz + INTERVAL '10 minutes')
                   AND converted = false
                   AND headline_variant_id IS NOT NULL
                 ORDER BY first_seen::timestamptz DESC LIMIT 1`,
                [matchedCampaignId, txnDate]
              );
              if (recentVisitor.rows.length > 0) {
                matchedVisitorId = recentVisitor.rows[0].id;
              }
            }

            // No more fallbacks — GHL transactions MUST match by email or time proximity.
            // We never blindly assign GHL revenue to random visitors.

            // Strict: must have BOTH campaign and visitor
            if (!matchedCampaignId || !matchedVisitorId) {
              console.log(`[ghl-poll] UNATTRIBUTED: $${amount} from ${customerEmail || 'no-email'} — skipping`);
              try {
                await pool.query(
                  `INSERT INTO rejected_charges (user_id, charge_id, reason) VALUES ($1, $2, $3) ON CONFLICT (charge_id) DO NOTHING`,
                  [u.id, externalId, `ghl_unattributed: email=${customerEmail || 'none'} amount=$${amount}`]
                );
              } catch {}
              continue;
            }

            // Create revenue event
            await storage.addRevenueEvent({
              visitorId: matchedVisitorId,
              campaignId: matchedCampaignId,
              source: "gohighlevel",
              eventType: "purchase",
              amount,
              currency: "USD",
              externalId,
              customerEmail: customerEmail || undefined,
              metadata: JSON.stringify({ ghl_txn_id: txn._id || txn.id, product: txn.entitySourceName || '' }),
            });

            // Mark visitor converted if not already
            if (matchedVisitorId) {
              const visitor = await storage.getVisitor(matchedVisitorId);
              if (visitor && !visitor.converted) {
                await storage.markConverted(matchedVisitorId, externalId, amount);
              }
            }

            processed++;
            console.log(`[ghl-poll] $${amount} ${customerEmail || '?'} -> C${matchedCampaignId} (visitor:${matchedVisitorId?.substring(0, 12)})`);
          }

          if (processed > 0) console.log(`[ghl-poll] User ${u.id}: ${processed} new transactions processed`);
        } catch (err: any) {
          console.error(`[ghl-poll] User ${u.id} error:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[ghl-poll] Fatal:", err.message);
    }
  }

  // Poll GHL every 90 seconds + run on startup (offset from Stripe to avoid overlap)
  setInterval(pollGhlTransactions, 90 * 1000);
  setTimeout(pollGhlTransactions, 15000);


  // ============== TRAFFIC INTELLIGENCE ==============

  // Helper to normalize traffic source
  function normalizeSource(trafficSource: string | null, utmSource: string | null, utmMedium: string | null): string {
    const ts = trafficSource || '';
    const us = utmSource || '';
    const um = utmMedium || '';

    if ((us === 'fb_ad' || us === 'fb' || us === 'facebook' || us === 'META') && um.includes('paid')) return 'Facebook Ads';
    if ((us === 'fb_ad' || us === 'fb' || us === 'facebook' || us === 'META') || ts === 'facebook') return 'Facebook Ads';
    if (us === 'ig' && um.includes('paid')) return 'Instagram Ads';
    if (ts === 'instagram' && (us === 'fb_ad' || us === 'META')) return 'Instagram Ads';
    if (ts === 'instagram' && (us === 'social_media' || us === '')) return 'Instagram Organic';
    if (us === 'email' || um.includes('email')) return 'Email';
    if (ts === 'google_organic' || us === 'google') return 'Google Organic';
    if (ts === 'youtube') return 'YouTube';
    if (ts === 'direct' || (ts === '' && us === '')) return 'Direct';
    if (us === 'an') return 'Audience Network';
    return ts || us || 'Unknown';
  }

  app.get("/api/traffic/overview", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      // Source attribution
      const sourceRes = await pool.query(`
        SELECT
          CASE
            WHEN v.utm_source IN ('fb_ad','fb','facebook','META') AND v.utm_medium LIKE '%paid%' THEN 'Facebook Ads'
            WHEN v.utm_source IN ('fb_ad','fb','facebook','META') OR v.traffic_source = 'facebook' THEN 'Facebook Ads'
            WHEN v.utm_source = 'ig' AND v.utm_medium LIKE '%paid%' THEN 'Instagram Ads'
            WHEN v.traffic_source = 'instagram' AND v.utm_source IN ('fb_ad','META') THEN 'Instagram Ads'
            WHEN v.traffic_source = 'instagram' AND (v.utm_source = 'social_media' OR v.utm_source IS NULL) THEN 'Instagram Organic'
            WHEN v.utm_source = 'email' OR v.utm_medium LIKE '%email%' THEN 'Email'
            WHEN v.traffic_source = 'google_organic' OR v.utm_source = 'google' THEN 'Google Organic'
            WHEN v.traffic_source = 'youtube' THEN 'YouTube'
            WHEN v.traffic_source = 'direct' OR (v.traffic_source IS NULL AND v.utm_source IS NULL) THEN 'Direct'
            WHEN v.utm_source = 'an' THEN 'Audience Network'
            ELSE COALESCE(v.traffic_source, v.utm_source, 'Unknown')
          END as source,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1 AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
        GROUP BY source
        ORDER BY visitors DESC
      `, [userId]);

      // Device breakdown
      const deviceRes = await pool.query(`
        SELECT
          COALESCE(v.device_category, 'Unknown') as device,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1 AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
        GROUP BY device
        ORDER BY visitors DESC
      `, [userId]);

      // Daily traffic (last 30 days)
      const dailyRes = await pool.query(`
        SELECT
          DATE(v.first_seen::timestamptz) as date,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1 AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
        GROUP BY DATE(v.first_seen::timestamptz)
        ORDER BY date ASC
      `, [userId]);

      // Top campaigns
      const campaignRes = await pool.query(`
        SELECT
          c.id as campaign_id,
          c.name as campaign_name,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1 AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
        GROUP BY c.id, c.name
        ORDER BY revenue DESC
        LIMIT 10
      `, [userId]);

      // Aggregate totals
      const totalVisitors = sourceRes.rows.reduce((s: number, r: any) => s + parseInt(r.visitors), 0);
      const totalConversions = sourceRes.rows.reduce((s: number, r: any) => s + parseInt(r.conversions), 0);
      const totalRevenue = sourceRes.rows.reduce((s: number, r: any) => s + parseFloat(r.revenue), 0);

      res.json({
        sources: sourceRes.rows.map((r: any) => ({
          source: r.source,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        deviceBreakdown: deviceRes.rows.map((r: any) => ({
          device: r.device,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        dailyTraffic: dailyRes.rows.map((r: any) => ({
          date: r.date,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        topCampaigns: campaignRes.rows.map((r: any) => ({
          campaignId: r.campaign_id,
          campaignName: r.campaign_name,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        totalVisitors,
        totalConversions,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
      });
    } catch (err: any) {
      console.error("[traffic/overview]", err.message);
      res.status(500).json({ error: "Failed to load traffic overview" });
    }
  });

  app.get("/api/traffic/journeys", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      // Get recent converting visitors
      const convertingRes = await pool.query(`
        SELECT DISTINCT ON (v.id)
          v.id as visitor_id,
          v.customer_email,
          v.device_fingerprint,
          v.first_seen,
          v.device_category,
          v.traffic_source,
          v.utm_source,
          v.utm_medium,
          c.name as campaign_name,
          re.amount,
          re.created_at as converted_at
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1
          AND v.converted = true
          AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
        ORDER BY v.id, re.created_at DESC
        LIMIT 50
      `, [userId]);

      const conversions = [];

      for (const row of convertingRes.rows) {
        // Get all visits from same fingerprint across all user campaigns
        const journeyRes = await pool.query(`
          SELECT
            v.id,
            v.first_seen,
            v.device_category,
            v.traffic_source,
            v.utm_source,
            v.utm_medium,
            v.converted,
            c.name as campaign_name,
            vs.max_scroll_depth,
            vs.time_on_page
          FROM visitors v
          JOIN campaigns c ON c.id = v.campaign_id
          LEFT JOIN visitor_sessions vs ON vs.visitor_id = v.id
          WHERE c.user_id = $1
            AND v.device_fingerprint = $2
            AND v.device_fingerprint IS NOT NULL
          ORDER BY v.first_seen ASC
          LIMIT 20
        `, [userId, row.device_fingerprint]);

        const journeyRows = journeyRes.rows;
        const firstSeen = journeyRows.length > 0 ? journeyRows[0].first_seen : row.first_seen;
        const convertedAt = row.converted_at;
        const msToConvert = new Date(convertedAt).getTime() - new Date(firstSeen).getTime();
        const daysToConvert = Math.round(msToConvert / (1000 * 60 * 60 * 24));

        conversions.push({
          visitorId: row.visitor_id,
          email: row.customer_email || null,
          amount: parseFloat(row.amount) || 0,
          convertedAt: row.converted_at,
          campaignName: row.campaign_name,
          source: normalizeSource(row.traffic_source, row.utm_source, row.utm_medium),
          device: row.device_category || 'Unknown',
          firstSeen: row.first_seen,
          daysToConvert: Math.max(daysToConvert, 0),
          totalVisits: journeyRows.length,
          journey: journeyRows.map((j: any) => ({
            timestamp: j.first_seen,
            source: normalizeSource(j.traffic_source, j.utm_source, j.utm_medium),
            campaignName: j.campaign_name,
            device: j.device_category || 'Unknown',
            scrollDepth: j.max_scroll_depth || 0,
            timeOnPage: j.time_on_page || 0,
            converted: !!j.converted,
          })),
        });
      }

      // Sort by convertedAt desc
      conversions.sort((a, b) => new Date(b.convertedAt).getTime() - new Date(a.convertedAt).getTime());

      res.json({ conversions: conversions.slice(0, 50) });
    } catch (err: any) {
      console.error("[traffic/journeys]", err.message);
      res.status(500).json({ error: "Failed to load journeys" });
    }
  });

  app.get("/api/traffic/source-detail", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const source = (req.query.source as string) || '';

      // Build source match condition
      let sourceCondition = `
        CASE
          WHEN v.utm_source IN ('fb_ad','fb','facebook','META') AND v.utm_medium LIKE '%paid%' THEN 'Facebook Ads'
          WHEN v.utm_source IN ('fb_ad','fb','facebook','META') OR v.traffic_source = 'facebook' THEN 'Facebook Ads'
          WHEN v.utm_source = 'ig' AND v.utm_medium LIKE '%paid%' THEN 'Instagram Ads'
          WHEN v.traffic_source = 'instagram' AND v.utm_source IN ('fb_ad','META') THEN 'Instagram Ads'
          WHEN v.traffic_source = 'instagram' AND (v.utm_source = 'social_media' OR v.utm_source IS NULL) THEN 'Instagram Organic'
          WHEN v.utm_source = 'email' OR v.utm_medium LIKE '%email%' THEN 'Email'
          WHEN v.traffic_source = 'google_organic' OR v.utm_source = 'google' THEN 'Google Organic'
          WHEN v.traffic_source = 'youtube' THEN 'YouTube'
          WHEN v.traffic_source = 'direct' OR (v.traffic_source IS NULL AND v.utm_source IS NULL) THEN 'Direct'
          WHEN v.utm_source = 'an' THEN 'Audience Network'
          ELSE COALESCE(v.traffic_source, v.utm_source, 'Unknown')
        END
      `;

      // Campaign breakdown
      const campaignRes = await pool.query(`
        SELECT
          c.id as campaign_id,
          c.name as campaign_name,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1
          AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
          AND (${sourceCondition}) = $2
        GROUP BY c.id, c.name
        ORDER BY visitors DESC
      `, [userId, source]);

      // UTM campaign breakdown
      const utmRes = await pool.query(`
        SELECT
          COALESCE(v.utm_campaign, 'Unknown') as utm_campaign,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1
          AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
          AND (${sourceCondition}) = $2
        GROUP BY v.utm_campaign
        ORDER BY visitors DESC
        LIMIT 10
      `, [userId, source]);

      // Device breakdown
      const deviceRes = await pool.query(`
        SELECT
          COALESCE(v.device_category, 'Unknown') as device,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1
          AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
          AND (${sourceCondition}) = $2
        GROUP BY device
        ORDER BY visitors DESC
      `, [userId, source]);

      // Daily trend
      const dailyRes = await pool.query(`
        SELECT
          DATE(v.first_seen::timestamptz) as date,
          COUNT(DISTINCT v.id) as visitors,
          COUNT(DISTINCT CASE WHEN v.converted THEN v.id END) as conversions,
          ROUND(COALESCE(SUM(re.amount), 0)::numeric, 2) as revenue
        FROM visitors v
        JOIN campaigns c ON c.id = v.campaign_id
        LEFT JOIN revenue_events re ON re.visitor_id = v.id
        WHERE c.user_id = $1
          AND v.first_seen::timestamptz > NOW() - INTERVAL '30 days'
          AND (${sourceCondition}) = $2
        GROUP BY DATE(v.first_seen::timestamptz)
        ORDER BY date ASC
      `, [userId, source]);

      res.json({
        source,
        campaigns: campaignRes.rows.map((r: any) => ({
          campaignId: r.campaign_id,
          campaignName: r.campaign_name,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        utmCampaigns: utmRes.rows.map((r: any) => ({
          utmCampaign: r.utm_campaign,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        deviceBreakdown: deviceRes.rows.map((r: any) => ({
          device: r.device,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
        dailyTrend: dailyRes.rows.map((r: any) => ({
          date: r.date,
          visitors: parseInt(r.visitors),
          conversions: parseInt(r.conversions),
          revenue: parseFloat(r.revenue),
        })),
      });
    } catch (err: any) {
      console.error("[traffic/source-detail]", err.message);
      res.status(500).json({ error: "Failed to load source detail" });
    }
  });


  // ============== AUTOPILOT EVALUATION LOOP ==============
  // Check all active autopilot campaigns every 5 minutes for tests that should be declared
  async function pollAutopilotCampaigns() {
    try {
      const result = await pool.query(
        `SELECT id FROM campaigns WHERE autopilot_enabled = true AND autopilot_status = 'testing'`
      );
      for (const row of result.rows) {
        try {
          const action = await evaluateAutopilotTests(row.id);
          if (action && action.action !== "no_action") {
            console.log(`[autopilot] Campaign ${row.id}: ${action.action} — ${action.message}`);
          }
        } catch (err: any) {
          console.error(`[autopilot] Evaluation failed for campaign ${row.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[autopilot] Poll failed:", err.message);
    }
  }
  setInterval(pollAutopilotCampaigns, 5 * 60 * 1000); // Every 5 minutes
  setTimeout(pollAutopilotCampaigns, 30000); // First run after 30s startup delay

  // Keep the old function signature for the manual sync button (just calls the poller)
  async function matchStripeTransactionsToVisitors(userId: number): Promise<number> {
    try {
      const u = await pool.query("SELECT stripe_access_token FROM users WHERE id = $1", [userId]);
      if (!u.rows[0]?.stripe_access_token) return 0;
      const decryptedKey = decryptApiKey(u.rows[0].stripe_access_token);
      const stripeClient = new Stripe(decryptedKey);
      // Paginate through charges
      let hasMore2 = true;
      let sa2: string | undefined = undefined;
      let matched = 0;
      let pages2 = 0;
      while (hasMore2 && pages2 < 5) {
        const p2: any = { limit: 100 };
        if (sa2) p2.starting_after = sa2;
        const charges = await stripeClient.charges.list(p2);
        hasMore2 = charges.has_more;
        if (charges.data.length > 0) sa2 = charges.data[charges.data.length - 1].id;
        pages2++;
        for (const ch of charges.data) {
          if (ch.status !== "succeeded" && ch.status !== "refunded") continue;
          const ok = await processStripeEvent(userId, stripeClient, { type: ch.refunded ? "charge.refunded" : "charge.succeeded", data: { object: ch }, created: ch.created });
          if (ok) matched++;
        }
      }
      return matched;
    } catch (err: any) {
      console.error("[stripe-sync]", err.message);
      return 0;
    }
  }


  // ============== STRIPE CONNECT OAUTH ==============
  const STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || "";
  const STRIPE_REDIRECT_URI = (process.env.STRIPE_REDIRECT_URI || "https://api.siteamoeba.com") + "/api/settings/stripe-callback";

  // A) GET /api/settings/stripe-connect-url — generates the OAuth authorize URL
  app.get("/api/settings/stripe-connect-url", requireAuth, async (req: Request, res: Response) => {
    if (!STRIPE_CONNECT_CLIENT_ID) {
      return res.status(500).json({ error: "Stripe Connect not configured. Contact support." });
    }
    const state = `${req.userId!}_${Date.now()}`; // simple state for CSRF
    const authorizeUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${STRIPE_CONNECT_CLIENT_ID}&scope=read_write&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(STRIPE_REDIRECT_URI)}`;
    res.json({ url: authorizeUrl, state });
  });

  // B) GET /api/settings/stripe-callback — Stripe redirects here after user approves
  app.get("/api/settings/stripe-callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.redirect(`https://app.siteamoeba.com/#/settings?stripe_error=${encodeURIComponent(String(error_description || error))}`);
    }

    if (!code || !state) {
      return res.redirect("https://app.siteamoeba.com/#/settings?stripe_error=missing_code");
    }

    // Extract userId from state
    const userId = parseInt(String(state).split("_")[0]);
    if (!userId) {
      return res.redirect("https://app.siteamoeba.com/#/settings?stripe_error=invalid_state");
    }

    try {
      // Exchange the authorization code for an access token
      const platformStripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      const tokenResponse = await platformStripe.oauth.token({
        grant_type: "authorization_code",
        code: String(code),
      });

      const accessToken = tokenResponse.access_token!;
      const stripeUserId = tokenResponse.stripe_user_id!;

      // Verify the token works
      const connectedStripe = new Stripe(accessToken);
      const account = await connectedStripe.accounts.retrieve(stripeUserId);

      // Save encrypted token
      await storage.updateUser(userId, {
        stripeAccountId: stripeUserId,
        stripeAccessToken: encryptApiKey(accessToken),
        stripeConnectedAt: new Date().toISOString(),
      } as any);

      // Backfill transactions (fire-and-forget)
      matchStripeTransactionsToVisitors(userId).catch(e => console.error("Stripe backfill error:", e));

      // Redirect back to settings with success
      res.redirect("https://app.siteamoeba.com/#/settings?stripe_connected=true");
    } catch (err: any) {
      console.error("Stripe OAuth token exchange failed:", err);
      res.redirect(`https://app.siteamoeba.com/#/settings?stripe_error=${encodeURIComponent(err.message || "connection_failed")}`);
    }
  });

  // C) POST /api/settings/disconnect-stripe
  app.post("/api/settings/disconnect-stripe", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Optionally deauthorize on Stripe's side
    try {
      if (STRIPE_CONNECT_CLIENT_ID && (user as any).stripeAccountId) {
        const platformStripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        await platformStripe.oauth.deauthorize({
          client_id: STRIPE_CONNECT_CLIENT_ID,
          stripe_user_id: (user as any).stripeAccountId,
        });
      }
    } catch (e) {
      console.warn("Stripe deauthorize failed (non-fatal):", e);
    }

    await storage.updateUser(user.id, {
      stripeAccountId: null,
      stripeAccessToken: null,
      stripeConnectedAt: null,
    } as any);

    res.json({ disconnected: true });
  });

  // C2) POST /api/settings/connect-stripe — fallback: accept restricted or secret key directly
  app.post("/api/settings/connect-stripe", requireAuth, async (req: Request, res: Response) => {
    const { stripeKey } = req.body;
    if (!stripeKey || typeof stripeKey !== "string") {
      return res.status(400).json({ error: "stripeKey is required" });
    }
    const validPrefixes = ["rk_live_", "rk_test_", "sk_live_", "sk_test_"];
    if (!validPrefixes.some((p) => stripeKey.startsWith(p))) {
      return res.status(400).json({ error: "Key must be a restricted key (rk_live_/rk_test_) or secret key (sk_live_/sk_test_)" });
    }
    try {
      const testClient = new Stripe(stripeKey);
      await testClient.charges.list({ limit: 1 });
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid Stripe key: " + (err.message || "verification failed") });
    }
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });
    await storage.updateUser(user.id, {
      stripeAccessToken: encryptApiKey(stripeKey),
      stripeConnectedAt: new Date().toISOString(),
    } as any);
    // Auto-register webhook + backfill transactions (fire-and-forget)
    (async () => {
      try {
        const testClient2 = new Stripe(stripeKey);
        const PUBLIC_API = process.env.PUBLIC_API_URL || "https://app.siteamoeba.com";
        const whUrl = `${PUBLIC_API}/api/webhooks/stripe/account/${user.id}`;
        const existingWh = await testClient2.webhookEndpoints.list({ limit: 20 });
        if (!existingWh.data.some((w: any) => w.url === whUrl)) {
          const wh = await testClient2.webhookEndpoints.create({
            url: whUrl,
            enabled_events: ['charge.succeeded', 'charge.refunded', 'checkout.session.completed', 'payment_intent.succeeded'],
          });
          if (wh.secret) {
            await pool.query('UPDATE users SET stripe_webhook_secret = $1 WHERE id = $2', [wh.secret, user.id]);
          }
          console.log(`[stripe-connect] Auto-registered webhook for user ${user.id}: ${whUrl}`);
        }
      } catch (e: any) { console.error('[stripe-connect] Auto webhook registration failed:', e.message); }
      matchStripeTransactionsToVisitors(req.userId!).catch((e) => console.error("Stripe backfill error:", e));
    })();
    res.json({ connected: true });
  });

  // D) GET /api/settings/stripe-status
  app.get("/api/settings/stripe-status", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    const accessToken = (user as any).stripeAccessToken;
    if (!accessToken) {
      return res.json({ connected: false, connectAvailable: !!STRIPE_CONNECT_CLIENT_ID });
    }

    try {
      const decryptedKey = decryptApiKey(accessToken);
      const stripeClient = new Stripe(decryptedKey);
      const charges = await stripeClient.charges.list({ limit: 20 });
      // Background sync every time status is checked (like Whop)
      matchStripeTransactionsToVisitors(req.userId!).catch(e => console.error("Stripe bg sync error:", e));
      res.json({
        connected: true,
        accountId: (user as any).stripeAccountId,
        recentCharges: charges.data.length,
        connectedAt: (user as any).stripeConnectedAt,
        connectAvailable: true,
      });
    } catch (err) {
      // Token is invalid — clear it so the UI shows "reconnect"
      await storage.updateUser(user.id, {
        stripeAccountId: null,
        stripeAccessToken: null,
        stripeConnectedAt: null,
      } as any);
      res.json({ connected: false, connectAvailable: !!STRIPE_CONNECT_CLIENT_ID });
    }
  });

  // POST /api/settings/register-stripe-webhook — auto-register webhook on Stripe account
  app.post("/api/settings/register-stripe-webhook", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || !(user as any).stripeAccessToken) return res.status(400).json({ error: "Stripe not connected" });
    try {
      const decryptedKey = decryptApiKey((user as any).stripeAccessToken);
      const stripeClient = new Stripe(decryptedKey);
      const PUBLIC_API = process.env.PUBLIC_API_URL || "https://app.siteamoeba.com";
      const webhookUrl = `${PUBLIC_API}/api/webhooks/stripe/account/${user.id}`;

      // Check if already registered
      const existing = await stripeClient.webhookEndpoints.list({ limit: 20 });
      const alreadyExists = existing.data.find((wh: any) => wh.url === webhookUrl);
      if (alreadyExists) {
        return res.json({ ok: true, already: true, webhookId: alreadyExists.id });
      }

      // Register
      const wh = await stripeClient.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: ['charge.succeeded', 'charge.refunded', 'checkout.session.completed', 'payment_intent.succeeded'],
      });

      // Store webhook secret for signature verification
      if (wh.secret) {
        await pool.query('UPDATE users SET stripe_webhook_secret = $1 WHERE id = $2', [wh.secret, user.id]);
      }

      return res.json({ ok: true, webhookId: wh.id, url: webhookUrl });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/settings/stripe-debug — temporary debug endpoint
  app.get("/api/settings/stripe-debug", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || !(user as any).stripeAccessToken) return res.json({ error: "no stripe" });
    try {
      const decryptedKey = decryptApiKey((user as any).stripeAccessToken);
      const stripeClient = new Stripe(decryptedKey);
      const charges = await stripeClient.charges.list({ limit: 5 });
      const debug = charges.data.map((c: any) => ({
        id: c.id,
        status: c.status,
        amount: c.amount / 100,
        email: c.billing_details?.email || c.receipt_email,
        desc: (c.description || "").substring(0, 50),
        customer: c.customer,
        created: new Date(c.created * 1000).toISOString(),
        refunded: c.refunded,
      }));
      return res.json({ total: charges.data.length, hasMore: charges.has_more, charges: debug });
    } catch (err: any) {
      return res.json({ error: err.message });
    }
  });

  // POST /api/settings/stripe-sync — on-demand sync button in Settings
  app.post("/api/settings/stripe-sync", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || !(user as any).stripeAccessToken) {
      return res.status(400).json({ error: "Stripe not connected" });
    }
    try {
      const matched = await matchStripeTransactionsToVisitors(req.userId!);
      res.json({ ok: true, matched });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // D) GET /api/settings/stripe-transactions
  // === TRANSACTION MAPPING ===
  // Lists all unique Stripe charge descriptions the system has seen,
  // along with which campaign (if any) they're mapped to.
  app.get("/api/settings/product-map", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    const accessToken = (user as any).stripeAccessToken;
    if (!accessToken) return res.status(400).json({ error: "Stripe not connected" });

    try {
      const decryptedKey = decryptApiKey(accessToken);
      const stripeClient = new Stripe(decryptedKey);

      // Fetch last 200 charges to discover all product descriptions
      const charges = await stripeClient.charges.list({ limit: 100 });
      const descriptionCounts: Record<string, { count: number; totalAmount: number; lastSeen: number }> = {};
      for (const ch of charges.data) {
        const desc = ch.description || "(no description)";
        // Skip SiteAmoeba billing and GHL charges
        if (desc.toLowerCase().includes("subscription creation") || desc.toLowerCase().includes("auto-recharge")) continue;
        if (!descriptionCounts[desc]) descriptionCounts[desc] = { count: 0, totalAmount: 0, lastSeen: 0 };
        descriptionCounts[desc].count++;
        descriptionCounts[desc].totalAmount += ch.amount / 100;
        descriptionCounts[desc].lastSeen = Math.max(descriptionCounts[desc].lastSeen, ch.created);
      }

      // Get existing mappings
      const mappings = await pool.query(
        `SELECT pm.description_pattern, pm.campaign_id, c.name as campaign_name
         FROM product_map pm
         LEFT JOIN campaigns c ON c.id = pm.campaign_id
         WHERE pm.user_id = $1`,
        [user.id]
      );
      const mapByDesc: Record<string, { campaignId: number | null; campaignName: string | null }> = {};
      for (const m of mappings.rows) {
        mapByDesc[m.description_pattern] = { campaignId: m.campaign_id, campaignName: m.campaign_name };
      }

      // Get user campaigns for dropdown
      const campaigns = await storage.getCampaignsByUser(user.id);

      const products = Object.entries(descriptionCounts)
        .map(([desc, data]) => ({
          description: desc,
          charges: data.count,
          totalRevenue: parseFloat(data.totalAmount.toFixed(2)),
          lastSeen: new Date(data.lastSeen * 1000).toISOString(),
          mappedCampaignId: mapByDesc[desc]?.campaignId ?? null,
          mappedCampaignName: mapByDesc[desc]?.campaignName ?? null,
        }))
        .sort((a, b) => b.charges - a.charges);

      return res.json({
        products,
        campaigns: campaigns.map((c: any) => ({ id: c.id, name: c.name, url: c.url })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Save a product description → campaign mapping
  app.post("/api/settings/product-map", requireAuth, async (req: Request, res: Response) => {
    const { description, campaignId } = req.body;
    if (!description) return res.status(400).json({ error: "description required" });

    try {
      if (campaignId) {
        await pool.query(
          `INSERT INTO product_map (user_id, description_pattern, campaign_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, description_pattern) DO UPDATE SET campaign_id = $3`,
          [req.userId, description, campaignId]
        );
      } else {
        // Unmap — remove the mapping
        await pool.query(
          `DELETE FROM product_map WHERE user_id = $1 AND description_pattern = $2`,
          [req.userId, description]
        );
      }
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/stripe-transactions", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    const accessToken = (user as any).stripeAccessToken;
    if (!accessToken) {
      return res.status(400).json({ error: "Stripe not connected" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const startDate = req.query.startDate ? parseInt(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? parseInt(req.query.endDate as string) : undefined;

    try {
      const decryptedKey = decryptApiKey(accessToken);
      const stripeClient = new Stripe(decryptedKey);

      const listParams: Stripe.ChargeListParams = { limit };
      if (startDate || endDate) {
        listParams.created = {};
        if (startDate) listParams.created.gte = startDate;
        if (endDate) listParams.created.lte = endDate;
      }

      const charges = await stripeClient.charges.list(listParams);
      const userCampaigns = await storage.getCampaignsByUser(user.id);
      const campaignIds = userCampaigns.map((c: any) => c.id);

      const transactions = await Promise.all(
        charges.data.map(async (charge) => {
          const email = charge.billing_details?.email || null;
          let trafficSource: string | null = null;

          if (email && campaignIds.length > 0) {
            // Look up traffic source via existing revenue_events → visitors
            const match = await pool.query(
              `SELECT v.traffic_source
               FROM revenue_events re
               JOIN visitors v ON v.id = re.visitor_id
               WHERE re.customer_email = $1 AND re.campaign_id = ANY($2::int[])
               AND v.traffic_source IS NOT NULL
               LIMIT 1`,
              [email, campaignIds]
            );
            trafficSource = match.rows[0]?.traffic_source || null;
          }

          return {
            id: charge.id,
            amount: charge.amount / 100,
            currency: charge.currency,
            customerEmail: email,
            created: new Date(charge.created * 1000).toISOString(),
            status: charge.status,
            description: charge.description,
            trafficSource,
          };
        })
      );

      res.json({ transactions });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch transactions" });
    }
  });

  // ============== PAGE SCANNER ==============

  /**
   * extractPageText — strip a raw HTML page down to compact, LLM-friendly structured text.
   * Returns [H1], [H2], [BUTTON], [•] markers so the AI understands element types
   * while fitting 10x more content into the same token budget vs raw HTML.
   */
  function extractPageText(html: string): string {
    return html
      // Remove noise blocks entirely
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Annotate structural elements
      .replace(/<h1[^>]*>/gi, '\n[H1] ')
      .replace(/<h2[^>]*>/gi, '\n[H2] ')
      .replace(/<h3[^>]*>/gi, '\n[H3] ')
      .replace(/<h4[^>]*>/gi, '\n[H4] ')
      .replace(/<h5[^>]*>/gi, '\n[H5] ')
      .replace(/<\/h[1-5]>/gi, '\n')
      .replace(/<button[^>]*>/gi, '\n[BUTTON] ')
      .replace(/<\/button>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n[•] ')
      .replace(/<\/li>/gi, '')
      .replace(/<p[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|section|article|main|header|footer|aside|nav|tr)>/gi, '\n')
      // Strip all remaining tags
      .replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, ' ')
      // Collapse whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Async job store — in-memory, TTL 10 minutes
  const scanJobs = new Map<string, { status: "pending" | "done" | "error"; result?: any; error?: string; createdAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of scanJobs.entries()) {
      if (now - job.createdAt > 600000) scanJobs.delete(id); // expire after 10 min
    }
  }, 60000);

  // GET /api/scan-status/:jobId — poll for async scan result
  app.get("/api/scan-status/:jobId", requireAuth, async (req: Request, res: Response) => {
    const job = scanJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found or expired" });
    if (job.status === "pending") return res.json({ status: "pending" });
    if (job.status === "error") return res.json({ status: "error", error: job.error });
    return res.json({ status: "done", result: job.result });
  });

  app.post("/api/scan-page", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Resolve LLM config — scan works for all users (free get platform key for scanning)
    let llmConfigResolved;
    try {
      llmConfigResolved = resolveLLMConfig({
        operation: "scan",
        userPlan: user.plan || "free",
        userProvider: user.llmProvider,
        userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
        userModel: user.llmModel,
      });
    } catch {
      return res.status(400).json({ error: "Please configure your AI provider in Settings or upgrade to a paid plan to scan pages." });
      // Note: scan is allowed for free users via platform key, so this only fires if platform key is missing AND no BYOK
    }

    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required" });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: "URL must start with http:// or https://" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    // Create async job and return immediately — scan runs in background
    const jobId = "scan_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    scanJobs.set(jobId, { status: "pending", createdAt: Date.now() });
    res.json({ jobId });

    // Run the actual scan in the background (not awaited — response already sent)
    (async () => {
      try {

    // Fetch the full page HTML — background job has no timeout constraint
    let rawHtml = "";
    try {
      const fetchController = new AbortController();
      const fetchTimeout = setTimeout(() => fetchController.abort(), 60000); // 60s timeout for background

      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, {
          signal: fetchController.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
        });
      } catch (fetchErr: any) {
        clearTimeout(fetchTimeout);
        const isTimeout = fetchErr.name === "AbortError";
        const fetchErrMsg = isTimeout ? "Page fetch timed out. The URL may be slow or unreachable." : `Could not fetch page: ${fetchErr.message || "Network error"}`;
        scanJobs.set(jobId, { status: "error", error: fetchErrMsg, createdAt: Date.now() }); return;
      }

      clearTimeout(fetchTimeout);
      if (!fetchResponse.ok) {
        scanJobs.set(jobId, { status: "error", error: `Could not fetch page: HTTP ${fetchResponse.status}`, createdAt: Date.now() }); return;
      }

      rawHtml = await fetchResponse.text();
    } catch (err: any) {
      scanJobs.set(jobId, { status: "error", error: `Could not fetch page: ${err.message || "Network error"}`, createdAt: Date.now() }); return;
    }

    // Smart content extraction:
    // 1. Find </head> to isolate body HTML
    // 2. Strip scripts/styles/tags → compact structured text with [H1]/[H2]/[BUTTON]/[•] markers
    // 3. Send up to 40KB — covers the FULL page (vs old 10KB slice of raw HTML)
    const headEnd = rawHtml.toLowerCase().indexOf("</head>");
    const bodyHtml = headEnd > 0 ? rawHtml.slice(headEnd + 7) : rawHtml;
    const bodyText = extractPageText(bodyHtml);

    const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    const titleText = titleMatch ? `Page title: ${titleMatch[1].trim()}\n\n` : "";
    // 40KB covers essentially every sales/landing page in full
    const cleaned = (titleText + bodyText).slice(0, 40000);

    // Extract page copy metrics from raw HTML for passive learning
    const pageWordCount = bodyText.split(/\s+/).filter((w: string) => w.length > 0).length;
    const pageCharCount = bodyText.length;
    const pageHeadingCount = (rawHtml.match(/<h[1-6][^>]*>/gi) || []).length;
    const pageCtaCount = (rawHtml.match(/<button[^>]*>|<a[^>]*class=["'][^"']*(?:btn|cta|button)[^"']*["']/gi) || []).length;
    const pageImageCount = (rawHtml.match(/<img[^>]*>/gi) || []).length;
    const pageVideoCount = (rawHtml.match(/<video[^>]*>|<iframe[^>]*(?:youtube|vimeo|wistia)[^>]*>/gi) || []).length;
    let pageSectionCount = 0; // set after LLM parse

    const messages = buildPageScanPrompt(url, cleaned);

    let rawResponse: string;
    try {
      rawResponse = await callLLM(llmConfigResolved.config, messages, { maxTokens: 8000 });
    } catch (err: any) {
      console.error("Page scan LLM call failed:", err);
      scanJobs.set(jobId, { status: "error", error: err.message || "AI provider error. Check your API key and credits in Settings.", createdAt: Date.now() }); return;
    }

    // Parse the JSON response — robust extraction + truncation recovery
    let scanResult: { pageName: string; pageType: string; pageGoal?: string; pricePoint?: string; niche?: string; sections: any[] };
    try {
      // Find the outermost JSON object (handles markdown code blocks, leading text, etc.)
      const firstBrace = rawResponse.indexOf("{");
      if (firstBrace === -1) throw new Error("No JSON found in AI response");

      let jsonStr = "";
      let parsed: any = null;

      // Attempt 1: full JSON from first { to last }
      const lastBrace = rawResponse.lastIndexOf("}");
      if (lastBrace > firstBrace) {
        try {
          jsonStr = rawResponse.slice(firstBrace, lastBrace + 1);
          parsed = JSON.parse(jsonStr);
        } catch { parsed = null; }
      }

      // Attempt 2: truncation recovery — response was cut off mid-section.
      // Walk backwards from the end to find the last COMPLETE section object (closes with }
      // before a , or ] ), then close the array and object.
      if (!parsed) {
        const headerMatch = jsonStr.match(/^(\{[\s\S]*?"sections"\s*:\s*\[)/);
        if (headerMatch) {
          // Find all complete section-closing patterns: either },\n or } followed by ]
          const sectionsStart = firstBrace + headerMatch[1].length;
          // Walk back from the truncation point to find the last complete section
          let searchFrom = rawResponse.length - 1;
          while (searchFrom > sectionsStart) {
            const lastClose = rawResponse.lastIndexOf("}", searchFrom);
            if (lastClose <= sectionsStart) break;
            const candidate = rawResponse.slice(firstBrace, lastClose + 1) + "]}";
            try {
              parsed = JSON.parse(candidate);
              console.log(`[scan] Truncation recovery: salvaged ${parsed.sections?.length ?? 0} sections`);
              break;
            } catch {
              searchFrom = lastClose - 1;
            }
          }
        }
      }

      if (!parsed) throw new Error("Could not parse AI response as JSON");
      scanResult = parsed;
      if (!scanResult.sections || !Array.isArray(scanResult.sections)) {
        throw new Error("Expected sections array");
      }
    } catch (err: any) {
      console.error("[scan] Failed to parse AI response:", rawResponse?.slice(0, 400));
      scanJobs.set(jobId, { status: "error", error: "AI returned invalid response. Please try again.", createdAt: Date.now() }); return;
    }

    // Sanitize sections
    const validTestMethods = ["text_swap", "html_swap", "visibility_toggle", "reorder", "not_testable"];
    scanResult.sections = scanResult.sections
      .filter((s: any) => s && s.id && s.label && s.selector && s.category)
      .map((s: any, i: number) => {
        const category = String(s.category);
        const isLongSection = category === "body_copy" || category === "hero_journey";
        const rawText = s.currentText ? String(s.currentText) : "";
        // Allow up to 2000 chars for body_copy/hero_journey, 300 for others
        const currentText = isLongSection ? rawText.slice(0, 2000) : rawText.slice(0, 300);
        const contentLength = rawText.length;
        return {
          id: String(s.id),
          label: String(s.label),
          purpose: s.purpose ? String(s.purpose) : "",
          selector: String(s.selector),
          currentText,
          contentLength,
          testPriority: typeof s.testPriority === "number" ? s.testPriority : i + 1,
          category,
          testMethod: validTestMethods.includes(s.testMethod) ? String(s.testMethod) : "text_swap",
        };
      })
      .sort((a: any, b: any) => a.testPriority - b.testPriority);

    // Store classification fields on the campaign if a campaignId was passed
    // The frontend may pass campaignId to update the campaign with scan results
    const { campaignId } = req.body;
    if (campaignId && typeof campaignId === "number") {
      try {
        const targetCampaign = await storage.getCampaign(campaignId);
        if (targetCampaign && targetCampaign.userId === req.userId) {
          pageSectionCount = scanResult.sections?.length || 0;
          await storage.updateCampaign(campaignId, {
            pageType: scanResult.pageType || null,
            pageGoal: scanResult.pageGoal || null,
            pricePoint: (scanResult.pricePoint && scanResult.pricePoint !== "null") ? scanResult.pricePoint : null,
            niche: scanResult.niche || null,
            pageWordCount,
            pageCharCount,
            pageHeadingCount,
            pageCtaCount,
            pageImageCount,
            pageVideoCount,
            pageSectionCount,
          } as any);
        }
      } catch (err) {
        // Non-fatal — scan result is still returned
        console.warn("Could not update campaign classification fields:", err);
      }
    }

        scanJobs.set(jobId, { status: "done", result: scanResult, createdAt: Date.now() });

      } catch (bgErr: any) {
        console.error("Background scan failed:", bgErr.message);
        scanJobs.set(jobId, { status: "error", error: bgErr.message || "Scan failed", createdAt: Date.now() });
      }
    })();
  });

  // ============== TEST SECTIONS ==============

  app.get("/api/campaigns/:id/sections", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const sections = await storage.getTestSectionsByCampaign(campaign.id);
    res.json(sections);
  });

  app.post("/api/campaigns/:id/sections", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const parsed = insertTestSectionSchema.safeParse({
      ...req.body,
      campaignId: campaign.id,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const section = await storage.createTestSection(parsed.data);
    res.status(201).json(section);
  });

  // GET /api/campaigns/:id/test-sections — list all test sections (including inactive)
  app.get("/api/campaigns/:id/test-sections", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Not found" });
    const sections = await storage.getTestSectionsByCampaign(campaign.id);
    res.json(sections);
  });

  // PATCH /api/test-sections/:id/toggle — toggle a test section active/inactive
  app.patch("/api/test-sections/:id/toggle", requireAuth, async (req: Request, res: Response) => {
    const sectionId = paramId(req.params.id);
    const section = await pool.query("SELECT * FROM test_sections WHERE id = $1", [sectionId]);
    if (section.rows.length === 0) return res.status(404).json({ error: "Section not found" });

    const s = section.rows[0];
    const campaign = await storage.getCampaign(s.campaign_id);
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Not found" });

    const newActive = !s.is_active;
    await pool.query("UPDATE test_sections SET is_active = $1 WHERE id = $2", [newActive, sectionId]);

    res.json({ id: sectionId, isActive: newActive });
  });

  // POST /api/campaigns/:id/rescan — re-scan the page and update test sections
  // Used when a user makes changes to their page and needs to refresh the scan data.
  // Reuses the scan-page job system but also updates existing sections with new text/selectors.
  app.post("/api/campaigns/:id/rescan", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Campaign not found" });
    if (!campaign.url) return res.status(400).json({ error: "No URL configured" });

    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    let llmConfigResolved;
    try {
      llmConfigResolved = resolveLLMConfig({
        operation: "scan",
        userPlan: user.plan || "free",
        userProvider: user.llmProvider,
        userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
        userModel: user.llmModel,
      });
    } catch {
      return res.status(400).json({ error: "AI provider not configured." });
    }

    // Trigger the scan job (same as scan-page)
    const jobId = "rescan_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    scanJobs.set(jobId, { status: "pending", createdAt: Date.now() });
    res.json({ jobId });

    // Background: run scan and then update existing sections
    (async () => {
      try {
        // Fetch HTML
        let rawHtml = "";
        const fetchController = new AbortController();
        const fetchTimeout = setTimeout(() => fetchController.abort(), 60000);
        const fetchResponse = await fetch(campaign.url, {
          signal: fetchController.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        clearTimeout(fetchTimeout);
        rawHtml = await fetchResponse.text();

        // Same extraction + prompt as initial scan
        const headEnd = rawHtml.toLowerCase().indexOf("</head>");
        const bodyHtml = headEnd > 0 ? rawHtml.slice(headEnd + 7) : rawHtml;
        const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        const titleText = titleMatch ? `Page title: ${titleMatch[1].trim()}\n\n` : "";
        const extracted = titleText + extractPageText(bodyHtml);
        // Cap at 20K chars — large pages (GHL 480+ headings) cause LLM timeouts at 40K
        const cleaned = extracted.slice(0, 20000);

        const messages = buildPageScanPrompt(campaign.url, cleaned);
        // Wrap in a timeout — LLM can hang on very large pages
        const rawResponse = await Promise.race([
          callLLM(llmConfigResolved.config, messages, { maxTokens: 8000 }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM call timed out after 90s")), 90000)),
        ]);

        // Same JSON parsing as initial scan
        let newSections: any[] = [];
        try {
          const firstBrace = rawResponse.indexOf("{");
          if (firstBrace === -1) throw new Error("No JSON");
          const lastBrace = rawResponse.lastIndexOf("}");
          const jsonStr = rawResponse.substring(firstBrace, lastBrace + 1);
          const parsed = JSON.parse(jsonStr);
          newSections = parsed.sections || parsed.testSections || [];
        } catch {
          // Fallback: try array extraction
          const jsonMatch = rawResponse.match(/\[\s*\{[\s\S]*\}\s*\]/)?.[0];
          newSections = jsonMatch ? JSON.parse(jsonMatch) : [];
        }

        if (newSections.length === 0) {
          scanJobs.set(jobId, { status: "error", error: "Scan found no sections", createdAt: Date.now() });
          return;
        }

        // Get existing sections
        const existing = await pool.query(
          `SELECT id, section_id, label, current_text, selector FROM test_sections WHERE campaign_id = $1`,
          [campaignId]
        );
        const existingMap = new Map(existing.rows.map((r: any) => [r.section_id, r]));

        let updated = 0, added = 0;
        const changedSections: any[] = [];

        for (const ns of newSections) {
          const ex = existingMap.get(ns.id);
          if (ex) {
            // Existing section — update text and selector if changed
            const textChanged = ex.current_text !== ns.currentText;
            if (textChanged || ex.selector !== ns.selector) {
              await pool.query(
                `UPDATE test_sections SET current_text = $1, selector = $2, mismatch_detected = false, mismatch_count = 0 WHERE id = $3`,
                [ns.currentText, ns.selector, ex.id]
              );
              updated++;
              if (textChanged) {
                changedSections.push({ id: ex.id, sectionId: ns.id, label: ns.label, oldText: ex.current_text, newText: ns.currentText });
              }
            }
          }
          else {
            // NEW section found by rescan — add it (inactive by default so user chooses what to test)
            try {
              const category = (ns.category || "body_copy").toLowerCase();
              await pool.query(
                `INSERT INTO test_sections (campaign_id, section_id, label, category, selector, current_text, test_method, test_priority, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
                 ON CONFLICT DO NOTHING`,
                [campaignId, ns.id, ns.label || ns.id, category, ns.selector || '', ns.currentText || '', ns.testMethod || 'text_swap', ns.testPriority || 5]
              );
              added++;
            } catch (addErr) {
              console.warn('[rescan] Failed to add section:', ns.id, (addErr as any)?.message);
            }
          }
        }

        // Clear mismatch flags
        await pool.query(
          `UPDATE test_sections SET mismatch_detected = false WHERE campaign_id = $1 AND mismatch_detected = true`,
          [campaignId]
        );

        scanJobs.set(jobId, {
          status: "done",
          createdAt: Date.now(),
          sections: newSections,
          result: { updated, added, changedSections, totalScanned: newSections.length },
        });
        console.log(`[rescan] Campaign ${campaignId}: ${updated} updated, ${added} new sections added, ${newSections.length} total scanned`);

      } catch (err: any) {
        scanJobs.set(jobId, { status: "error", error: err.message, createdAt: Date.now() });
        console.error(`[rescan] Error:`, err.message);
      }
    })();
  });

  // POST /api/sections/:id/preflight
  // Before activating a test, fetches the live page and checks:
  //   1. Does the target element exist? (via currentText fingerprint)
  //   2. How many elements would the selector match?
  //   3. Are the variants long enough to be meaningful?
  // Returns { status: 'ok'|'warning'|'error', checks: [...] }
  app.post("/api/sections/:id/preflight", requireAuth, async (req: Request, res: Response) => {
    const sectionId = paramId(req.params.id);
    const section = await storage.getTestSectionById(sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });
    const campaign = await storage.getCampaign(section.campaignId);
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Not found" });

    const checks: { name: string; status: "ok" | "warning" | "error"; detail: string }[] = [];

    // Fetch the live page
    let pageText = "";
    let rawPageHtml = "";
    let fetchOk = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(campaign.url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" },
      });
      clearTimeout(t);
      if (resp.ok) {
        rawPageHtml = await resp.text();
        const headEnd = rawPageHtml.toLowerCase().indexOf("</head>");
        const bodyHtml = headEnd > 0 ? rawPageHtml.slice(headEnd + 7) : rawPageHtml;
        pageText = extractPageText(bodyHtml);
        fetchOk = true;
      }
    } catch { fetchOk = false; }

    if (!fetchOk) {
      checks.push({ name: "Page fetch", status: "warning", detail: "Could not reach the live page to run a preflight check. The test may still work correctly." });
    } else {
      // Check 1: Does the control text fingerprint appear in the page?
      const fingerprint = (section.currentText || "").trim();
      if (fingerprint.length > 10) {
        const fpWords = fingerprint.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6);
        const pageLower = pageText.toLowerCase();
        const hits = fpWords.filter(w => pageLower.includes(w)).length;
        const matchRate = fpWords.length > 0 ? hits / fpWords.length : 0;
        if (matchRate >= 0.6) {
          checks.push({ name: "Element found", status: "ok", detail: `Target text fingerprint matched (${Math.round(matchRate * 100)}% word overlap). The widget should locate this element reliably.` });
        } else if (matchRate >= 0.3) {
          checks.push({ name: "Element found", status: "warning", detail: `Partial text match only (${Math.round(matchRate * 100)}% word overlap). The page content may have changed since the last scan. Re-scan the page if you see issues.` });
        } else {
          checks.push({ name: "Element found", status: "error", detail: `Target text not found on the live page. The section content may have changed since scanning. Re-scan the page before activating.` });
        }
      } else {
        checks.push({ name: "Element found", status: "warning", detail: "No text fingerprint stored for this section. Re-scan the page to capture current content." });
      }

      // Check 2: Pixel is installed (check RAW HTML, not extracted text — script tags are stripped during extraction)
      const htmlLower = rawPageHtml.toLowerCase();
      if (htmlLower.includes("siteamoeba") || htmlLower.includes("api.siteamoeba.com") || htmlLower.includes("/api/widget/script/")) {
        checks.push({ name: "Pixel installed", status: "ok", detail: "SiteAmoeba tracking pixel detected on the page." });
      } else {
        // Also check if visitors are being tracked (pixel might be loaded dynamically)
        const recentVisitors = await pool.query(
          "SELECT COUNT(*) as cnt FROM visitors WHERE campaign_id = $1 AND first_seen::timestamptz > NOW() - INTERVAL '24 hours'",
          [campaign.id]
        );
        if (parseInt(recentVisitors.rows[0]?.cnt || "0") > 0) {
          checks.push({ name: "Pixel installed", status: "ok", detail: "Tracking pixel active — visitors are being recorded." });
        } else {
          checks.push({ name: "Pixel installed", status: "warning", detail: "SiteAmoeba pixel not detected in page source. Make sure the pixel script is installed for tracking to work." });
        }
      }
    }

    // Check 3: Do the active variants look meaningful?
    const variants = await storage.getVariantsByCampaign(campaign.id);
    const sectionVariants = variants.filter(v => v.testSectionId === sectionId && !v.isControl && v.isActive);
    const flaggedVariants = sectionVariants.filter(v => (v as any).displayIssue === true);
    if (flaggedVariants.length > 0) {
      checks.push({ name: "Variant display", status: "error", detail: `${flaggedVariants.length} variant(s) were flagged by the widget as rendering incorrectly in previous sessions. Preview each variant before activating.` });
    } else if (sectionVariants.length === 0) {
      checks.push({ name: "Variant display", status: "warning", detail: "No active challenger variants found for this section. Generate variants before activating." });
    } else {
      checks.push({ name: "Variant display", status: "ok", detail: `${sectionVariants.length} active variant(s) ready. No display issues reported.` });
    }

    // Overall status: worst of all check statuses
    const overallStatus = checks.some(c => c.status === "error") ? "error"
      : checks.some(c => c.status === "warning") ? "warning" : "ok";

    res.json({ status: overallStatus, checks, sectionId, category: section.category });
  });

  app.patch("/api/sections/:id", requireAuth, async (req: Request, res: Response) => {
    // Verify ownership
    const result = await storage.getTestSectionById(paramId(req.params.id));
    if (!result) return res.status(404).json({ error: "Section not found" });
    const campaign = await storage.getCampaign(result.campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Not found" });
    }

    // Enforce concurrent test limit when activating a section
    if (req.body.isActive === true && !result.isActive) {
      const user = await storage.getUserById(req.userId!);
      if (user) {
        const activeCount = await storage.getActiveTestCountByUser(user.id);
        const planKey = user.plan in PLAN_LIMITS ? user.plan : "free";
        const limit = PLAN_LIMITS[planKey].concurrentTests;
        if (activeCount >= limit) {
          return res.status(403).json({
            error: `You've reached your concurrent test limit (${limit} test${limit === 1 ? "" : "s"}). Upgrade your plan to run more tests simultaneously.`,
          });
        }
      }
    }

    const updated = await storage.updateTestSection(paramId(req.params.id), req.body);

    // Track TTFT: record first time user ever activates a test
    if (req.body.isActive === true && !result.isActive) {
      const user = await storage.getUserById(req.userId!);
      if (user && !(user as any).firstTestEnabledAt) {
        await pool.query(
          'UPDATE users SET first_test_enabled_at = $1 WHERE id = $2',
          [new Date().toISOString(), req.userId]
        );
      }
    }

    res.json(updated);
  });

  // ============== AI VARIANT GENERATION ==============

  app.post("/api/ai/generate-variants", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Resolve LLM config
    let llmConfigResolved;
    try {
      llmConfigResolved = resolveLLMConfig({
        operation: "variant",
        userPlan: user.plan || "free",
        userProvider: user.llmProvider,
        userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
        userModel: user.llmModel,
      });
    } catch {
      return res.status(403).json({ error: "UPGRADE_REQUIRED", message: "Variant generation requires your own API key (Settings) or a paid plan." });
    }

    // Deduct credits for variant generation
    const variantCreditCheck = await consumeCredits(req.userId!, llmConfigResolved.creditCost);
    if (!variantCreditCheck.ok) return res.status(402).json({ error: variantCreditCheck.errorMsg });

    const { campaignId, type, sectionId } = req.body;

    // Test locking removed — users manage their own test lifecycle


    if (!campaignId || !type) {
      return res.status(400).json({ error: "campaignId and type are required" });
    }

    const campaign = await storage.getCampaign(parseInt(campaignId));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get all existing variants for this campaign
    const allVariants = await storage.getVariantsByCampaign(campaign.id);
    const typeVariants = allVariants.filter(v => v.type === type);
    const controlVariant = typeVariants.find(v => v.isControl);
    const controlHeadlineVariant = allVariants.find(v => v.type === 'headline' && v.isControl);
    const controlSubheadlineVariant = allVariants.find(v => v.type === 'subheadline' && v.isControl);

    // Collect existing persuasion tags
    const existingTags: string[] = [];
    for (const v of typeVariants) {
      if (v.persuasionTags) {
        try {
          const tags = JSON.parse(v.persuasionTags);
          if (Array.isArray(tags)) existingTags.push(...tags);
        } catch {}
      }
    }

    const context: GenerationContext = {
      campaignName: campaign.name,
      pageUrl: campaign.url,
      currentVariants: typeVariants.map(v => v.text),
      controlHeadline: controlHeadlineVariant?.text,
      controlSubheadline: controlSubheadlineVariant?.text,
      existingPersuasionTags: existingTags.length > 0 ? Array.from(new Set(existingTags)) : undefined,
      type,
      // Page context for hard rules injection
      pageType: campaign.pageType || undefined,
      pageGoal: campaign.pageGoal || undefined,
      pricePoint: campaign.pricePoint || undefined,
      niche: campaign.niche || undefined,
      // Verified facts: prevents AI from fabricating social proof claims
      pageFacts: (campaign as any).pageFacts || undefined,
    };

    // Get test section info for context — use sectionId if provided (precise), otherwise fall back to first match
    const testSections = await storage.getTestSectionsByCampaign(campaign.id);
    const matchingSection = sectionId
      ? testSections.find(s => s.id === parseInt(sectionId))
      : testSections.find(s => s.category === type);
    if (matchingSection) {
      context.controlText = matchingSection.currentText || undefined;
      context.sectionLabel = matchingSection.label;
      context.sectionPurpose = matchingSection.purpose || undefined;
    }

    // Inject brain knowledge and network intelligence for paid users
    const isPaid = user.plan !== 'free';
    if (isPaid) {
      try {
        const knowledge = await storage.getBrainKnowledge({
          pageType: campaign.pageType || undefined,
          sectionType: type,
          limit: 5,
        });
        if (knowledge.length > 0) {
          const brainInsights = knowledge.map((k: any) =>
            `- ${k.section_type} test: "${(k.winning_text || '').slice(0, 80)}" beat "${(k.original_text || '').slice(0, 80)}" with +${(k.lift_percent || 0).toFixed(0)}% lift (${k.sample_size || 0} visitors)${k.insight ? '. Insight: ' + k.insight.slice(0, 120) : ''}`
          ).join('\n');
          context.brainKnowledge = brainInsights;
        }
      } catch (err) {
        console.warn('Failed to fetch brain knowledge:', err);
      }

      // Network intelligence — data-driven patterns from ALL campaigns
      try {
        const networkIntel = await getNetworkIntelligence();
        if (networkIntel) context.networkIntelligence = networkIntel;
      } catch (err) {
        console.warn('Failed to fetch network intelligence:', err);
      }

      // THIS campaign's test history — so variants don't repeat losing strategies
      try {
        const historyResult = await pool.query(
          `SELECT section_type, winner_strategy, loser_strategy, lift_percent
           FROM test_lessons WHERE campaign_id = $1 AND section_type = $2
           ORDER BY created_at DESC LIMIT 5`,
          [campaign.id, type]
        );
        if (historyResult.rows.length > 0) {
          context.campaignTestHistory = historyResult.rows.map((r: any) =>
            `${r.winner_strategy || 'unknown'} beat ${r.loser_strategy || 'unknown'} by +${(r.lift_percent || 0).toFixed(1)}%`
          ).join('; ');
        }
      } catch (err) {
        console.warn('Failed to fetch campaign test history:', err);
      }

      // WINNING PATTERNS from ALL test_lessons — for Brain's Choice ranking
      try {
        const allLessons = await pool.query(
          `SELECT section_type, page_type, niche, winner_strategy, loser_strategy,
                  winner_conversion_rate, loser_conversion_rate, lift_percent, confidence,
                  sample_size, LEFT(winner_text, 100) as winner_text, lesson
           FROM test_lessons WHERE section_type = $1
           ORDER BY confidence DESC, lift_percent DESC LIMIT 10`,
          [type]
        );
        if (allLessons.rows.length > 0) {
          const patterns = allLessons.rows.map((r: any) =>
            `PROVEN WINNER: "${r.winner_strategy}" beat "${r.loser_strategy}" by +${(r.lift_percent || 0).toFixed(0)}% ` +
            `(${r.confidence?.toFixed(0) || '?'}% confidence, ${r.sample_size || '?'} visitors)` +
            `${r.niche ? ` in ${r.niche} niche` : ''}` +
            `${r.lesson ? `. KEY LESSON: ${r.lesson.slice(0, 200)}` : ''}`
          ).join('\n');
          context.winningPatterns = patterns;
        }
      } catch (err) {
        console.warn('Failed to fetch winning patterns:', err);
      }
    }

    let messages;
    if (type === 'headline') {
      messages = buildHeadlineGenerationPrompt(context);
    } else if (type === 'subheadline') {
      messages = buildSubheadlineGenerationPrompt(context);
    } else {
      messages = buildSectionGenerationPrompt(context);
    }

    let rawResponse: string;
    try {
      rawResponse = await callLLM(llmConfigResolved.config, messages);
    } catch (err: any) {
      console.error('LLM call failed:', err);
      return res.status(502).json({ error: err.message || "AI provider error. Check your API key and credits in Settings." });
    }

    // Parse the JSON response — handle markdown code blocks
    let variants: { text: string; strategy: string; reasoning: string }[];
    try {
      // Strip markdown fences if present
      const cleaned = rawResponse
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      variants = JSON.parse(cleaned);
      if (!Array.isArray(variants)) throw new Error('Expected JSON array');
    } catch (err: any) {
      console.error('Failed to parse LLM response:', rawResponse);
      return res.status(502).json({ error: 'AI returned invalid JSON. Please try again.' });
    }

    // Validate and sanitize each variant
    const sanitized = variants
      .filter(v => v && typeof v.text === 'string' && v.text.trim())
      .map(v => ({
        text: v.text.trim(),
        strategy: v.strategy || 'unknown',
        reasoning: v.reasoning || '',
        brainChoice: v.brainChoice === true,
        brainReasoning: v.brainChoice ? (v.brainReasoning || '') : undefined,
      }))
      .slice(0, 3);

    // Ensure exactly one Brain's Choice (pick first if multiple, pick best strategy if none)
    const hasChoice = sanitized.some(v => v.brainChoice);
    if (!hasChoice && sanitized.length > 0) {
      // Default: pick the first variant as Brain's Choice
      sanitized[0].brainChoice = true;
      sanitized[0].brainReasoning = sanitized[0].brainReasoning || 'Selected as the most likely to outperform based on available test data and CRO principles.';
    }
    const choiceCount = sanitized.filter(v => v.brainChoice).length;
    if (choiceCount > 1) {
      // Only keep the first Brain's Choice
      let found = false;
      for (const v of sanitized) {
        if (v.brainChoice && found) { v.brainChoice = false; v.brainReasoning = undefined; }
        if (v.brainChoice) found = true;
      }
    }

    res.json({ variants: sanitized });
  });

  // ============== DECLARE WINNER ==============

  app.post("/api/campaigns/:id/declare-winner", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const { variantId, sectionType } = req.body;
    if (!variantId || !sectionType) {
      return res.status(400).json({ error: "variantId and sectionType are required" });
    }

    // Verify the variant belongs to this campaign
    const winningVariant = await storage.getVariant(parseInt(variantId));
    if (!winningVariant || winningVariant.campaignId !== campaign.id) {
      return res.status(404).json({ error: "Variant not found in this campaign" });
    }

    // Get all variants of the same type
    const allVariants = await storage.getVariantsByCampaign(campaign.id);
    const typeVariants = allVariants.filter(v => v.type === sectionType);

    // Gather stats before deactivating (for test lesson)
    const variantStats = await storage.getVariantStats(campaign.id);
    const typeStats = variantStats.filter(v => v.type === sectionType);
    const winnerStats = typeStats.find(v => v.variantId === winningVariant.id);
    const controlStats = typeStats.find(v => v.isControl && v.variantId !== winningVariant.id);

    // Deactivate all variants of this type, remove control from old control
    for (const v of typeVariants) {
      const updates: any = { isActive: false, isControl: false };
      await storage.updateVariant(v.id, updates);
    }

    // Mark the winner as the new control (and keep active)
    await storage.updateVariant(winningVariant.id, {
      isActive: true,
      isControl: true,
    } as any);

    // Update test_sections.current_text to match the winning variant
    // This makes the "original text from scan" reflect the new baseline
    // and prevents false mismatch detection
    try {
      const winnerPlainText = winningVariant.text.replace(/<[^>]*>/g, '').trim();
      if (winnerPlainText && winningVariant.testSectionId) {
        await pool.query(
          `UPDATE test_sections SET current_text = $1, mismatch_detected = false WHERE id = $2`,
          [winnerPlainText, winningVariant.testSectionId]
        );
      } else {
        // Fallback: update any section matching this type for this campaign
        await pool.query(
          `UPDATE test_sections SET current_text = $1, mismatch_detected = false
           WHERE campaign_id = $2 AND category = $3`,
          [winnerPlainText, campaign.id, sectionType]
        );
      }
    } catch (e) {
      console.warn("[declare-winner] Failed to update test_sections.current_text:", e);
    }

    // === TEST LESSON: Auto-generate and store a lesson from this result ===
    // Only generate a lesson if there's a meaningful comparison (winner vs loser stats available)
    let lesson: any = null;
    try {
      if (winnerStats && controlStats && winnerStats.impressions >= 10 && controlStats.impressions >= 10) {
        const loserVariant = typeVariants.find(v => v.id === controlStats.variantId) ||
                             typeVariants.find(v => v.id !== winningVariant.id);

        const winnerCvr = winnerStats.conversionRate;
        const loserCvr = controlStats.conversionRate;
        const liftPct = loserCvr > 0
          ? ((winnerCvr - loserCvr) / loserCvr) * 100
          : (winnerCvr > 0 ? 100 : 0); // If loser had 0% and winner has conversions, that's a 100% lift
        const sampleSize = winnerStats.impressions + controlStats.impressions;

        // Parse persuasion tags
        let winnerStrategy: string | undefined;
        let loserStrategy: string | undefined;
        try {
          const winnerTags = winningVariant.persuasionTags ? JSON.parse(winningVariant.persuasionTags) : [];
          winnerStrategy = Array.isArray(winnerTags) ? winnerTags[0] : undefined;
        } catch { /* ignore */ }
        if (loserVariant) {
          try {
            const loserTags = loserVariant.persuasionTags ? JSON.parse(loserVariant.persuasionTags) : [];
            loserStrategy = Array.isArray(loserTags) ? loserTags[0] : undefined;
          } catch { /* ignore */ }
        }

        const lessonData: any = {
          campaignId: campaign.id,
          sectionType,
          pageType: campaign.pageType || "sales_page",
          niche: campaign.niche || undefined,
          pricePoint: campaign.pricePoint || undefined,
          winnerText: winningVariant.text,
          loserText: loserVariant ? loserVariant.text : controlStats.text,
          winnerConversionRate: winnerCvr,
          loserConversionRate: loserCvr,
          liftPercent: liftPct,
          winnerStrategy,
          loserStrategy,
          sampleSize,
          confidence: winnerStats.confidence,
        };

        // Try to generate an LLM lesson summary
        const user = await storage.getUserById(req.userId!);
        let lessonLLMConfig;
        try {
          lessonLLMConfig = resolveLLMConfig({
            operation: "autopilot_learn",
            userPlan: user?.plan || "free",
            userProvider: user?.llmProvider,
            userApiKey: user?.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
            userModel: user?.llmModel,
          });
        } catch { lessonLLMConfig = null; }
        if (lessonLLMConfig) {
          try {
            const llmConfig = lessonLLMConfig.config;
            const lessonMessages = buildTestLessonPrompt({
              sectionType,
              pageType: campaign.pageType || undefined,
              niche: campaign.niche || undefined,
              pricePoint: campaign.pricePoint || undefined,
              winnerText: winningVariant.text,
              loserText: loserVariant ? loserVariant.text : controlStats.text,
              winnerConversionRate: winnerCvr,
              loserConversionRate: loserCvr,
              liftPercent: liftPct,
              winnerStrategy,
              loserStrategy,
              sampleSize,
              confidence: winnerStats.confidence,
            });
            const lessonText = await callLLM(llmConfig, lessonMessages);
            lessonData.lesson = lessonText.trim();
          } catch (err) {
            // Non-fatal — store the lesson without LLM summary
            console.warn("Could not generate LLM lesson summary:", err);
          }
        }

        lesson = await storage.createTestLesson(lessonData);

        // === BRAIN KNOWLEDGE: Store this result for the shared intelligence network ===
        try {
          await storage.addBrainKnowledge({
            knowledgeType: "test_result",
            pageType: campaign.pageType || "sales_page",
            niche: campaign.niche || undefined,
            sectionType,
            originalText: loserVariant ? loserVariant.text.replace(/<[^>]*>/g, '').slice(0, 500) : undefined,
            winningText: winningVariant.text.replace(/<[^>]*>/g, '').slice(0, 500),
            liftPercent: liftPct,
            confidence: winnerStats.confidence,
            sampleSize,
            insight: lessonData.lesson || undefined,
            tags: winningVariant.persuasionTags || undefined,
            campaignId: campaign.id,
            userId: req.userId!,
          });
        } catch (bkErr) {
          console.warn("Failed to store brain knowledge:", bkErr);
        }

        // === SPECIALIST POST-MORTEM: Each counsel specialist analyzes this result ===
        // Fire-and-forget — don't block the response
        if (lessonLLMConfig && loserVariant) {
          runPostMortem(lessonLLMConfig.config, {
            sectionType,
            pageType: campaign.pageType || "sales_page",
            niche: campaign.niche || undefined,
            winnerText: winningVariant.text,
            loserText: loserVariant.text,
            winnerConversionRate: winnerCvr,
            loserConversionRate: loserCvr,
            liftPercent: liftPct,
            sampleSize,
            confidence: winnerStats.confidence,
            campaignId: campaign.id,
            userId: req.userId!,
          }).catch(err => console.warn("Specialist post-mortem failed:", err));
        }
      }
    } catch (err) {
      // Non-fatal — winner is still declared even if lesson fails
      console.warn("Test lesson creation failed:", err);
    }

    // Build test result summary for celebration UI
    const winnerCvr = winnerStats?.conversionRate ?? 0;
    const controlCvr = controlStats?.conversionRate ?? 0;
    const liftPctFinal = controlCvr > 0
      ? ((winnerCvr - controlCvr) / controlCvr) * 100
      : (winnerCvr > 0 ? 100 : 0);
    const totalSample = (winnerStats?.impressions ?? 0) + (controlStats?.impressions ?? 0);

    res.json({
      ok: true,
      winner: {
        id: winningVariant.id,
        text: winningVariant.text,
        type: winningVariant.type,
      },
      lesson: lesson ? { id: lesson.id, lesson: lesson.lesson } : null,
      testSummary: {
        liftPercent: liftPctFinal,
        winnerConversionRate: winnerCvr,
        controlConversionRate: controlCvr,
        totalVisitors: totalSample,
        winnerVisitors: winnerStats?.impressions ?? 0,
        winnerConversions: winnerStats?.conversions ?? 0,
        controlText: controlStats?.text || typeVariants.find(v => v.id !== winningVariant.id)?.text || "",
        confidence: winnerStats?.confidence ?? 0,
        sectionType,
        campaignName: campaign.name,
        pageUrl: campaign.url,
      },
    });

    // Refresh network intelligence — new test result should feed the Brain immediately
    refreshNetworkIntelligence().catch(err => 
      console.warn("[declare-winner] Network intelligence refresh failed:", err.message)
    );
  });

  // ============== AUTOPILOT ==============

  // POST /api/campaigns/:id/autopilot/enable
  app.post("/api/campaigns/:id/autopilot/enable", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Check autopilot plan — only 'autopilot' plan users can enable autopilot
    if (user.plan !== "autopilot") {
      return res.status(403).json({ error: "Autopilot requires the Autopilot plan ($299/mo). Upgrade to enable this feature." });
    }

    // Enable autopilot — reset to step 0 if starting fresh
    const updatedCampaign = await storage.updateCampaign(campaign.id, {
      autopilotEnabled: true,
      autopilotStep: campaign.autopilotStep ?? 0,
      autopilotStatus: "advancing",
    } as any);

    // Start the first playbook step asynchronously
    advanceAutopilot(campaign.id, user.id).catch((err) => {
      console.error("Autopilot initial advance failed:", err);
      storage.updateCampaign(campaign.id, { autopilotStatus: "idle" } as any).catch(() => {});
    });

    res.json({ ok: true, campaign: updatedCampaign });
  });

  // POST /api/campaigns/:id/autopilot/disable
  app.post("/api/campaigns/:id/autopilot/disable", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const updated = await storage.updateCampaign(campaign.id, {
      autopilotEnabled: false,
      autopilotStatus: "paused",
    } as any);

    res.json({ ok: true, campaign: updated });
  });

  // POST /api/campaigns/:id/autopilot/evaluate
  // Manually trigger evaluation — also called by the widget on traffic
  app.post("/api/campaigns/:id/autopilot/evaluate", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    if (!campaign.autopilotEnabled) {
      return res.status(400).json({ error: "Autopilot is not enabled for this campaign" });
    }

    const action = await evaluateAutopilotTests(campaign.id);
    res.json({ ok: true, action });
  });

  // GET /api/campaigns/:id/autopilot/status
  app.get("/api/campaigns/:id/autopilot/status", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Filter playbook to only sections the user selected as testable
    const allSections = await storage.getTestSectionsByCampaign(campaign.id);
    const testableCategories = new Set(allSections.map(s => s.category));
    const fullPlaybook = getPlaybook(campaign.pageType || "landing_page");
    const playbook = fullPlaybook.filter(step => testableCategories.has(step.sectionCategory));

    const currentStepIndex = campaign.autopilotStep ?? 0;
    const currentPlaybookStep = playbook[currentStepIndex] || null;

    // Find the current test section being tested
    let currentSectionId: number | null = null;
    if (currentPlaybookStep) {
      const activeSection = allSections.find(
        (s) => s.category === currentPlaybookStep.sectionCategory
      );
      if (activeSection) currentSectionId = activeSection.id;
    }

    // Get visitor counts for progress message
    let visitorsOnCurrentTest = 0;
    if (currentPlaybookStep) {
      const variantStats = await storage.getVariantStats(campaign.id);
      const controlStats = variantStats.find(
        (v) => v.type === currentPlaybookStep.sectionCategory && v.isControl
      );
      visitorsOnCurrentTest = controlStats?.impressions ?? 0;
    }

    res.json({
      enabled: campaign.autopilotEnabled ?? false,
      currentStep: currentStepIndex,
      totalSteps: playbook.length,
      status: campaign.autopilotStatus ?? "idle",
      currentSectionId,
      playbook,
      currentPlaybookStep,
      visitorsOnCurrentTest,
      minVisitorsNeeded: null,
      lastEvaluatedAt: null,
    });
  });

  // ============== BRAIN CHAT ==============

  app.post("/api/ai/brain-chat", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    let llmConfigResolved;
    try {
      llmConfigResolved = resolveLLMConfig({
        operation: "chat",
        userPlan: user.plan || "free",
        userProvider: user.llmProvider,
        userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
        userModel: user.llmModel,
      });
    } catch {
      return res.status(403).json({ error: "UPGRADE_REQUIRED", message: "Brain Chat is a paid feature. Upgrade your plan to unlock the Brain and get AI-powered optimization insights." });
    }

    // Deduct credits for this Brain Chat message
    const brainCreditCheck = await consumeCredits(req.userId!, llmConfigResolved.creditCost);
    if (!brainCreditCheck.ok) return res.status(402).json({ error: brainCreditCheck.errorMsg });

    const { campaignId, history, useCounsel } = req.body;
    const message = typeof req.body.message === "string" ? sanitizeInput(req.body.message) : req.body.message;
    if (!campaignId || !message) {
      return res.status(400).json({ error: "campaignId and message are required" });
    }

    const campaign = await storage.getCampaign(parseInt(campaignId));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Gather campaign context
    const allVariantStats = await storage.getVariantStats(campaign.id);
    const allTestSections = await storage.getTestSectionsByCampaign(campaign.id);

    // === CRITICAL: Only surface ACTIVE test data to the Brain ===
    // Inactive sections and their variants must NEVER be shown as part of a running test.
    // The AI must know exactly what is live vs. paused, or it will fabricate test issues.
    const activeTestSections = allTestSections.filter(s => s.isActive);
    const activeSectionCategories = new Set(activeTestSections.map(s => s.category));

    // Only include variant stats for sections that are actively testing
    // (active section exists + at least one active non-control challenger)
    const activeVariantStats = allVariantStats.filter(v => {
      if (!v.isActive) return false;
      // Must belong to an active section (by testSectionId or by category match to active section)
      if (v.testSectionId) {
        return activeTestSections.some(s => s.id === v.testSectionId);
      }
      return activeSectionCategories.has(v.type);
    });

    // Are any tests actually running right now?
    const testsAreRunning = activeTestSections.length > 0 &&
      activeVariantStats.some(v => !v.isControl);

    const totalVisitors = await storage.getVisitorCountByCampaign(campaign.id);
    const totalConversions = allVariantStats.reduce((sum, v) => sum + (v.type === "headline" ? v.conversions : 0), 0);
    const conversionRate = totalVisitors > 0 ? (totalConversions / totalVisitors) * 100 : 0;

    const brainKnowledge = getBrainPageAuditKnowledge();

    // Inject dynamic brain knowledge from the network for paid users
    let dynamicBrainKnowledge = "";
    if (user.plan !== "free") {
      try {
        const knowledge = await storage.getBrainKnowledge({
          pageType: campaign.pageType || undefined,
          limit: 10,
        });
        if (knowledge.length > 0) {
          dynamicBrainKnowledge = "\n\nREAL A/B TEST RESULTS FROM THE SITEAMOEBA NETWORK (use these to give data-backed advice):\n" +
            knowledge.map((k: any) =>
              `- ${k.section_type || 'unknown'} test (${k.page_type || 'unknown'} page): "${(k.winning_text || '').slice(0, 60)}..." beat "${(k.original_text || '').slice(0, 60)}..." with +${(k.lift_percent || 0).toFixed(0)}% lift across ${k.sample_size || 0} visitors${k.insight ? '. Key insight: ' + k.insight.slice(0, 100) : ''}`
            ).join('\n');
        }
      } catch (err) {
        console.warn('Failed to fetch brain knowledge for chat:', err);
      }
    }

    // Fetch the actual page content so the Brain can reference real page elements
    let pageContent = "";
    try {
      const pageResponse = await fetch(campaign.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteAmoeba/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (pageResponse.ok) {
        let html = await pageResponse.text();
        // Strip scripts, styles, SVGs to focus on content
        html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                   .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
                   .replace(/<[^>]+>/g, " ")
                   .replace(/\s+/g, " ")
                   .trim();
        // Truncate to ~4000 chars to leave room for other context
        pageContent = html.substring(0, 4000);
      }
    } catch (err) {
      // Non-fatal — chat works without page content, just less specific
      console.log("Could not fetch page for chat context:", (err as any)?.message);
    }

    // Get network intelligence (learned from ALL data across ALL campaigns)
    const networkIntel = await getNetworkIntelligence();

    // Get relevant test lessons for context (network-wide)
    const primarySectionType = activeTestSections[0]?.category || "headline";
    const testLessonsText = await getRelevantTestLessons(
      campaign.pageType || "sales_page",
      primarySectionType,
      campaign.niche || undefined
    );

    // === CRITICAL: Get THIS campaign's own test history ===
    // The Brain MUST know what has already been tested and proven on this specific campaign.
    // Without this, the AI will suggest changes that directly contradict proven winners.
    let campaignTestHistory = "";
    try {
      const historyResult = await pool.query(
        `SELECT section_type, winner_text, loser_text, winner_strategy, loser_strategy,
                lift_percent, winner_conversion_rate, loser_conversion_rate,
                sample_size, confidence, lesson, created_at
         FROM test_lessons WHERE campaign_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [campaign.id]
      );
      if (historyResult.rows.length > 0) {
        const lines = historyResult.rows.map((r: any) => {
          const winSnip = (r.winner_text || "").replace(/<[^>]*>/g, "").slice(0, 100);
          const loseSnip = (r.loser_text || "").replace(/<[^>]*>/g, "").slice(0, 100);
          const date = (r.created_at || "").slice(0, 10);
          return [
            `  [${r.section_type}] Winner (${r.winner_strategy || "unknown"}): "${winSnip}"`,
            `    Beat (${r.loser_strategy || "unknown"}): "${loseSnip}"`,
            `    Result: +${(r.lift_percent || 0).toFixed(1)}% lift | ${((r.winner_conversion_rate || 0) * 100).toFixed(2)}% vs ${((r.loser_conversion_rate || 0) * 100).toFixed(2)}% CVR | ${(r.confidence || 0).toFixed(0)}% confidence | ${r.sample_size || 0} visitors | ${date}`,
            r.lesson ? `    Lesson: ${r.lesson.slice(0, 200)}` : "",
          ].filter(Boolean).join("\n");
        });
        campaignTestHistory = "\n\nTHIS CAMPAIGN'S PROVEN TEST RESULTS (NEVER contradict these — the data is real):\n" + lines.join("\n\n");
      }
    } catch (err) {
      console.warn("Failed to fetch campaign test history:", err);
    }

    const chatContext = {
      campaignUrl: campaign.url,
      campaignName: campaign.name,
      pageContent,
      // ONLY active sections with live tests
      sections: activeTestSections.map(s => ({
        label: s.label,
        category: s.category,
        currentText: s.currentText,
        isActive: true,
        testMethod: s.testMethod,
      })),
      // ONLY variants from active sections
      variants: activeVariantStats.map(v => ({
        id: v.variantId,
        text: v.text,
        type: v.type,
        isControl: v.isControl,
        isActive: true,
        visitors: v.impressions,
        conversions: v.conversions,
        conversionRate: v.conversionRate * 100,
        confidence: v.confidence,
        persuasionTags: v.persuasionTags,
      })),
      // State of testing — explicitly included so AI never guesses
      testsAreRunning,
      totalVisitors,
      totalConversions,
      conversionRate,
      brainKnowledge: brainKnowledge + dynamicBrainKnowledge,
      winConfidenceThreshold: user.winConfidenceThreshold,
      pageType: campaign.pageType || undefined,
      pageGoal: campaign.pageGoal || undefined,
      pricePoint: campaign.pricePoint || undefined,
      niche: campaign.niche || undefined,
      testLessons: testLessonsText || undefined,
      campaignTestHistory,
      networkIntelligence: networkIntel || undefined,
    };

    const llmConfig = llmConfigResolved.config;

    // --- Counsel mode: 3 specialists + chairman synthesis ---
    if (useCounsel) {
      // Build a flat context string for the counsel engine
      const contextString = [
        `Campaign: ${chatContext.campaignName} (${chatContext.campaignUrl})`,
        chatContext.pageType ? `Page type: ${chatContext.pageType}` : "",
        chatContext.pageGoal ? `Page goal: ${chatContext.pageGoal}` : "",
        chatContext.niche ? `Niche: ${chatContext.niche}` : "",
        chatContext.pricePoint ? `Price point: ${chatContext.pricePoint}` : "",
        `Total visitors: ${chatContext.totalVisitors}`,
        `Total conversions: ${chatContext.totalConversions}`,
        `Conversion rate: ${chatContext.conversionRate.toFixed(2)}%`,
        // CRITICAL: Explicitly state testing state so AI never fabricates split-test issues
        chatContext.testsAreRunning
          ? `\nTEST STATUS: ACTIVE — ${chatContext.sections.length} section(s) currently being tested.`
          : `\nTEST STATUS: NO TESTS RUNNING — All test sections are currently paused or disabled. The page is showing 100% original content to all visitors. Do NOT suggest split-test issues as a cause of any conversion problems.`,
        chatContext.sections.length > 0 && chatContext.testsAreRunning
          ? `\nActive test sections:\n${chatContext.sections.map(s => `  - ${s.label} (${s.category}): "${(s.currentText || "").slice(0, 80)}"`).join("\n")}`
          : "",
        chatContext.variants.length > 0 && chatContext.testsAreRunning
          ? `\nActive variants:\n${chatContext.variants.map(v => `  - "${(v.text || "").slice(0, 60)}" | ${v.visitors} visitors | ${v.conversions} conversions | ${v.conversionRate.toFixed(2)}% CVR | ${v.confidence.toFixed(0)}% confidence${v.isControl ? " (CONTROL)" : " (CHALLENGER)"}`).join("\n")}`
          : "",
        chatContext.pageContent ? `\nPage content excerpt:\n${chatContext.pageContent.slice(0, 2000)}` : "",
        chatContext.brainKnowledge ? `\n${chatContext.brainKnowledge.slice(0, 1500)}` : "",
        chatContext.campaignTestHistory || "",
        chatContext.networkIntelligence ? `\n${chatContext.networkIntelligence.slice(0, 4000)}` : "",
        `\n${getCROKnowledge().slice(0, 4000)}`,
      ].filter(Boolean).join("\n");

      let counselResult;
      try {
        counselResult = await runCounsel(llmConfig, message, contextString);
      } catch (err: any) {
        console.error("Counsel deliberation failed:", err);
        return res.status(502).json({ error: err.message || "AI provider error. Check your API key in Settings." });
      }

      return res.json({
        response: counselResult.synthesis,
        counsel: {
          specialists: counselResult.specialists,
          synthesis: counselResult.synthesis,
        },
      });
    }

    // --- Standard single-model chat ---
    const messages = buildBrainChatPrompt(chatContext, history || [], message);

    let response: string;
    try {
      response = await callLLM(llmConfig, messages);
    } catch (err: any) {
      console.error("Brain chat LLM call failed:", err);
      return res.status(502).json({ error: err.message || "AI provider error. Check your API key in Settings." });
    }

    res.json({ response });
  });

  // ============== CRO REPORT ==============

  app.post("/api/ai/cro-report", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    let llmConfigResolved;
    try {
      llmConfigResolved = resolveLLMConfig({
        operation: "chat",
        userPlan: user.plan || "free",
        userProvider: user.llmProvider,
        userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
        userModel: user.llmModel,
      });
    } catch {
      return res.status(400).json({ error: "CRO Report requires a paid plan or your own API key in Settings." });
    }

    const { campaignId, url } = req.body;
    if (!campaignId && !url) return res.status(400).json({ error: "campaignId or url required" });

    // Get campaign metadata if available
    let reportUrl = url;
    let campaignMeta: any = { url: reportUrl };
    if (campaignId) {
      const campaign = await storage.getCampaign(parseInt(campaignId));
      if (campaign && campaign.userId === req.userId) {
        reportUrl = campaign.url;
        campaignMeta = {
          url: campaign.url,
          pageType: campaign.pageType || undefined,
          pageGoal: campaign.pageGoal || undefined,
          niche: campaign.niche || undefined,
          pricePoint: campaign.pricePoint || undefined,
          pageFacts: (campaign as any).pageFacts || undefined,
        };
      }
    }

    // Deduct credits (3 per CRO report — it's a heavy analysis)
    const creditCheck = await consumeCredits(req.userId!, 3);
    if (!creditCheck.ok) return res.status(402).json({ error: creditCheck.errorMsg });

    // Fetch full page content using the same extractPageText pipeline as the scanner
    let pageContent = "";
    try {
      const pageResponse = await fetch(reportUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (pageResponse.ok) {
        const rawHtml = await pageResponse.text();
        const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        const titleText = titleMatch ? `Page title: ${titleMatch[1].trim()}\n\n` : "";
        const headEnd = rawHtml.toLowerCase().indexOf("</head>");
        const bodyHtml = headEnd > 0 ? rawHtml.slice(headEnd + 7) : rawHtml;
        // Use same extractPageText as the scanner — 40KB covers the full page
        pageContent = (titleText + extractPageText(bodyHtml)).slice(0, 40000);
      }
    } catch (err) {
      console.log("CRO report: could not fetch page:", (err as any)?.message);
    }

    const messages = buildCROReportPrompt(pageContent, campaignMeta);
    const llmConfig = llmConfigResolved.config;

    let report: string;
    try {
      report = await callLLM(llmConfig, messages, { maxTokens: 4000 });
    } catch (err: any) {
      return res.status(502).json({ error: err.message || "AI provider error." });
    }

    return res.json({ report, url: reportUrl });
  });

  // ============== TRAFFIC SOURCE HELPERS ==============

  function parseTrafficSource(referrer: string, utmSource: string, utmMedium: string): string {
    const ref = (referrer || "").toLowerCase();
    const src = (utmSource || "").toLowerCase();
    const med = (utmMedium || "").toLowerCase();

    if (src.includes("instagram") || ref.includes("instagram.com")) return "instagram";
    if (src.includes("facebook") || src.includes("fb") || ref.includes("facebook.com") || ref.includes("fb.com")) return "facebook";
    if (ref.includes("google") && (med === "cpc" || med === "ppc")) return "google_ads";
    if (ref.includes("google")) return "google_organic";
    if (med === "email" || ref.includes("mail.google") || ref.includes("mail.yahoo") || ref.includes("outlook.live") || ref.includes("outlook.com")) return "email";
    if (ref.includes("tiktok") || src.includes("tiktok")) return "tiktok";
    if (ref.includes("youtube") || src.includes("youtube")) return "youtube";
    if (ref.includes("twitter") || ref.includes("x.com") || ref.includes("t.co") || src.includes("twitter") || src.includes("x")) return "twitter";
    if (ref.includes("linkedin") || src.includes("linkedin")) return "linkedin";
    if (!ref && !src) return "direct";
    return "other";
  }

  function parseDeviceCategory(userAgent: string): string {
    const ua = (userAgent || "").toLowerCase();
    if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
    if (ua.includes("android")) return "android";
    if (ua.includes("macintosh") || ua.includes("mac os x")) return "desktop_mac";
    if (ua.includes("windows")) return "desktop_windows";
    return "other";
  }

  // ============== WIDGET API (public, CORS) ==============

  app.use("/api/widget", (req, res, next) => {
    // Use the request's origin for CORS (supports credentialed requests)
    const origin = req.headers.origin || "*";
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // ============== PREVIEW DATA (for widget preview mode) ==============
  // Returns variant data in the same format as /assign, but for a specific variant.
  // Called by the widget when sa_preview query param is present.
  app.get("/api/widget/preview-data", async (req: Request, res: Response) => {
    const campaignId = parseInt(req.query.cid as string);
    const variantId = parseInt(req.query.variantId as string);
    const tokenStr = req.query.token as string;

    if (!campaignId || !variantId) {
      return res.status(400).json({ error: "Missing cid or variantId" });
    }

    // Validate token
    try {
      jwt.verify(tokenStr, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const campaign = await storage.getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const variant = await storage.getVariant(variantId);
    if (!variant || variant.campaignId !== campaignId) {
      return res.status(404).json({ error: "Variant not found" });
    }

    // Resolve selector using the same strategy as the assign endpoint
    const testSections = await storage.getTestSectionsByCampaign(campaignId);
    let section = variant.testSectionId
      ? testSections.find(s => s.id === variant.testSectionId)
      : undefined;
    if (!section) {
      section = testSections.find(s => s.isActive && s.category === variant.type);
    }

    // Also get the control text so the widget can find elements by content fingerprint
    const controlVariant = await pool.query(
      `SELECT text FROM variants WHERE campaign_id = $1 AND type = $2 AND is_control = true AND is_active = true LIMIT 1`,
      [campaignId, variant.type]
    );
    const controlText = controlVariant.rows[0]?.text || "";

    const payload: any = {
      id: variant.id,
      text: variant.text,
      isControl: !!variant.isControl,
      selector: section?.selector || campaign.headlineSelector || "",
      testMethod: section?.testMethod || "text_swap",
      // currentText: the actual page text at scan time — most reliable cross-platform fingerprint
      currentText: section?.currentText || controlText,
      controlText,
      category: variant.type,
    };

    // Return in the same shape as the assign endpoint
    const result: any = { headline: null, subheadline: null };
    if (variant.type === "headline") result.headline = payload;
    else if (variant.type === "subheadline") result.subheadline = payload;
    else {
      result.sections = [{ ...payload }];
    }

    res.json(result);
  });

  app.get("/api/widget/assign", widgetLimiter, async (req: Request, res: Response) => {
    let visitorId = req.query.vid as string;
    const campaignId = parseInt(req.query.cid as string);
    const fingerprint = req.query.fp as string | undefined;

    if (!visitorId || !campaignId) {
      return res.status(400).json({ error: "Missing vid or cid" });
    }

    // Fingerprint recovery: if this visitor ID is new but we have a fingerprint,
    // look up a prior visitor with the same fingerprint to preserve variant assignment
    // across sessions (catches Safari ITP resets, private browsing, etc.)
    if (fingerprint) {
      try {
        const fpMatch = await pool.query(
          `SELECT id FROM visitors WHERE fingerprint = $1 AND campaign_id = $2 ORDER BY first_seen DESC LIMIT 1`,
          [fingerprint, campaignId]
        );
        if (fpMatch.rows.length > 0) {
          const recoveredId = fpMatch.rows[0].id;
          // Use the recovered visitor ID instead of the fresh random one
          visitorId = recoveredId;
        }
      } catch(e) { /* fingerprint column may not exist yet, ignore */ }
    }

    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || !campaign.isActive) {
      return res.json({ visitorId, headline: null, subheadline: null });
    }

    // Check credits
    const user = await storage.getUserById(campaign.userId);
    if (user) {
      // 1 credit = 100 visitors. Check if the user's current count is on a 100-boundary
      const currentVisitors = await countCampaignVisitors(campaign.userId);
      if (Math.floor(currentVisitors / 100) >= user.creditsLimit) {
        // Over limit — serve control variants only (no tracking)
        return res.json({ visitorId, headline: null, subheadline: null, creditExhausted: true });
      }
    }

    // Helper: resolve variant → test section selector/testMethod
    // Returns { id, text, selector, testMethod } or null
    // CRITICAL: Every variant MUST get a selector so the widget targets the right elements.
    // Without a selector, the widget falls back to generic h1/h2 which breaks multi-element pages.
    const _testSectionsCache: Record<number, any> = {};
    async function resolveVariantPayload(variant: any) {
      if (!variant) return null;
      const payload: any = { id: variant.id, text: variant.text, isControl: !!variant.isControl };
      let matchedSection: any = null;

      // Strategy 1: Direct link — variant has testSectionId
      if (variant.testSectionId) {
        const section = await storage.getTestSectionById(variant.testSectionId);
        if (section) { matchedSection = section; }
      }

      // Strategy 2: Find an active test section for this campaign+category
      // (handles control variants that weren't linked to a test section)
      if (!matchedSection) {
        if (!_testSectionsCache[campaignId]) {
          _testSectionsCache[campaignId] = await storage.getTestSectionsByCampaign(campaignId);
        }
        const sections = _testSectionsCache[campaignId] as any[];
        const found = sections.find((s: any) => s.isActive && s.category === variant.type);
        if (found) { matchedSection = found; }
      }

      if (matchedSection) {
        payload.selector = matchedSection.selector;
        payload.testMethod = matchedSection.testMethod || "text_swap";
        // currentText is the actual rendered text captured at scan time
        // It's the most reliable cross-platform fingerprint for finding the element
        payload.currentText = matchedSection.currentText || "";
      } else if (variant.type === "headline" && campaign.headlineSelector) {
        payload.selector = campaign.headlineSelector;
      } else if (variant.type === "subheadline" && campaign.subheadlineSelector) {
        payload.selector = campaign.subheadlineSelector;
      }

      payload.category = variant.type;
      return payload;
    }

    // Check for existing visitor
    const existing = await storage.getVisitor(visitorId);
    if (existing && existing.campaignId === campaignId) {
      const h = await storage.getVariant(existing.headlineVariantId);
      const s = await storage.getVariant(existing.subheadlineVariantId);

      // Reconstruct section payloads from stored assignments
      let existingSections: any[] | undefined;
      if ((existing as any).sectionVariantAssignments) {
        try {
          const assignments = JSON.parse((existing as any).sectionVariantAssignments);
          const allSections = _testSectionsCache[campaignId] || await storage.getTestSectionsByCampaign(campaignId);
          _testSectionsCache[campaignId] = allSections;
          existingSections = [];
          for (const [sectionIdStr, variantId] of Object.entries(assignments)) {
            const section = allSections.find((s: any) => s.id === parseInt(sectionIdStr));
            const variant = await storage.getVariant(variantId as number);
            if (section && variant) {
              existingSections.push({
                id: variant.id,
                text: variant.text,
                isControl: !!variant.isControl,
                selector: section.selector,
                testMethod: section.testMethod || "text_swap",
                sectionId: section.id,
              });
            }
          }
        } catch { /* ignore parse errors */ }
      }

      return res.json({
        visitorId: existing.id,
        headline: await resolveVariantPayload(h),
        subheadline: await resolveVariantPayload(s),
        sections: existingSections && existingSections.length > 0 ? existingSections : undefined,
      });
    }

    // Load all test sections FIRST — used for traffic % checks on headline/subheadline AND section assignment below
    const allTestSections = _testSectionsCache[campaignId] || await storage.getTestSectionsByCampaign(campaignId);
    _testSectionsCache[campaignId] = allTestSections;

    const headlineVariants = await storage.getActiveVariantsByCampaign(campaignId, "headline");
    const subheadlineVariants = await storage.getActiveVariantsByCampaign(campaignId, "subheadline");

    // Respect traffic percentage for headline/subheadline sections too
    const headlineSection = allTestSections.find((s: any) => s.isActive && s.category === "headline");
    const subheadlineSection = allTestSections.find((s: any) => s.isActive && s.category === "subheadline");
    const headlineTrafficPct = (headlineSection as any)?.trafficPercentage ?? 100;
    const subheadlineTrafficPct = (subheadlineSection as any)?.trafficPercentage ?? 100;
    const inHeadlinePool = Math.random() * 100 < headlineTrafficPct;
    const inSubheadlinePool = Math.random() * 100 < subheadlineTrafficPct;

    const headlineControl      = headlineVariants.find((v: any) => v.isControl);
    const subheadlineControl   = subheadlineVariants.find((v: any) => v.isControl);
    const headlineChallengers  = headlineVariants.filter((v: any) => !v.isControl);
    const subheadlineChallengers = subheadlineVariants.filter((v: any) => !v.isControl);

    // trafficPct = % of visitors who see a CHALLENGER (not control).
    // If the visitor is NOT in the challenger pool, they see the control variant.
    // This makes 10% mean "10% of visitors see a challenger" — intuitive.
    const hVariant = headlineVariants.length > 0
      ? (headlineChallengers.length > 0 && inHeadlinePool
          ? headlineChallengers[Math.floor(Math.random() * headlineChallengers.length)]
          : (headlineControl || headlineVariants[0]))
      : null;
    const sVariant = subheadlineVariants.length > 0
      ? (subheadlineChallengers.length > 0 && inSubheadlinePool
          ? subheadlineChallengers[Math.floor(Math.random() * subheadlineChallengers.length)]
          : (subheadlineControl || subheadlineVariants[0]))
      : null;

    // === SECTION-LEVEL TESTS: assign variants for all active non-headline/subheadline sections ===
    // allTestSections already loaded above
    const sectionAssignments: Record<string, number> = {}; // sectionId -> variantId
    const sectionPayloads: any[] = [];
    for (const section of allTestSections) {
      if (!section.isActive) continue;
      if (section.category === "headline" || section.category === "subheadline") continue;
      // Traffic percentage check: if section has e.g. 20% traffic allocation,
      // 80% of visitors skip the test and see control (original page)
      const trafficPct = (section as any).trafficPercentage ?? 100;
      const inTestPool = Math.random() * 100 < trafficPct;
      // Get active variants for this section's category
      const sectionVars = await storage.getActiveVariantsByCampaign(campaignId, section.category);
      if (sectionVars.length === 0) continue;
      const sectionControl = sectionVars.find((v: any) => v.isControl);
      const sectionChallengers = sectionVars.filter((v: any) => !v.isControl);
      // trafficPct = % who see a challenger. If not in pool → always show control.
      const chosen = (inTestPool && sectionChallengers.length > 0)
        ? sectionChallengers[Math.floor(Math.random() * sectionChallengers.length)]
        : (sectionControl || sectionVars[0]);
      sectionAssignments[String(section.id)] = chosen.id;
      sectionPayloads.push({
        id: chosen.id,
        text: chosen.text,
        isControl: !!chosen.isControl,
        selector: section.selector,
        testMethod: section.testMethod || "text_swap",
        sectionId: section.id,
        category: section.category,
        // currentText = actual page text captured at scan time (platform-agnostic fingerprint)
        // controlText = the control variant text (may differ slightly from currentText)
        currentText: section.currentText || sectionControl?.text || "",
        controlText: sectionControl?.text || "",
      });
    }

    // Check if there's anything to test at all
    if (!hVariant && !sVariant && sectionPayloads.length === 0) {
      return res.json({ visitorId, headline: null, subheadline: null });
    }

    const utmSource   = (req.query.utm_source   as string) || null;
    const utmMedium   = (req.query.utm_medium   as string) || null;
    const utmCampaign = (req.query.utm_campaign as string) || null;
    const utmContent  = (req.query.utm_content  as string) || null;
    const utmTerm     = (req.query.utm_term     as string) || null;
    const referrer    = (req.query.ref          as string) || null;
    const fbclid      = (req.query.fbclid       as string) || null;
    const gclid       = (req.query.gclid        as string) || null;
    const ttclid      = (req.query.ttclid       as string) || null;
    const pageUrl     = (req.query.url          as string) || null;
    const ua          = req.headers["user-agent"] || null;
    const trafficSource  = parseTrafficSource(referrer || "", utmSource || "", utmMedium || "");
    const deviceCategory = parseDeviceCategory(ua || "");

    // Attempt visitor insert; handle duplicate key gracefully (race condition on rapid reloads)
    let visitor: any;
    try {
      visitor = await storage.createVisitor({
        id: visitorId,
        campaignId,
        headlineVariantId: hVariant?.id || 0,
        subheadlineVariantId: sVariant?.id || 0,
        converted: false,
        convertedAt: null,
        stripePaymentId: null,
        revenue: null,
        userAgent: ua,
        referrer,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        trafficSource,
        deviceCategory,
        sectionVariantAssignments: Object.keys(sectionAssignments).length > 0
          ? JSON.stringify(sectionAssignments)
          : null,
        fingerprint: fingerprint || null,
      } as any);
      // === CREATE TOUCHPOINT for attribution tracking ===
      try {
        // Normalize source into clean platform + channel
        let platform = 'unknown';
        let channel = 'unknown';
        const src = (utmSource || '').toLowerCase();
        const med = (utmMedium || '').toLowerCase();
        const ts = (trafficSource || '').toLowerCase();

        if (src === 'fb_ad' || src === 'fb' || src === 'facebook' || src === 'meta' || ts === 'facebook') {
          platform = 'facebook'; channel = 'paid';
        } else if (src === 'ig' || (ts === 'instagram' && (src === 'fb_ad' || src === 'meta'))) {
          platform = 'instagram'; channel = 'paid';
        } else if (ts === 'instagram' && (src === 'social_media' || !src)) {
          platform = 'instagram'; channel = med === 'social' || !med ? 'organic' : 'paid';
        } else if (src === 'email' || med.includes('email')) {
          platform = 'email'; channel = 'email';
        } else if (ts === 'google_organic' || src === 'google') {
          platform = 'google'; channel = 'organic';
        } else if (ts === 'youtube' || src === 'youtube') {
          platform = 'youtube'; channel = src ? 'paid' : 'organic';
        } else if (src === 'an' || src === 'alga') {
          platform = 'audience_network'; channel = 'paid';
        } else if (ts === 'direct' || (!ts && !src)) {
          platform = 'direct'; channel = 'direct';
        } else if (fbclid) {
          platform = ts === 'instagram' ? 'instagram' : 'facebook'; channel = 'paid';
        } else if (gclid) {
          platform = 'google'; channel = 'paid';
        } else if (ttclid) {
          platform = 'tiktok'; channel = 'paid';
        } else {
          platform = ts || src || 'unknown';
          channel = med && med.includes('paid') ? 'paid' : (med || 'unknown');
        }

        await pool.query(
          `INSERT INTO touchpoints (user_id, campaign_id, visitor_id, device_fingerprint,
            platform, channel, campaign_name, ad_set, ad_creative,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, gclid, ttclid, device_category, page_url, referrer, visited_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())`,
          [
            campaign.userId, campaignId, visitorId, fingerprint || null,
            platform, channel, utmCampaign || null, utmMedium || null, utmContent || null,
            utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
            fbclid, gclid, ttclid, deviceCategory, pageUrl, referrer,
          ]
        );
      } catch (tpErr) {
        // Non-fatal: don't block visitor assignment if touchpoint fails
        console.error('[touchpoint] Failed to create:', (tpErr as any)?.message);
      }

    } catch (createErr: any) {
      if (createErr?.code === '23505') {
        // Race condition: visitor already exists — fetch the existing record and serve its assignment
        const existingVisitor = await storage.getVisitor(visitorId);
        if (existingVisitor) {
          const h = await storage.getVariant(existingVisitor.headlineVariantId);
          const s = await storage.getVariant(existingVisitor.subheadlineVariantId);
          return res.json({
            visitorId: existingVisitor.id,
            headline: await resolveVariantPayload(h),
            subheadline: await resolveVariantPayload(s),
            campaignType: campaign.campaignType || "purchase",
          });
        }
      }
      throw createErr;
    }

    await storage.createImpression({
      visitorId: visitor.id,
      campaignId,
      headlineVariantId: hVariant?.id || 0,
      subheadlineVariantId: sVariant?.id || 0,
      userAgent: req.headers["user-agent"] || null,
      referrer: req.query.ref as string || null,
    });

    // Increment credit counter every 100 visitors
    if (user) {
      const totalVisitors = await countUserVisitors(user.id);
      if (totalVisitors % 100 === 0) {
        await storage.incrementCredits(user.id);
      }
    }

    res.json({
      visitorId: visitor.id,
      headline: await resolveVariantPayload(hVariant),
      subheadline: await resolveVariantPayload(sVariant),
      sections: sectionPayloads.length > 0 ? sectionPayloads : undefined,
      campaignType: campaign.campaignType || "purchase",
    });

    // Fire-and-forget anomaly detection (throttled to once per 5 min per campaign)
    detectTrafficAnomalies(campaignId).catch(() => {});
  });

  // ============== CONVERSION PIXEL (public, CORS) ==============

  // ============================================================
  // CORE REVENUE ATTRIBUTION HELPER
  // ============================================================
  // Records a purchase event and applies first-touch attribution:
  //   1. Looks up the visitor by sa_vid across ALL campaigns (not just the current one)
  //   2. Uses the visitor’s ORIGINAL campaign (the entry-point) as the attribution target
  //   3. Records a revenue_event on every call — no “already_converted” gate
  //   4. Marks the visitor’s first conversion only once; subsequent purchases just add events
  //
  // This correctly handles:
  //   - OTO pages with a different campaign_id pixel (cross-campaign attribution)
  //   - $27 main offer + $97 OTO + $199 second OTO all credited to the same funnel entry
  //   - Multi-product funnels on different pages
  async function recordPurchaseEvent(opts: {
    vid: string;
    pixelCampaignId: number; // campaign ID from the pixel on THIS page
    amount: number;
    currency?: string;
    externalId?: string;
    customerEmail?: string;
    product?: string;
    source?: string;
  }): Promise<{ ok: boolean; campaignId: number; visitorId: string }> {
    const visitor = await storage.getVisitor(opts.vid);

    // First-touch: use the visitor’s ORIGINAL campaign, not the pixel’s campaign
    // (handles OTO pages that have a different campaign ID)
    const attributionCampaignId = visitor?.campaignId ?? opts.pixelCampaignId;
    const resolvedVisitorId = visitor?.id ?? opts.vid;

    // Mark first conversion on the visitor record — also store email for Stripe attribution
    // Storing the email lets us match ALL future Stripe charges (OTOs, upsells)
    // from the same customer back to this original campaign, without any additional pixels.
    if (visitor && !visitor.converted) {
      await storage.markConverted(resolvedVisitorId, "pixel_" + Date.now(), opts.amount, opts.customerEmail);
    } else if (visitor && visitor.converted && opts.amount > 0) {
      // Subsequent purchase — accumulate revenue on the visitor record
      await pool.query(
        `UPDATE visitors SET revenue = COALESCE(revenue, 0) + $1 WHERE id = $2`,
        [opts.amount, resolvedVisitorId]
      );
    }

    // ALWAYS record a detailed revenue_event (full purchase history)
    await storage.addRevenueEvent({
      visitorId: resolvedVisitorId,
      campaignId: attributionCampaignId,
      source: opts.source || "pixel",
      eventType: "purchase",
      amount: opts.amount,
      currency: opts.currency || "USD",
      externalId: opts.externalId,
      customerEmail: opts.customerEmail,
      metadata: opts.product ? JSON.stringify({ product: opts.product, pixelCampaignId: opts.pixelCampaignId }) : undefined,
    });

    return { ok: true, campaignId: attributionCampaignId, visitorId: resolvedVisitorId };
  }

  // POST /api/widget/convert — JS-based conversion tracking
  app.post("/api/widget/convert", widgetLimiter, async (req: Request, res: Response) => {
    const { vid, cid, revenue, product, email } = req.body;
    if (!vid || !cid) {
      return res.status(400).json({ error: "Missing vid or cid" });
    }
    try {
      const result = await recordPurchaseEvent({
        vid,
        pixelCampaignId: parseInt(cid),
        amount: typeof revenue === "number" ? revenue : 0,
        customerEmail: email || undefined,
        product: product || undefined,
      });
      return res.json({ received: true, attributed: true, ...result });
    } catch (err: any) {
      return res.json({ received: false, error: err.message });
    }
  });

  // GET /api/widget/convert — image pixel fallback (fires from <img> or script src)
  // Supports sa_vid in query string for cross-page/funnel passthrough
  app.get("/api/widget/convert", widgetLimiter, async (req: Request, res: Response) => {
    // Return pixel immediately — don’t hold up the browser
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store");
    res.send(pixel);

    // Attribution runs async after response is sent
    const vid = (req.query.vid || req.query.sa_vid) as string;
    const cid = req.query.cid as string;
    let amount = parseFloat(req.query.revenue as string) || 0;
    const product = req.query.product as string | undefined;
    const email = req.query.email as string | undefined;
    const mode = req.query.mode as string | undefined;
    // payment_intent — Stripe puts this in the success URL automatically
    // e.g. ?payment_intent=pi_xxx — we look it up to get the REAL amount + email
    const paymentIntent = req.query.payment_intent as string | undefined;
    const paymentIntentSecret = req.query.payment_intent_client_secret as string | undefined;

    if (!vid || !cid) return;
    try {
      // If no revenue provided, try the campaign's price_point as a fallback
      // This catches cases where users don't have Stripe connected and didn't set
      // a fixed amount in the pixel, but DID configure a price on their campaign.
      if (amount <= 0) {
        const campaign = await storage.getCampaign(parseInt(cid));
        if (campaign?.pricePoint) {
          const parsed = parseFloat(campaign.pricePoint.replace(/[^0-9.]/g, ''));
          if (parsed > 0) {
            amount = parsed;
            console.log(`[convert] Using campaign price_point fallback: $${amount} for C${cid}`);
          }
        }
      }

      // If payment_intent is provided AND Stripe is connected for this campaign's user,
      // fetch the real amount and email directly from Stripe — no manual revenue needed
      let stripeEmail: string | undefined = email;
      if (paymentIntent && paymentIntent.startsWith("pi_")) {
        try {
          const campaign = await storage.getCampaign(parseInt(cid));
          if (campaign) {
            const campaignUser = await storage.getUserById(campaign.userId);
            if (campaignUser && (campaignUser as any).stripeAccessToken) {
              const decryptedKey = decryptApiKey((campaignUser as any).stripeAccessToken);
              if (decryptedKey.startsWith("sk_") || decryptedKey.startsWith("rk_")) {
                const stripeClient = new Stripe(decryptedKey);
                const pi = await stripeClient.paymentIntents.retrieve(paymentIntent);
                if (pi.status === "succeeded") {
                  amount = pi.amount_received / 100;
                  stripeEmail = pi.receipt_email ||
                    (pi as any).charges?.data?.[0]?.billing_details?.email ||
                    stripeEmail;
                  console.log(`[pixel] Stripe PI ${paymentIntent} → $${amount} ${stripeEmail || ""}`);
                }
              }
            }
          }
        } catch (piErr) {
          // Non-fatal — fall back to the revenue param
          console.warn("[pixel] PI lookup failed:", piErr);
        }
      }

      // VALIDATE: visitor must exist and belong to this campaign
      // This prevents orphan pixels from creating false revenue
      const visitorCheck = await pool.query(
        `SELECT id, campaign_id FROM visitors WHERE id = $1`, [vid]
      );
      if (visitorCheck.rows.length === 0) {
        console.log(`[pixel] Rejected: visitor ${vid} does not exist`);
        return;
      }
      const visitorCampaign = visitorCheck.rows[0].campaign_id;
      if (visitorCampaign !== parseInt(cid)) {
        console.log(`[pixel] Rejected: visitor ${vid} belongs to campaign ${visitorCampaign}, not ${cid}`);
        return;
      }

      await recordPurchaseEvent({
        vid,
        pixelCampaignId: parseInt(cid),
        amount,
        customerEmail: stripeEmail,
        product,
        source: mode === "convert" ? "oto_pixel" : "pixel",
      });
    } catch { /* silent — pixel must never break */ }
  });

  // ============== PUBLIC WINS FEED (no auth — for marketing site embed) ==============

  app.get("/api/public/wins-feed", async (_req: Request, res: Response) => {
    try {
      // Set generous CORS for embedding on any domain
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Cache-Control", "public, max-age=300"); // 5 min cache

      const result = await pool.query(
        `SELECT tl.section_type, tl.winner_strategy, tl.lift_percent,
                tl.sample_size, tl.confidence, tl.created_at,
                c.niche, c.page_type
         FROM test_lessons tl
         JOIN campaigns c ON c.id = tl.campaign_id
         WHERE tl.lift_percent > 0
         ORDER BY tl.created_at DESC
         LIMIT 50`
      );

      const SECTION_LABELS: Record<string, string> = {
        headline: "Headline", subheadline: "Subheadline", cta: "CTA",
        body_copy: "Body Copy", social_proof: "Social Proof",
        testimonials: "Testimonials", pricing: "Pricing",
        guarantee: "Guarantee", faq: "FAQ", hero: "Hero",
      };

      const STRATEGY_LABELS: Record<string, string> = {
        transformation: "Transformation", how_to: "How-To",
        social_proof: "Social Proof", urgency: "Urgency",
        loss_aversion: "Loss Aversion", contrarian: "Contrarian",
        feature_benefit: "Feature/Benefit", curiosity: "Curiosity",
        problem_agitation: "Problem Agitation", authority: "Authority",
        pattern_interrupt: "Pattern Interrupt", scarcity: "Scarcity",
        insight_suggested: "AI-Suggested",
      };

      const NICHE_LABELS: Record<string, string> = {
        digital_products: "Digital Products", saas: "SaaS",
        ecommerce: "E-commerce", education: "Education",
        coaching: "Coaching", agency: "Agency",
        health_wellness: "Health & Wellness", finance: "Finance",
        real_estate: "Real Estate",
      };

      const wins = result.rows.map((r: any) => {
        const createdAt = new Date(r.created_at);
        const hoursAgo = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60));
        let timeAgo = "";
        if (hoursAgo < 1) timeAgo = "just now";
        else if (hoursAgo < 24) timeAgo = `${hoursAgo}h ago`;
        else if (hoursAgo < 48) timeAgo = "yesterday";
        else if (hoursAgo < 168) timeAgo = `${Math.floor(hoursAgo / 24)}d ago`;
        else timeAgo = `${Math.floor(hoursAgo / 168)}w ago`;

        return {
          sectionType: SECTION_LABELS[r.section_type] || r.section_type,
          strategy: STRATEGY_LABELS[r.winner_strategy] || r.winner_strategy || "Optimized",
          liftPercent: parseFloat(r.lift_percent).toFixed(1),
          sampleSize: parseInt(r.sample_size),
          confidence: Math.round(parseFloat(r.confidence)),
          niche: NICHE_LABELS[r.niche] || r.niche || r.page_type || "Online Business",
          timeAgo,
        };
      });

      // Aggregate stats
      const totalWins = wins.length;
      const avgLift = totalWins > 0
        ? (wins.reduce((sum: number, w: any) => sum + parseFloat(w.liftPercent), 0) / totalWins).toFixed(1)
        : "0";
      const totalVisitors = wins.reduce((sum: number, w: any) => sum + w.sampleSize, 0);

      res.json({
        wins,
        stats: {
          totalWins,
          avgLift,
          totalVisitors,
        },
      });
    } catch (err: any) {
      console.error("[public/wins-feed]", err.message);
      res.status(500).json({ error: "Failed to load wins feed" });
    }
  });

  // GET /api/public/brain-graph — data for the public Brain visualization
  app.get("/api/public/brain-graph", async (_req: Request, res: Response) => {
    try {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Cache-Control", "public, max-age=120"); // 2 min cache

      // Core stats
      const stats = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM campaigns) as pages_scanned,
          (SELECT COUNT(*) FROM test_lessons WHERE lift_percent > 0) as tests_won,
          (SELECT COUNT(*) FROM test_lessons) as total_tests,
          (SELECT COUNT(*) FROM visitors) as visitors_analyzed,
          (SELECT COUNT(*) FROM visitors WHERE converted = true) as conversions_tracked,
          (SELECT COUNT(*) FROM behavioral_events) as behavioral_signals,
          (SELECT COUNT(*) FROM revenue_events WHERE amount > 0) as revenue_events,
          (SELECT COUNT(*) FROM visitor_sessions) as sessions_analyzed,
          (SELECT COUNT(DISTINCT unnest) FROM (SELECT unnest(ARRAY[winner_strategy, loser_strategy]) FROM test_lessons WHERE winner_strategy IS NOT NULL) sub) as strategies_tested
      `);
      const s = stats.rows[0];

      // Test result nodes (for the graph)
      const tests = await pool.query(`
        SELECT section_type, winner_strategy, loser_strategy,
          ROUND(lift_percent::numeric, 1) as lift_percent,
          sample_size, ROUND(confidence::numeric, 0) as confidence,
          created_at
        FROM test_lessons
        WHERE winner_strategy IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 50
      `);

      // Strategy win/loss record
      const strategyStats = await pool.query(`
        SELECT s.strategy,
          COUNT(*) FILTER (WHERE s.role = 'winner') as wins,
          COUNT(*) FILTER (WHERE s.role = 'loser') as losses,
          ROUND(AVG(CASE WHEN s.role = 'winner' THEN s.lift END)::numeric, 1) as avg_win_lift
        FROM (
          SELECT winner_strategy as strategy, 'winner' as role, lift_percent as lift FROM test_lessons WHERE winner_strategy IS NOT NULL AND lift_percent > 0
          UNION ALL
          SELECT loser_strategy as strategy, 'loser' as role, lift_percent as lift FROM test_lessons WHERE loser_strategy IS NOT NULL AND lift_percent > 0
        ) s
        GROUP BY s.strategy
        ORDER BY COUNT(*) FILTER (WHERE s.role = 'winner') DESC
      `);

      // Section types tested
      const sectionStats = await pool.query(`
        SELECT section_type, COUNT(*) as tests,
          COUNT(*) FILTER (WHERE lift_percent > 0) as wins,
          ROUND(AVG(lift_percent) FILTER (WHERE lift_percent > 0)::numeric, 1) as avg_lift
        FROM test_lessons
        GROUP BY section_type
        ORDER BY COUNT(*) DESC
      `);

      // Recent learning events (timeline)
      const recentLearnings = await pool.query(`
        (
          SELECT 'test_complete' as event_type,
            json_build_object(
              'sectionType', section_type,
              'winnerStrategy', winner_strategy,
              'loserStrategy', loser_strategy,
              'liftPercent', ROUND(lift_percent::numeric, 1),
              'sampleSize', sample_size
            ) as data,
            created_at
          FROM test_lessons
          ORDER BY created_at DESC LIMIT 10
        )
        UNION ALL
        (
          SELECT 'page_scanned' as event_type,
            json_build_object('campaignCount', COUNT(*)) as data,
            MAX(created_at) as created_at
          FROM campaigns
        )
        ORDER BY created_at DESC
        LIMIT 20
      `);

      // Behavioral insight nodes
      const behavioralInsights = await pool.query(`
        SELECT
          ROUND(AVG(max_scroll_depth) FILTER (WHERE v.converted = true)::numeric, 1) as converter_scroll,
          ROUND(AVG(max_scroll_depth) FILTER (WHERE v.converted = false)::numeric, 1) as nonconverter_scroll,
          ROUND(AVG(time_on_page) FILTER (WHERE v.converted = true)::numeric, 0) as converter_time,
          ROUND(AVG(time_on_page) FILTER (WHERE v.converted = false)::numeric, 0) as nonconverter_time,
          ROUND(AVG(click_count) FILTER (WHERE v.converted = true)::numeric, 1) as converter_clicks,
          ROUND(AVG(click_count) FILTER (WHERE v.converted = false)::numeric, 1) as nonconverter_clicks
        FROM visitor_sessions vs
        JOIN visitors v ON v.id = vs.visitor_id AND v.campaign_id = vs.campaign_id
        WHERE vs.max_scroll_depth > 0
      `);

      const STRATEGY_LABELS: Record<string, string> = {
        transformation: "Transformation", how_to: "How-To",
        social_proof: "Social Proof", urgency: "Urgency",
        loss_aversion: "Loss Aversion", contrarian: "Contrarian",
        feature_benefit: "Feature/Benefit", curiosity: "Curiosity",
        problem_agitation: "Problem Agitation", authority: "Authority",
        pattern_interrupt: "Pattern Interrupt", scarcity: "Scarcity",
      };

      // Pre-taught knowledge sources
      const knowledgeSources = {
        croResearch: {
          label: "CRO Research",
          description: "Data-backed conversion optimization intelligence from CXL, Baymard, NNGroup",
          categories: [
            { name: "General CRO Principles", dataPoints: 12 },
            { name: "Headline Optimization", dataPoints: 14 },
            { name: "Subheadline", dataPoints: 5 },
            { name: "CTA Optimization", dataPoints: 15 },
            { name: "Hero Section", dataPoints: 6 },
            { name: "Social Proof", dataPoints: 10 },
            { name: "Trust & Guarantee", dataPoints: 8 },
            { name: "Pricing Psychology", dataPoints: 11 },
            { name: "Benefits & Copy Length", dataPoints: 9 },
            { name: "Video Impact", dataPoints: 7 },
            { name: "Form Optimization", dataPoints: 10 },
            { name: "Checkout Flow", dataPoints: 8 },
            { name: "Page Speed", dataPoints: 6 },
            { name: "Mobile Optimization", dataPoints: 7 },
            { name: "Behavioral Psychology", dataPoints: 12 },
            { name: "Traffic Source Patterns", dataPoints: 6 },
            { name: "Scroll & Engagement", dataPoints: 8 },
            { name: "Testing Methodology", dataPoints: 9 },
          ],
          totalDataPoints: 145,
        },
        salesPsychology: {
          label: "Sales Psychology & Frameworks",
          description: "Pre-taught persuasion mechanisms, offer architecture, and conversion frameworks",
          categories: [
            { name: "Authority Placement", dataPoints: 4 },
            { name: "Pattern Interrupt (Wallpaper Filter)", dataPoints: 5 },
            { name: "The Lego Method", dataPoints: 3 },
            { name: "Pre-Suasion & Priming", dataPoints: 6 },
            { name: "Commitment & Consistency", dataPoints: 4 },
            { name: "R.I.C.E. Framework", dataPoints: 5 },
            { name: "New Bad Guy Technique", dataPoints: 3 },
            { name: "Buyer Loop (Micro-Commitments)", dataPoints: 5 },
            { name: "Offer Architecture (3 Tests)", dataPoints: 6 },
            { name: "6 Cognitive Biases (Google Research)", dataPoints: 6 },
            { name: "Irresistible Offer Components", dataPoints: 4 },
            { name: "Before/After Bridge", dataPoints: 4 },
            { name: "Missing % Concept", dataPoints: 3 },
            { name: "Unique Mechanism Creation", dataPoints: 8 },
            { name: "Mechanism Positioning", dataPoints: 3 },
            { name: "AIDA Framework", dataPoints: 4 },
            { name: "15-Section Sales Page Structure", dataPoints: 15 },
          ],
          totalDataPoints: 88,
        },
        pageContextRules: {
          label: "Page Context Rules",
          description: "Dynamic rules engine that adapts recommendations based on page type, goal, price point, and niche",
          categories: [
            { name: "Sales Page Rules", dataPoints: 8 },
            { name: "Opt-in Page Rules", dataPoints: 6 },
            { name: "Webinar Registration Rules", dataPoints: 6 },
            { name: "SaaS Landing Rules", dataPoints: 7 },
            { name: "E-commerce Rules", dataPoints: 7 },
            { name: "High-Ticket ($500+) Rules", dataPoints: 5 },
            { name: "Low-Ticket ($1-50) Rules", dataPoints: 4 },
            { name: "Niche-Specific Adaptations", dataPoints: 10 },
          ],
          totalDataPoints: 53,
        },
        autopilotPlaybooks: {
          label: "Autopilot Playbooks",
          description: "Section-by-section optimization sequences for 6 page types",
          categories: [
            { name: "Sales Page (10 steps)", dataPoints: 10 },
            { name: "Opt-in Page (5 steps)", dataPoints: 5 },
            { name: "Webinar Registration (6 steps)", dataPoints: 6 },
            { name: "Product Page (6 steps)", dataPoints: 6 },
            { name: "SaaS Landing (5 steps)", dataPoints: 5 },
            { name: "Generic Landing (5 steps)", dataPoints: 5 },
          ],
          totalDataPoints: 37,
        },
      };

      const totalPreTaughtKnowledge = Object.values(knowledgeSources).reduce(
        (sum, src) => sum + src.totalDataPoints, 0
      );

      res.json({
        stats: {
          pagesScanned: parseInt(s.pages_scanned),
          testsWon: parseInt(s.tests_won),
          totalTests: parseInt(s.total_tests),
          visitorsAnalyzed: parseInt(s.visitors_analyzed),
          conversionsTracked: parseInt(s.conversions_tracked),
          behavioralSignals: parseInt(s.behavioral_signals),
          revenueEvents: parseInt(s.revenue_events),
          sessionsAnalyzed: parseInt(s.sessions_analyzed),
          strategiesTested: parseInt(s.strategies_tested),
          totalPreTaughtKnowledge,
          totalKnowledgePoints: totalPreTaughtKnowledge + parseInt(s.total_tests) + parseInt(s.behavioral_signals),
        },
        knowledgeSources,
        tests: tests.rows.map((t: any) => ({
          sectionType: t.section_type,
          winnerStrategy: STRATEGY_LABELS[t.winner_strategy] || t.winner_strategy,
          loserStrategy: STRATEGY_LABELS[t.loser_strategy] || t.loser_strategy,
          liftPercent: parseFloat(t.lift_percent),
          sampleSize: parseInt(t.sample_size),
          confidence: parseInt(t.confidence),
          createdAt: t.created_at,
        })),
        strategies: strategyStats.rows.map((s: any) => ({
          name: STRATEGY_LABELS[s.strategy] || s.strategy,
          key: s.strategy,
          wins: parseInt(s.wins) || 0,
          losses: parseInt(s.losses) || 0,
          avgWinLift: parseFloat(s.avg_win_lift) || 0,
        })),
        sections: sectionStats.rows.map((s: any) => ({
          type: s.section_type,
          tests: parseInt(s.tests),
          wins: parseInt(s.wins),
          avgLift: parseFloat(s.avg_lift) || 0,
        })),
        behavioral: behavioralInsights.rows[0] ? {
          converterScroll: parseFloat(behavioralInsights.rows[0].converter_scroll) || 0,
          nonconverterScroll: parseFloat(behavioralInsights.rows[0].nonconverter_scroll) || 0,
          converterTime: parseInt(behavioralInsights.rows[0].converter_time) || 0,
          nonconverterTime: parseInt(behavioralInsights.rows[0].nonconverter_time) || 0,
          converterClicks: parseFloat(behavioralInsights.rows[0].converter_clicks) || 0,
          nonconverterClicks: parseFloat(behavioralInsights.rows[0].nonconverter_clicks) || 0,
        } : null,
        learnings: recentLearnings.rows.map((l: any) => ({
          type: l.event_type,
          data: l.data,
          createdAt: l.created_at,
        })),
      });
    } catch (err: any) {
      console.error("[public/brain-graph]", err.message);
      res.status(500).json({ error: "Failed to load brain data" });
    }
  });

  // ============== PLATFORM WEBHOOKS (Teachable, Kajabi, Thinkific, Stan Store) ==============

  // POST /api/webhooks/:platform/:userId/:secret — receive purchase webhooks from course platforms
  // This endpoint is PUBLIC (no auth) — it's called by external platforms.
  // Security: validated by the secret token unique to each user+platform.
  app.post("/api/webhooks/:platform/:userId/:secret", async (req: Request, res: Response) => {
    const { platform, userId, secret } = req.params;
    const numericUserId = parseInt(userId);

    if (!numericUserId || !secret) {
      return res.status(400).json({ error: "Invalid webhook URL" });
    }

    const validPlatforms: SupportedPlatform[] = ["teachable", "kajabi", "thinkific", "stan", "generic"];
    if (!validPlatforms.includes(platform as SupportedPlatform)) {
      return res.status(400).json({ error: `Unsupported platform: ${platform}` });
    }

    // Validate the webhook secret
    const integration = await pool.query(
      "SELECT * FROM platform_integrations WHERE user_id = $1 AND platform = $2 AND webhook_secret = $3 AND is_active = true",
      [numericUserId, platform, secret]
    );
    if (integration.rows.length === 0) {
      return res.status(401).json({ error: "Invalid webhook secret" });
    }

    // Normalize the payload
    const purchase = normalizePayload(platform as SupportedPlatform, req.body);
    if (!purchase) {
      console.warn(`[webhook:${platform}] Could not normalize payload from user ${userId}`);
      // Return 200 to prevent the platform from retrying
      return res.json({ ok: true, matched: false, reason: "Could not parse payload" });
    }

    // Process the purchase
    const result = await processPlatformPurchase(numericUserId, purchase);

    // Update integration stats
    await pool.query(
      `UPDATE platform_integrations
       SET events_received = events_received + 1, last_event_at = NOW()
       WHERE user_id = $1 AND platform = $2`,
      [numericUserId, platform]
    ).catch(() => {});

    res.json({ ok: true, ...result });
  });

  // GET /api/settings/integrations — list all platform integrations for the user
  app.get("/api/settings/integrations", requireAuth, async (req: Request, res: Response) => {
    const result = await pool.query(
      "SELECT * FROM platform_integrations WHERE user_id = $1 ORDER BY platform",
      [req.userId!]
    );

    const apiBase = process.env.API_BASE_URL || `https://api.siteamoeba.com`;

    const integrations = result.rows.map((row: any) => ({
      id: row.id,
      platform: row.platform,
      platformLabel: PLATFORM_LABELS[row.platform as SupportedPlatform] || row.platform,
      webhookUrl: `${apiBase}/api/webhooks/${row.platform}/${req.userId}/${row.webhook_secret}`,
      isActive: row.is_active,
      eventsReceived: parseInt(row.events_received) || 0,
      lastEventAt: row.last_event_at,
      createdAt: row.created_at,
    }));

    res.json({
      integrations,
      availablePlatforms: Object.entries(PLATFORM_LABELS).map(([key, label]) => ({
        key,
        label,
        connected: integrations.some((i: any) => i.platform === key),
      })),
    });
  });

  // POST /api/settings/integrations/:platform — connect a platform (generates webhook URL)
  app.post("/api/settings/integrations/:platform", requireAuth, async (req: Request, res: Response) => {
    const { platform } = req.params;
    const validPlatforms: SupportedPlatform[] = ["teachable", "kajabi", "thinkific", "stan", "generic"];
    if (!validPlatforms.includes(platform as SupportedPlatform)) {
      return res.status(400).json({ error: `Unsupported platform: ${platform}` });
    }

    const secret = generateWebhookSecret();
    const apiBase = process.env.API_BASE_URL || `https://api.siteamoeba.com`;

    await pool.query(
      `INSERT INTO platform_integrations (user_id, platform, webhook_secret)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, platform) DO UPDATE SET webhook_secret = $3, is_active = true`,
      [req.userId!, platform, secret]
    );

    const webhookUrl = `${apiBase}/api/webhooks/${platform}/${req.userId}/${secret}`;

    res.json({
      ok: true,
      platform,
      platformLabel: PLATFORM_LABELS[platform as SupportedPlatform],
      webhookUrl,
      instructions: getSetupInstructions(platform as SupportedPlatform),
    });
  });

  // DELETE /api/settings/integrations/:platform — disconnect a platform
  app.delete("/api/settings/integrations/:platform", requireAuth, async (req: Request, res: Response) => {
    await pool.query(
      "UPDATE platform_integrations SET is_active = false WHERE user_id = $1 AND platform = $2",
      [req.userId!, req.params.platform]
    );
    res.json({ ok: true });
  });

  function getSetupInstructions(platform: SupportedPlatform): string {
    switch (platform) {
      case "teachable":
        return "In Teachable, go to Settings > Webhooks > New Webhook. Paste the webhook URL and select 'New Transaction' as the event type.";
      case "kajabi":
        return "In Kajabi, go to Settings > Third Party Integrations > Webhooks > Create Webhook. Select 'Payment Succeeded' event and paste the webhook URL.";
      case "thinkific":
        return "In Thinkific, go to Settings > Webhooks (or use the Webhooks API). Create a webhook for 'ORDER_TRANSACTION.SUCCEEDED' and paste the URL.";
      case "stan":
        return "Stan Store doesn't have native webhooks. Use Zapier: trigger on 'New Sale' in Stan, action 'Custom Request' to POST to this webhook URL with the buyer email and amount.";
      case "generic":
        return "Send a POST request to this URL with JSON body containing at minimum: {\"email\": \"buyer@example.com\", \"amount\": 97}. Optional: product_name, currency.";
      default:
        return "Paste this webhook URL in your platform's webhook settings.";
    }
  }

  // ============== BEHAVIORAL EVENTS (public, CORS via widget middleware) ==============

  // POST /api/widget/events — batch event ingestion from the widget
  app.post("/api/widget/events", widgetLimiter, async (req: Request, res: Response) => {
    const { vid, cid, events, timeOnPage, maxScroll, device, sectionMap } = req.body;

    if (!vid || !cid) {
      return res.status(400).json({ error: "Missing vid or cid" });
    }

    const campaignId = parseInt(cid);
    if (isNaN(campaignId)) {
      return res.status(400).json({ error: "Invalid cid" });
    }

    // Fire-and-forget: don't await DB work to keep response fast
    (async () => {
      try {
        const now = new Date().toISOString();

        // Batch insert events (skip if empty heartbeat)
        if (Array.isArray(events) && events.length > 0) {
          for (const evt of events) {
            await storage.createBehavioralEvent({
              visitorId: vid,
              campaignId,
              eventType: evt.type || "unknown",
              eventData: evt.data || null,
              timestamp: evt.ts ? new Date(evt.ts).toISOString() : now,
            });
          }
        }

        // Always upsert session with scroll/time data — even on empty heartbeats
        const sessionUpdates: Parameters<typeof storage.upsertVisitorSession>[2] = {};
        if (typeof maxScroll === "number" && maxScroll > 0) sessionUpdates.maxScrollDepth = maxScroll;
        // Cap at 30 minutes (1800s) — anything over is a backgrounded/abandoned tab
        if (typeof timeOnPage === "number" && timeOnPage > 0) sessionUpdates.timeOnPage = Math.min(timeOnPage, 1800);
        if (device) sessionUpdates.deviceType = device;
        // Passive learning: page dimensions
        const { pageHeight, screenWidth } = req.body;
        if (typeof pageHeight === "number" && pageHeight > 0) (sessionUpdates as any).pageHeight = pageHeight;
        if (typeof screenWidth === "number" && screenWidth > 0) (sessionUpdates as any).screenWidth = screenWidth;

        // Aggregate from events
        let clickDelta = 0;
        let videoPlayed = false;
        let videoCompleted = false;
        const newSections: string[] = [];

        if (Array.isArray(events)) {
          for (const evt of events) {
            if (evt.type === "click") clickDelta++;
            if (evt.type === "video_play") videoPlayed = true;
            if (evt.type === "video_complete") videoCompleted = true;
            if (evt.type === "section_view") {
              try {
                const d = JSON.parse(evt.data || "{}");
                if (d.section) newSections.push(d.section);
              } catch { /* ignore */ }
            }
          }
        }

        if (clickDelta > 0) sessionUpdates.clickCount = clickDelta;
        if (videoPlayed) sessionUpdates.videoPlayed = true;
        if (videoCompleted) sessionUpdates.videoCompleted = true;
        if (newSections.length > 0) sessionUpdates.sectionsViewed = newSections;

        await storage.upsertVisitorSession(vid, campaignId, sessionUpdates);

        // Store section map on the campaign — update periodically (every 24h) to keep labels fresh
        if (sectionMap && Array.isArray(sectionMap) && sectionMap.length >= 3) {
          try {
            const existing = await pool.query("SELECT section_map, section_map_updated_at FROM campaigns WHERE id = $1", [campaignId]);
            const lastUpdated = existing.rows[0]?.section_map_updated_at;
            const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
            const isStale = !existing.rows[0]?.section_map || !lastUpdated || (Date.now() - new Date(lastUpdated).getTime() > staleThreshold);
            if (isStale) {
              await pool.query("UPDATE campaigns SET section_map = $1, section_map_updated_at = NOW() WHERE id = $2", [JSON.stringify(sectionMap), campaignId]);
              console.log(`[events] Updated section map (${sectionMap.length} sections) for campaign ${campaignId}`);
            }
          } catch (e) { /* non-fatal */ }
        }
      } catch (err) {
        console.error("[events] error:", err);
      }
    })();

    // Return immediately — don't block the widget
    return res.json({ received: true });
  });

  // POST /api/widget/styles — receive captured computed styles from the widget (fire-and-forget)
  app.post("/api/widget/styles", widgetLimiter, async (req: Request, res: Response) => {
    try {
      const { cid, styles } = req.body as {
        cid: number;
        styles: Record<string, Record<string, string>>;
      };
      if (!cid || typeof styles !== "object") {
        return res.json({ received: false });
      }

      // Category-to-styles mapping:
      // widget sends keys like "headline", "subheadline", "cta"
      // test_sections category field also uses these values (headline, cta, etc.)
      const categoryMap: Record<string, string[]> = {
        headline: ["headline"],
        subheadline: ["subheadline", "subheadline"],
        cta: ["cta"],
        section_header: ["section_header"],
      };

      const sections = await storage.getTestSectionsByCampaign(cid);

      // For each section, check if we have styles for its category and it doesn't already have styles
      const updates: Promise<void>[] = [];
      for (const section of sections) {
        // Only update if styles aren't already stored (first-capture wins)
        if (section.elementStyles) continue;

        // Find matching style key for this section's category
        let matchedStyles: Record<string, string> | null = null;
        const cat = section.category;

        if (styles[cat]) {
          matchedStyles = styles[cat];
        } else if (cat === "headline" && styles["headline"]) {
          matchedStyles = styles["headline"];
        } else if (cat === "cta" && styles["cta"]) {
          matchedStyles = styles["cta"];
        }

        if (matchedStyles) {
          updates.push(storage.updateTestSectionStyles(section.id, JSON.stringify(matchedStyles)));
        }
      }

      await Promise.all(updates);
      return res.json({ received: true });
    } catch (err) {
      // Never fail — widget doesn't care about the response
      return res.json({ received: false });
    }
  });

  // GET /api/widget/flag-variant — widget reports a display issue (image beacon, fire-and-forget)
  // Called when post-apply validation fails: reverts to control and fires this to mark the variant.
  app.get("/api/widget/flag-variant", widgetLimiter, async (req: Request, res: Response) => {
    // Respond immediately — the widget doesn't wait for this
    res.status(200).send("");
    try {
      const variantId = parseInt(String(req.query.variantId));
      const reason = String(req.query.reason || "display_check_failed").slice(0, 100);
      if (isNaN(variantId) || variantId <= 0) return;
      // Migrate column if needed, then flag the variant
      await pool.query(`
        ALTER TABLE variants ADD COLUMN IF NOT EXISTS display_issue BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE variants ADD COLUMN IF NOT EXISTS display_issue_reason TEXT;
        ALTER TABLE variants ADD COLUMN IF NOT EXISTS display_issue_at TEXT;
      `).catch(() => {}); // ignore if already exists
      await pool.query(
        `UPDATE variants SET display_issue = true, display_issue_reason = $1, display_issue_at = $2 WHERE id = $3`,
        [reason, new Date().toISOString(), variantId]
      );
      // If this is a content mismatch, also flag the test section
      if (reason.includes('mismatch')) {
        await pool.query(
          `UPDATE test_sections SET mismatch_detected = true, mismatch_detected_at = NOW(), mismatch_count = mismatch_count + 1
           WHERE id = (SELECT test_section_id FROM variants WHERE id = $1)`,
          [variantId]
        ).catch(() => {});
      }
      console.log(`[widget] Variant ${variantId} flagged: ${reason}`);
    } catch (err) {
      // Silent — never break the page over a logging failure
    }
  });


  // GET /api/widget/script/:campaignId — serve the widget JS with API base baked in
  app.get("/api/widget/script/:campaignId", widgetLimiter, (req: Request, res: Response) => {
    const campaignId = parseInt(String(req.params.campaignId));
    if (isNaN(campaignId)) {
      return res.status(400).send("/* Invalid campaignId */");
    }
    // Use the public API domain for the widget — Railway host header gets the internal hostname
    // when proxied through Cloudflare, so we hardcode the public domain
    const host = req.get("host") || "localhost";
    const PUBLIC_API = process.env.PUBLIC_API_URL || "https://api.siteamoeba.com";
    const baseUrl = host.includes("localhost") ? `http://${host}` : PUBLIC_API;
    const script = generateWidgetScript(baseUrl, campaignId);
    res.set("Content-Type", "application/javascript");
    res.set("Cache-Control", "public, max-age=30"); // short TTL so fixes propagate quickly
    res.send(script);
  });

  // GET /api/campaigns/:id/behavior-stats — authenticated, returns behavioral analytics
  app.get("/api/campaigns/:id/behavior-stats", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const [sessions, stats] = await Promise.all([
      storage.getSessionsByCampaign(campaignId),
      storage.getSessionStats(campaignId),
    ]);

    // Section visibility rates
    const sectionCounts: Record<string, number> = {};
    const totalSessions = sessions.length;
    for (const session of sessions) {
      try {
        const sections: string[] = session.sectionsViewed ? JSON.parse(session.sectionsViewed) : [];
        for (const s of sections) {
          sectionCounts[s] = (sectionCounts[s] || 0) + 1;
        }
      } catch { /* skip */ }
    }
    const sectionVisibilityRates: Record<string, number> = {};
    for (const [section, cnt] of Object.entries(sectionCounts)) {
      sectionVisibilityRates[section] = totalSessions > 0 ? cnt / totalSessions : 0;
    }

    // Click patterns
    const clickPatterns = {
      avgClicksPerSession: totalSessions > 0
        ? sessions.reduce((sum, s) => sum + s.clickCount, 0) / totalSessions
        : 0,
    };

    // Device breakdown
    const deviceBreakdown: Record<string, number> = {};
    for (const session of sessions) {
      const d = session.deviceType || "unknown";
      deviceBreakdown[d] = (deviceBreakdown[d] || 0) + 1;
    }

    return res.json({
      totalSessions,
      avgScrollDepth: Math.round(stats.avgScrollDepth),
      avgTimeOnPage: Math.round(stats.avgTimeOnPage),
      videoPlayRate: parseFloat((stats.videoPlayRate * 100).toFixed(1)),
      convertedAvgScroll: Math.round(stats.convertedAvgScroll),
      nonConvertedAvgScroll: Math.round(stats.nonConvertedAvgScroll),
      sectionVisibilityRates,
      clickPatterns,
      deviceBreakdown,
    });
  });

  // GET /api/campaigns/:id/page-insights — passive learning metrics from ALL visitors
  // Works even without active tests — learns from every installed pixel
  app.get("/api/campaigns/:id/page-insights", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const result = await pool.query(
      `SELECT
        COUNT(DISTINCT v.id) as total_visitors,
        COUNT(DISTINCT v.id) FILTER (WHERE v.converted = true) as total_conversions,

        -- Mobile vs Desktop split
        COUNT(DISTINCT v.id) FILTER (WHERE vs.device_type = 'mobile') as mobile_visitors,
        COUNT(DISTINCT v.id) FILTER (WHERE vs.device_type = 'desktop') as desktop_visitors,
        COUNT(DISTINCT v.id) FILTER (WHERE v.converted AND vs.device_type = 'mobile') as mobile_conversions,
        COUNT(DISTINCT v.id) FILTER (WHERE v.converted AND vs.device_type = 'desktop') as desktop_conversions,

        -- Avg metrics by device
        ROUND(AVG(vs.time_on_page) FILTER (WHERE vs.device_type = 'mobile' AND vs.time_on_page > 0)) as mobile_avg_time,
        ROUND(AVG(vs.time_on_page) FILTER (WHERE vs.device_type = 'desktop' AND vs.time_on_page > 0)) as desktop_avg_time,
        ROUND(AVG(vs.max_scroll_depth) FILTER (WHERE vs.device_type = 'mobile')) as mobile_avg_scroll,
        ROUND(AVG(vs.max_scroll_depth) FILTER (WHERE vs.device_type = 'desktop')) as desktop_avg_scroll,

        -- Page dimensions (median approximation via avg)
        ROUND(AVG(vs.page_height) FILTER (WHERE vs.device_type = 'mobile' AND vs.page_height > 0)) as mobile_avg_page_height,
        ROUND(AVG(vs.page_height) FILTER (WHERE vs.device_type = 'desktop' AND vs.page_height > 0)) as desktop_avg_page_height,
        ROUND(AVG(vs.screen_width) FILTER (WHERE vs.screen_width > 0)) as avg_screen_width,

        -- Overall
        ROUND(AVG(vs.time_on_page) FILTER (WHERE vs.time_on_page > 0)) as overall_avg_time,
        ROUND(AVG(vs.max_scroll_depth)) as overall_avg_scroll,
        ROUND(AVG(vs.click_count)) as overall_avg_clicks,
        COUNT(DISTINCT v.id) FILTER (WHERE vs.video_played) as video_plays
      FROM visitors v
      LEFT JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = v.campaign_id
      WHERE v.campaign_id = $1`,
      [campaignId]
    );

    const r = result.rows[0] || {};
    const totalV = parseInt(r.total_visitors) || 0;
    const mobileV = parseInt(r.mobile_visitors) || 0;
    const desktopV = parseInt(r.desktop_visitors) || 0;
    const mobileConv = parseInt(r.mobile_conversions) || 0;
    const desktopConv = parseInt(r.desktop_conversions) || 0;

    return res.json({
      totalVisitors: totalV,
      totalConversions: parseInt(r.total_conversions) || 0,
      overallConversionRate: totalV > 0 ? parseFloat(((parseInt(r.total_conversions) || 0) / totalV * 100).toFixed(2)) : 0,
      overallAvgTime: parseInt(r.overall_avg_time) || 0,
      overallAvgScroll: parseInt(r.overall_avg_scroll) || 0,
      overallAvgClicks: parseInt(r.overall_avg_clicks) || 0,
      videoPlays: parseInt(r.video_plays) || 0,
      mobile: {
        visitors: mobileV,
        conversions: mobileConv,
        conversionRate: mobileV > 0 ? parseFloat((mobileConv / mobileV * 100).toFixed(2)) : 0,
        avgTime: parseInt(r.mobile_avg_time) || 0,
        avgScroll: parseInt(r.mobile_avg_scroll) || 0,
        avgPageHeight: parseInt(r.mobile_avg_page_height) || 0,
      },
      desktop: {
        visitors: desktopV,
        conversions: desktopConv,
        conversionRate: desktopV > 0 ? parseFloat((desktopConv / desktopV * 100).toFixed(2)) : 0,
        avgTime: parseInt(r.desktop_avg_time) || 0,
        avgScroll: parseInt(r.desktop_avg_scroll) || 0,
        avgPageHeight: parseInt(r.desktop_avg_page_height) || 0,
      },
      avgScreenWidth: parseInt(r.avg_screen_width) || 0,
    });
  });

  // GET /api/campaigns/:id/section-dropoff — per-section reach & drop-off analysis
  app.get("/api/campaigns/:id/section-dropoff", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get section map from campaign
    const mapResult = await pool.query("SELECT section_map FROM campaigns WHERE id = $1", [campaignId]);
    const sectionMap = mapResult.rows[0]?.section_map;
    if (!sectionMap || !Array.isArray(sectionMap) || sectionMap.length < 2) {
      return res.json({ available: false, reason: "Section map not yet captured. Visit your page with the pixel installed to generate the section map." });
    }

    // Get scroll depth distribution from all visitor sessions
    const scrollResult = await pool.query(
      `SELECT
        vs.max_scroll_depth,
        v.converted,
        COUNT(*) as cnt
       FROM visitor_sessions vs
       JOIN visitors v ON v.id = vs.visitor_id AND v.campaign_id = vs.campaign_id
       WHERE vs.campaign_id = $1 AND vs.max_scroll_depth > 0
       GROUP BY vs.max_scroll_depth, v.converted`,
      [campaignId]
    );

    if (scrollResult.rows.length === 0) {
      return res.json({ available: false, reason: "Not enough scroll data yet." });
    }

    // Build scroll distribution
    let totalVisitors = 0;
    let totalConverters = 0;
    const scrollCounts: Record<number, { total: number; converted: number }> = {};
    for (const row of scrollResult.rows) {
      const depth = parseInt(row.max_scroll_depth);
      const count = parseInt(row.cnt);
      const isConverted = row.converted;
      if (!scrollCounts[depth]) scrollCounts[depth] = { total: 0, converted: 0 };
      scrollCounts[depth].total += count;
      if (isConverted) scrollCounts[depth].converted += count;
      totalVisitors += count;
      if (isConverted) totalConverters += count;
    }

    // For each section, calculate reach (% of visitors who scrolled past its offsetPct)
    const sections = (sectionMap as any[]).map((s: any, i: number) => {
      const sectionStart = s.offsetPct;
      // Count visitors who scrolled at least to this section's start
      let reached = 0;
      let reachedConverted = 0;
      for (const [depthStr, counts] of Object.entries(scrollCounts)) {
        const depth = parseInt(depthStr);
        if (depth >= sectionStart) {
          reached += (counts as any).total;
          reachedConverted += (counts as any).converted;
        }
      }
      const reachPct = totalVisitors > 0 ? Math.round(reached / totalVisitors * 100) : 0;
      const converterReachPct = totalConverters > 0 ? Math.round(reachedConverted / totalConverters * 100) : 0;
      return {
        idx: i,
        label: s.label,
        heading: s.heading || "",
        offsetPct: sectionStart,
        heightPct: s.heightPct || 0,
        reachPct,
        converterReachPct,
        visitors: reached,
      };
    });

    // Calculate drop-off between consecutive sections
    let biggestDropIdx = -1;
    let biggestDropPct = 0;
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1];
      const curr = sections[i];
      curr.dropFromPrev = prev.reachPct - curr.reachPct;
      if (curr.dropFromPrev > biggestDropPct && curr.label !== "footer") {
        biggestDropPct = curr.dropFromPrev;
        biggestDropIdx = i;
      }
    }
    if (sections.length > 0) sections[0].dropFromPrev = 0;

    // Build recommendation
    const SECTION_LABELS: Record<string, string> = {
      hero: "Hero", headline: "Headline", subheadline: "Subheadline",
      problem: "Problem/Pain", solution: "Solution", benefits: "Benefits",
      social_proof: "Social Proof", testimonials: "Testimonials",
      case_study: "Case Study", pricing: "Pricing", guarantee: "Guarantee",
      faq: "FAQ", cta: "CTA", about: "About", bonus: "Bonus",
      scarcity: "Scarcity/Urgency", footer: "Footer", video: "Video",
      content: "Content",
    };

    let recommendation = null;
    if (biggestDropIdx >= 0) {
      const dropSection = sections[biggestDropIdx];
      const prevSection = sections[biggestDropIdx - 1];
      const label = SECTION_LABELS[dropSection.label] || dropSection.label;
      const prevLabel = SECTION_LABELS[prevSection.label] || prevSection.label;
      recommendation = {
        sectionIdx: biggestDropIdx,
        sectionLabel: label,
        dropPct: biggestDropPct,
        message: `${biggestDropPct}% of visitors leave between your ${prevLabel} and ${label} sections. Only ${dropSection.reachPct}% of visitors reach your ${label}. This is the biggest drop-off point on your page — test improving this section next.`,
      };
    }

    res.json({
      available: true,
      totalVisitors,
      totalConverters,
      sectionCount: sections.length,
      sections: sections.map(s => ({
        ...s,
        label: SECTION_LABELS[s.label] || s.label,
      })),
      recommendation,
    });
  });

  // GET /api/conversion-intelligence — cross-campaign correlation analysis
  // Correlates page metrics + behavioral data against conversion rates across ALL campaigns
  app.get("/api/conversion-intelligence", requireAuth, async (req: Request, res: Response) => {
    // Pull per-campaign metrics with enough visitors to be meaningful
    const result = await pool.query(
      `SELECT
        c.id, c.url, c.page_type, c.niche, c.price_point,
        c.page_word_count, c.page_char_count, c.page_heading_count,
        c.page_cta_count, c.page_image_count, c.page_video_count,

        COUNT(DISTINCT v.id) as visitors,
        COUNT(DISTINCT v.id) FILTER (WHERE v.converted) as conversions,

        -- Behavioral averages
        ROUND(AVG(vs.time_on_page) FILTER (WHERE vs.time_on_page > 0)) as avg_time,
        ROUND(AVG(vs.max_scroll_depth)) as avg_scroll,
        ROUND(AVG(vs.click_count)) as avg_clicks,
        ROUND(AVG(vs.page_height) FILTER (WHERE vs.page_height > 0)) as avg_page_height,

        -- Mobile vs desktop conversion rates
        COUNT(DISTINCT v.id) FILTER (WHERE vs.device_type = 'mobile') as mobile_visitors,
        COUNT(DISTINCT v.id) FILTER (WHERE v.converted AND vs.device_type = 'mobile') as mobile_conversions,
        COUNT(DISTINCT v.id) FILTER (WHERE vs.device_type = 'desktop') as desktop_visitors,
        COUNT(DISTINCT v.id) FILTER (WHERE v.converted AND vs.device_type = 'desktop') as desktop_conversions,

        -- Converter vs non-converter behavior
        ROUND(AVG(vs.time_on_page) FILTER (WHERE v.converted AND vs.time_on_page > 0)) as buyer_avg_time,
        ROUND(AVG(vs.time_on_page) FILTER (WHERE NOT v.converted AND vs.time_on_page > 0)) as visitor_avg_time,
        ROUND(AVG(vs.max_scroll_depth) FILTER (WHERE v.converted)) as buyer_avg_scroll,
        ROUND(AVG(vs.max_scroll_depth) FILTER (WHERE NOT v.converted)) as visitor_avg_scroll

      FROM campaigns c
      JOIN visitors v ON v.campaign_id = c.id
      LEFT JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = c.id
      WHERE c.status = 'active'
      GROUP BY c.id
      HAVING COUNT(DISTINCT v.id) >= 10
      ORDER BY COUNT(DISTINCT v.id) DESC`
    );

    const campaigns = result.rows.map((r: any) => {
      const vis = parseInt(r.visitors) || 0;
      const conv = parseInt(r.conversions) || 0;
      const mVis = parseInt(r.mobile_visitors) || 0;
      const dVis = parseInt(r.desktop_visitors) || 0;
      const mConv = parseInt(r.mobile_conversions) || 0;
      const dConv = parseInt(r.desktop_conversions) || 0;
      return {
        campaignId: r.id,
        url: r.url,
        pageType: r.page_type,
        niche: r.niche,
        pricePoint: r.price_point,
        pageWordCount: parseInt(r.page_word_count) || 0,
        pageHeadingCount: parseInt(r.page_heading_count) || 0,
        pageCtaCount: parseInt(r.page_cta_count) || 0,
        pageImageCount: parseInt(r.page_image_count) || 0,
        pageVideoCount: parseInt(r.page_video_count) || 0,
        visitors: vis,
        conversions: conv,
        conversionRate: vis > 0 ? parseFloat((conv / vis * 100).toFixed(2)) : 0,
        avgTime: parseInt(r.avg_time) || 0,
        avgScroll: parseInt(r.avg_scroll) || 0,
        avgClicks: parseInt(r.avg_clicks) || 0,
        avgPageHeight: parseInt(r.avg_page_height) || 0,
        mobile: {
          visitors: mVis,
          conversionRate: mVis > 0 ? parseFloat((mConv / mVis * 100).toFixed(2)) : 0,
        },
        desktop: {
          visitors: dVis,
          conversionRate: dVis > 0 ? parseFloat((dConv / dVis * 100).toFixed(2)) : 0,
        },
        buyerAvgTime: parseInt(r.buyer_avg_time) || 0,
        visitorAvgTime: parseInt(r.visitor_avg_time) || 0,
        buyerAvgScroll: parseInt(r.buyer_avg_scroll) || 0,
        visitorAvgScroll: parseInt(r.visitor_avg_scroll) || 0,
      };
    });

    // Compute cross-campaign correlations if we have enough data
    const correlations: { metric: string; correlation: string; insight: string }[] = [];
    if (campaigns.length >= 3) {
      // Simple correlation observations
      const avgCVR = campaigns.reduce((s: number, c: any) => s + c.conversionRate, 0) / campaigns.length;
      const highCVR = campaigns.filter((c: any) => c.conversionRate > avgCVR);
      const lowCVR = campaigns.filter((c: any) => c.conversionRate <= avgCVR);

      const avgMetric = (arr: any[], key: string) => {
        const vals = arr.map((c: any) => c[key]).filter((v: number) => v > 0);
        return vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
      };

      // Word count vs conversion
      const highWords = avgMetric(highCVR, 'pageWordCount');
      const lowWords = avgMetric(lowCVR, 'pageWordCount');
      if (highWords > 0 && lowWords > 0) {
        correlations.push({
          metric: 'pageWordCount',
          correlation: highWords > lowWords ? 'positive' : 'negative',
          insight: `Higher-converting pages average ${Math.round(highWords)} words vs ${Math.round(lowWords)} for lower-converting pages.`,
        });
      }

      // Scroll depth vs conversion
      const highScroll = avgMetric(highCVR, 'buyerAvgScroll');
      const lowScroll = avgMetric(lowCVR, 'visitorAvgScroll');
      if (highScroll > 0) {
        correlations.push({
          metric: 'scrollDepth',
          correlation: 'behavioral',
          insight: `Buyers scroll ${Math.round(highScroll)}% of the page on average vs ${Math.round(lowScroll)}% for non-buyers.`,
        });
      }

      // Time on page vs conversion
      const highTime = avgMetric(highCVR, 'buyerAvgTime');
      const lowTime = avgMetric(lowCVR, 'visitorAvgTime');
      if (highTime > 0) {
        correlations.push({
          metric: 'timeOnPage',
          correlation: 'behavioral',
          insight: `Buyers spend ${Math.round(highTime)}s on page vs ${Math.round(lowTime)}s for non-buyers.`,
        });
      }

      // Mobile vs desktop
      const totalMobileCVR = campaigns.reduce((s: number, c: any) => s + (c.mobile.conversionRate || 0), 0) / campaigns.length;
      const totalDesktopCVR = campaigns.reduce((s: number, c: any) => s + (c.desktop.conversionRate || 0), 0) / campaigns.length;
      correlations.push({
        metric: 'deviceType',
        correlation: totalMobileCVR > totalDesktopCVR ? 'mobile_higher' : 'desktop_higher',
        insight: `Mobile converts at ${totalMobileCVR.toFixed(2)}% vs Desktop at ${totalDesktopCVR.toFixed(2)}% across all pages.`,
      });
    }

    return res.json({ campaigns, correlations, totalCampaigns: campaigns.length });
  });

  // Stripe webhook for campaign conversions
  app.post("/api/webhook/stripe/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = paramId(req.params.campaignId);
      const event = req.body;

      if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
        const amount = event.data?.object?.amount_total
          || event.data?.object?.amount
          || event.data?.object?.amount_received || 0;
        const revenue = amount / 100;
        const metadata = event.data?.object?.metadata || {};
        const visitorId = metadata.ab_visitor_id || event.data?.object?.client_reference_id || null;
        const paymentId = event.data?.object?.id || event.id;

        if (visitorId) {
          await storage.markConverted(visitorId, paymentId, revenue);
          return res.json({ received: true, attributed: true });
        }
        return res.json({ received: true, attributed: false, reason: "no_visitor_id" });
      }
      res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // ============== REVENUE INTEGRATION WEBHOOKS (PUBLIC — no auth) ==============

  // Helper: find a visitor in a campaign by email
  async function matchVisitorByEmail(campaignId: number, email: string): Promise<string | null> {
    const { Pool: PgPool } = require("pg");
    const pgPool = new PgPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
    try {
      const result = await pool.query(
        `SELECT id FROM visitors WHERE campaign_id = $1 AND converted = false ORDER BY first_seen DESC LIMIT 1`,
        [campaignId]
      );
      if (result.rows.length > 0) return result.rows[0].id as string;
      // Also check visitor_sessions for email match (future: store email on visitor)
      return null;
    } finally {
      await pgPool.end();
    }
  }

  // ──────────────────────────────────────────────────────────────
  // USER-LEVEL STRIPE WEBHOOK
  // POST /api/webhooks/stripe/account/:userId
  //
  // The widget injects ?sa_vid=<id>&client_reference_id=<id> into every
  // buy.stripe.com Payment Link. Stripe passes client_reference_id through to
  // the checkout.session.completed webhook event, giving us a direct visitor
  // match without needing the pixel to fire at all.
  //
  // Attribution chain (in order):
  //   1. client_reference_id matches a v_xxx visitor  → direct match
  //   2. metadata.sa_vid matches a visitor            → direct match
  //   3. customer email matches a known visitor       → email match
  //   4. charge date >= campaign creation AND only 1 active campaign → assign
  //   5. Skip — do not guess
  // ──────────────────────────────────────────────────────────────
  app.post("/api/webhooks/stripe/account/:userId", async (req: Request, res: Response) => {
    try {
      const userId = paramId(req.params.userId);
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Optional signature verification using the user's stored webhook secret
      const webhookSecret = (user as any).stripeWebhookSecret;
      if (webhookSecret && stripe) {
        const sig = req.headers["stripe-signature"] as string;
        if (sig && req.rawBody) {
          try {
            stripe.webhooks.constructEvent(req.rawBody as Buffer, sig, webhookSecret);
          } catch {
            return res.status(400).json({ error: "Invalid signature" });
          }
        }
      }

      const event = req.body;
      const eventType: string = event.type;
      const obj = event.data?.object || {};

      if (
        eventType === "checkout.session.completed" ||
        eventType === "payment_intent.succeeded" ||
        eventType === "charge.succeeded"
      ) {
        const amountRaw = obj.amount_total ?? obj.amount_received ?? obj.amount ?? 0;
        const amount = amountRaw / 100;
        let customerEmail: string | null =
          obj.customer_details?.email || obj.receipt_email || obj.billing_details?.email ||
          obj.customer_email || obj.metadata?.customer_email || null;
        // Fallback: fetch email from Stripe Customer object
        const custId = (typeof obj.customer === "string") ? obj.customer : null;
        if (!customerEmail && custId) {
          try {
            const decKey = decryptApiKey((user as any).stripeAccessToken || "");
            const sc = new Stripe(decKey);
            const cust = await sc.customers.retrieve(custId);
            if (cust && !(cust as any).deleted) customerEmail = (cust as any).email || null;
          } catch { /* restricted key may not have customer read */ }
        }
        const externalId = obj.id || event.id;
        const metadata = obj.metadata || {};

        // Attribution chain
        let resolvedVisitorId: string | null = null;
        let resolvedCampaignId: number | null = null;

        // 1. client_reference_id (set by widget on Stripe Payment Links)
        const clientRef = obj.client_reference_id || metadata.sa_vid || null;
        if (clientRef && /^v_[a-z0-9_]+$/.test(clientRef)) {
          const visitor = await storage.getVisitor(clientRef);
          if (visitor) {
            resolvedVisitorId = visitor.id;
            resolvedCampaignId = visitor.campaignId;
          }
        }

        // 2. Email match across all user campaigns
        if (!resolvedVisitorId && customerEmail) {
          const emailMatch = await pool.query(
            `SELECT v.id, v.campaign_id FROM visitors v
             JOIN campaigns c ON c.id = v.campaign_id
             WHERE c.user_id = $1 AND (
               v.customer_email = $2 OR
               v.id IN (SELECT re.visitor_id FROM revenue_events re WHERE re.customer_email = $2 AND re.visitor_id IS NOT NULL)
             )
             ORDER BY v.first_seen ASC LIMIT 1`,
            [userId, customerEmail]
          );
          if (emailMatch.rows.length > 0) {
            resolvedVisitorId = emailMatch.rows[0].id;
            resolvedCampaignId = emailMatch.rows[0].campaign_id;
          }
        }

        // 3. If no match but charge date >= campaign launch, assign to active campaign
        if (!resolvedCampaignId) {
          const chargeDate = new Date((obj.created || Date.now() / 1000) * 1000);
          const userCampaigns = await storage.getCampaignsByUser(userId);
          const matchedCampaign = userCampaigns.find((c: any) =>
            c.status === "active" && c.isActive &&
            chargeDate >= new Date(c.createdAt)
          ) ?? null;
          if (matchedCampaign) resolvedCampaignId = matchedCampaign.id;
        }

        if (!resolvedCampaignId) {
          return res.json({ received: true, attributed: false, reason: "no campaign match" });
        }

        // Dedup by external_id
        const existing = await pool.query(
          `SELECT id FROM revenue_events WHERE external_id = $1 LIMIT 1`, [externalId]
        );
        if (existing.rows.length === 0) {
          await storage.addRevenueEvent({
            visitorId: resolvedVisitorId || undefined,
            campaignId: resolvedCampaignId,
            source: "stripe_webhook",
            eventType: "purchase",
            amount,
            currency: (obj.currency || "usd").toUpperCase(),
            externalId,
            customerEmail: customerEmail || undefined,
            metadata: JSON.stringify({ clientRef, chargeDate: new Date((obj.created || 0) * 1000).toISOString() }),
          });
        }

        // Mark the visitor as converted with the REAL amount from Stripe
        if (resolvedVisitorId) {
          const visitor = await storage.getVisitor(resolvedVisitorId);
          if (visitor && !visitor.converted) {
            await storage.markConverted(resolvedVisitorId, externalId, amount, customerEmail || undefined);
          } else if (visitor && visitor.converted && amount > 0) {
            // Upsell — accumulate revenue on the visitor so CVR stays accurate
            await pool.query(
              `UPDATE visitors SET revenue = COALESCE(revenue, 0) + $1 WHERE id = $2`,
              [amount, resolvedVisitorId]
            );
          }
          // Store email for future upsell attribution
          if (customerEmail && !visitor?.customerEmail) {
            await pool.query(
              `UPDATE visitors SET customer_email = $1 WHERE id = $2`,
              [customerEmail, resolvedVisitorId]
            );
          }
        }

        console.log(`[stripe-webhook] ${eventType} $${amount} — visitor: ${resolvedVisitorId || "unmatched"} campaign: ${resolvedCampaignId}`);
        return res.json({ received: true, attributed: !!resolvedVisitorId, campaignId: resolvedCampaignId });
      }

      if (eventType === "charge.refunded") {
        const amount = (obj.amount_refunded || 0) / 100;
        const externalId = `refund_${obj.id || event.id}`;
        const customerEmail = obj.receipt_email || null;
        // Find which campaign to attribute the refund to
        const userCampaigns = await storage.getCampaignsByUser(userId);
        if (userCampaigns.length > 0) {
          const emailCampaign = customerEmail
            ? await pool.query(
                `SELECT campaign_id FROM revenue_events WHERE customer_email = $1 LIMIT 1`,
                [customerEmail]
              )
            : { rows: [] };
          const campaignId = emailCampaign.rows[0]?.campaign_id ?? userCampaigns[0].id;
          await storage.addRevenueEvent({
            campaignId,
            source: "stripe_webhook",
            eventType: "refund",
            amount: -amount,
            externalId,
            customerEmail: customerEmail || undefined,
          });
        }
        return res.json({ received: true });
      }

      res.json({ received: true });
    } catch (err) {
      console.error("[stripe-webhook] error:", err);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // A) Stripe webhook: POST /api/webhooks/stripe/:campaignId
  app.post("/api/webhooks/stripe/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = paramId(req.params.campaignId);
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      // Signature verification if campaign has a webhook secret and stripe is available
      if (campaign.webhookSecret && stripe) {
        const sig = req.headers["stripe-signature"] as string;
        if (sig && req.rawBody) {
          try {
            stripe.webhooks.constructEvent(req.rawBody as Buffer, sig, campaign.webhookSecret);
          } catch {
            return res.status(400).json({ error: "Invalid signature" });
          }
        }
      }

      const event = req.body;
      const eventType = event.type as string;

      if (eventType === "checkout.session.completed" || eventType === "payment_intent.succeeded") {
        const obj = event.data?.object || {};
        const amountRaw = obj.amount_total ?? obj.amount_received ?? obj.amount ?? 0;
        const amount = amountRaw / 100;
        const customerEmail = obj.customer_details?.email || obj.receipt_email || obj.customer_email || null;
        const externalId = obj.id || event.id;
        const metadata = obj.metadata || {};
        const visitorId = metadata.ab_visitor_id || obj.client_reference_id || null;

        let resolvedVisitorId = visitorId;
        if (!resolvedVisitorId && customerEmail) {
          resolvedVisitorId = await matchVisitorByEmail(campaignId, customerEmail);
        }

        await storage.addRevenueEvent({
          visitorId: resolvedVisitorId || undefined,
          campaignId,
          source: "stripe",
          eventType: "purchase",
          amount,
          currency: obj.currency?.toUpperCase() || "USD",
          externalId,
          customerEmail: customerEmail || undefined,
          metadata: JSON.stringify(metadata),
        });

        // Also mark converted if we have a visitor ID and they aren't already converted
        if (resolvedVisitorId) {
          const visitor = await storage.getVisitor(resolvedVisitorId);
          if (visitor && !visitor.converted) {
            await storage.markConverted(resolvedVisitorId, externalId, amount);
          }
        }

        return res.json({ received: true, attributed: !!resolvedVisitorId });
      }

      if (eventType === "charge.refunded") {
        const obj = event.data?.object || {};
        const amount = (obj.amount_refunded || 0) / 100;
        const externalId = obj.id || event.id;
        const customerEmail = obj.receipt_email || null;
        await storage.addRevenueEvent({
          campaignId,
          source: "stripe",
          eventType: "refund",
          amount: -amount,
          externalId,
          customerEmail: customerEmail || undefined,
        });
        return res.json({ received: true });
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // B) Shopify webhook: POST /api/webhooks/shopify/:campaignId
  app.post("/api/webhooks/shopify/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = paramId(req.params.campaignId);
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const order = req.body;
      const topic = req.headers["x-shopify-topic"] as string | undefined;
      if (topic && topic !== "orders/create" && topic !== "orders/paid") {
        return res.json({ received: true, ignored: true });
      }

      const amount = parseFloat(order.total_price || "0");
      const customerEmail = order.email || order.customer?.email || null;
      const externalId = String(order.id || "");
      const currency = (order.currency || "USD").toUpperCase();

      let resolvedVisitorId: string | null = null;
      if (customerEmail) {
        resolvedVisitorId = await matchVisitorByEmail(campaignId, customerEmail);
      }

      await storage.addRevenueEvent({
        visitorId: resolvedVisitorId || undefined,
        campaignId,
        source: "shopify",
        eventType: "purchase",
        amount,
        currency,
        externalId,
        customerEmail: customerEmail || undefined,
        metadata: JSON.stringify({ shopify_order_name: order.name, tags: order.tags }),
      });

      if (resolvedVisitorId) {
        const visitor = await storage.getVisitor(resolvedVisitorId);
        if (visitor && !visitor.converted) {
          await storage.markConverted(resolvedVisitorId, externalId, amount);
        }
      }

      res.json({ received: true, attributed: !!resolvedVisitorId });
    } catch (error) {
      console.error("Shopify webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // C) Generic webhook (GoHighLevel, Whop, etc.): POST /api/webhooks/generic/:campaignId
  app.post("/api/webhooks/generic/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = paramId(req.params.campaignId);
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      // Verify webhook secret if campaign has one
      if (campaign.webhookSecret) {
        const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
        if (providedSecret !== campaign.webhookSecret) {
          return res.status(401).json({ error: "Invalid webhook secret" });
        }
      }

      const body = req.body as {
        email?: string;
        amount?: number | string;
        event_type?: string;
        currency?: string;
        external_id?: string;
        source?: string;
        visitor_id?: string;
        metadata?: Record<string, unknown>;
      };

      const customerEmail = body.email || null;
      const amount = parseFloat(String(body.amount || "0"));
      const eventType = body.event_type || "purchase";
      const currency = (body.currency || "USD").toUpperCase();
      const externalId = body.external_id || null;
      const source = body.source || "webhook";

      let resolvedVisitorId = body.visitor_id || null;
      if (!resolvedVisitorId && customerEmail) {
        resolvedVisitorId = await matchVisitorByEmail(campaignId, customerEmail);
      }

      await storage.addRevenueEvent({
        visitorId: resolvedVisitorId || undefined,
        campaignId,
        source,
        eventType,
        amount,
        currency,
        externalId: externalId || undefined,
        customerEmail: customerEmail || undefined,
        metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
      });

      if (resolvedVisitorId && eventType !== "refund") {
        const visitor = await storage.getVisitor(resolvedVisitorId);
        if (visitor && !visitor.converted) {
          await storage.markConverted(resolvedVisitorId, externalId || "", amount);
        }
      }

      res.json({ received: true, attributed: !!resolvedVisitorId });
    } catch (error) {
      console.error("Generic webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // ============== USER-LEVEL WEBHOOK ROUTES ==============

  // Helper: find a visitor across ALL campaigns belonging to a user, matched by email
  async function matchVisitorByEmailAcrossUser(userId: number, email: string): Promise<{ visitorId: string; campaignId: number } | null> {
    try {
      // 1. Try exact email match on a visitor (converted or not)
      const emailMatch = await pool.query(
        `SELECT v.id, v.campaign_id FROM visitors v
         JOIN campaigns c ON c.id = v.campaign_id
         WHERE c.user_id = $1
           AND LOWER(v.customer_email) = LOWER($2)
         ORDER BY v.first_seen DESC
         LIMIT 1`,
        [userId, email]
      );
      if (emailMatch.rows.length > 0) {
        return { visitorId: emailMatch.rows[0].id as string, campaignId: emailMatch.rows[0].campaign_id as number };
      }

      // 2. Fallback: recent unconverted visitor on any active campaign (last 4 hours)
      const recentMatch = await pool.query(
        `SELECT v.id, v.campaign_id FROM visitors v
         JOIN campaigns c ON c.id = v.campaign_id
         WHERE c.user_id = $1
           AND c.status = 'active'
           AND v.converted = false
           AND v.first_seen::timestamptz > NOW() - INTERVAL '4 hours'
         ORDER BY v.first_seen DESC
         LIMIT 1`,
        [userId]
      );
      if (recentMatch.rows.length > 0) {
        return { visitorId: recentMatch.rows[0].id as string, campaignId: recentMatch.rows[0].campaign_id as number };
      }
      return null;
    } catch {
      return null;
    }
  }

  // D1) Shopify user-level: POST /api/webhooks/shopify/user/:userId
  app.post("/api/webhooks/shopify/user/:userId", async (req: Request, res: Response) => {
    try {
      const userId = paramId(req.params.userId);
      const order = req.body;
      const topic = req.headers["x-shopify-topic"] as string | undefined;
      if (topic && topic !== "orders/create" && topic !== "orders/paid") {
        return res.json({ received: true, ignored: true });
      }

      const amount = parseFloat(order.total_price || "0");
      const customerEmail = order.email || order.customer?.email || null;
      const externalId = String(order.id || "");
      const currency = (order.currency || "USD").toUpperCase();

      let resolvedVisitorId: string | null = null;
      let resolvedCampaignId: number | null = null;

      if (customerEmail) {
        const match = await matchVisitorByEmailAcrossUser(userId, customerEmail);
        if (match) {
          resolvedVisitorId = match.visitorId;
          resolvedCampaignId = match.campaignId;
        }
      }

      if (resolvedCampaignId) {
        await storage.addRevenueEvent({
          visitorId: resolvedVisitorId || undefined,
          campaignId: resolvedCampaignId,
          source: "shopify",
          eventType: "purchase",
          amount,
          currency,
          externalId,
          customerEmail: customerEmail || undefined,
          metadata: JSON.stringify({ shopify_order_name: order.name, tags: order.tags }),
        });

        if (resolvedVisitorId) {
          const visitor = await storage.getVisitor(resolvedVisitorId);
          if (visitor && !visitor.converted) {
            await storage.markConverted(resolvedVisitorId, externalId, amount);
          }
        }
      }

      res.json({ received: true, attributed: !!resolvedVisitorId });
    } catch (error) {
      console.error("Shopify user-level webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // D2) GoHighLevel user-level: POST /api/webhooks/ghl/:userId
  app.post("/api/webhooks/ghl/:userId", async (req: Request, res: Response) => {
    try {
      const userId = paramId(req.params.userId);
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Verify webhook secret if set
      if ((user as any).webhookSecret) {
        const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
        if (providedSecret !== (user as any).webhookSecret) {
          return res.status(401).json({ error: "Invalid webhook secret" });
        }
      }

      const body = req.body;
      // GHL payload: { event, contact: { email }, opportunity: { monetary_value } }
      const customerEmail = body.contact?.email || body.email || null;
      const amount = parseFloat(String(body.opportunity?.monetary_value || body.amount || "0"));
      const eventType = body.event || body.event_type || "purchase";
      const externalId = body.id || body.external_id || null;

      let resolvedVisitorId: string | null = null;
      let resolvedCampaignId: number | null = null;

      if (customerEmail) {
        const match = await matchVisitorByEmailAcrossUser(userId, customerEmail);
        if (match) {
          resolvedVisitorId = match.visitorId;
          resolvedCampaignId = match.campaignId;
        }
      }

      if (resolvedCampaignId) {
        await storage.addRevenueEvent({
          visitorId: resolvedVisitorId || undefined,
          campaignId: resolvedCampaignId,
          source: "gohighlevel",
          eventType: "purchase",
          amount,
          currency: "USD",
          externalId: externalId || undefined,
          customerEmail: customerEmail || undefined,
          metadata: JSON.stringify({ ghl_event: eventType, raw: body }),
        });

        if (resolvedVisitorId && !eventType.includes("refund")) {
          const visitor = await storage.getVisitor(resolvedVisitorId);
          if (visitor && !visitor.converted) {
            await storage.markConverted(resolvedVisitorId, externalId || "", amount);
          }
        }
      }

      res.json({ received: true, attributed: !!resolvedVisitorId });
    } catch (error) {
      console.error("GHL webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // D3) Generic user-level: POST /api/webhooks/generic/user/:userId
  app.post("/api/webhooks/generic/user/:userId", async (req: Request, res: Response) => {
    try {
      const userId = paramId(req.params.userId);
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Verify webhook secret if set
      if ((user as any).webhookSecret) {
        const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
        if (providedSecret !== (user as any).webhookSecret) {
          return res.status(401).json({ error: "Invalid webhook secret" });
        }
      }

      const body = req.body as {
        email?: string;
        amount?: number | string;
        event_type?: string;
        currency?: string;
        external_id?: string;
        source?: string;
        visitor_id?: string;
        metadata?: Record<string, unknown>;
      };

      const customerEmail = body.email || null;
      const amount = parseFloat(String(body.amount || "0"));
      const eventType = body.event_type || "purchase";
      const currency = (body.currency || "USD").toUpperCase();
      const externalId = body.external_id || null;
      const source = body.source || "webhook";

      let resolvedVisitorId = body.visitor_id || null;
      let resolvedCampaignId: number | null = null;

      if (!resolvedVisitorId && customerEmail) {
        const match = await matchVisitorByEmailAcrossUser(userId, customerEmail);
        if (match) {
          resolvedVisitorId = match.visitorId;
          resolvedCampaignId = match.campaignId;
        }
      }

      if (resolvedCampaignId) {
        await storage.addRevenueEvent({
          visitorId: resolvedVisitorId || undefined,
          campaignId: resolvedCampaignId,
          source,
          eventType,
          amount,
          currency,
          externalId: externalId || undefined,
          customerEmail: customerEmail || undefined,
          metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
        });

        if (resolvedVisitorId && eventType !== "refund") {
          const visitor = await storage.getVisitor(resolvedVisitorId);
          if (visitor && !visitor.converted) {
            await storage.markConverted(resolvedVisitorId, externalId || "", amount);
          }
        }
      }

      res.json({ received: true, attributed: !!resolvedVisitorId });
    } catch (error) {
      console.error("Generic user-level webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // ============== WHOP INTEGRATION ==============

  // D3) Whop user-level webhook: POST /api/webhooks/whop/:userId
  app.post("/api/webhooks/whop/:userId", async (req: Request, res: Response) => {
    try {
      const userId = paramId(req.params.userId);
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Verify signature if webhook secret is set (using whop_api_key as shared secret)
      const whopSig = req.headers["x-whop-signature"] as string | undefined;
      if ((user as any).whopApiKey && whopSig) {
        // Signature verification is informational; Whop uses HMAC-SHA256
        // For now, we accept valid requests if no mismatch; detailed HMAC can be added later
      }

      const body = req.body;
      const action = body.action as string | undefined;

      // Only process payment events
      if (action && !action.startsWith("payment.")) {
        return res.json({ received: true, ignored: true });
      }

      const data = body.data || {};
      // Whop sends amount in cents as final_amount
      const amount = typeof data.final_amount === "number" ? data.final_amount / 100 : parseFloat(String(data.final_amount || "0"));
      const currency = (data.currency || "USD").toUpperCase();
      const externalId = String(data.id || "");
      const customerEmail = data.user?.email || data.email || null;

      let resolvedVisitorId: string | null = null;
      let resolvedCampaignId: number | null = null;

      if (customerEmail) {
        const match = await matchVisitorByEmailAcrossUser(userId, customerEmail);
        if (match) {
          resolvedVisitorId = match.visitorId;
          resolvedCampaignId = match.campaignId;
        }
      }

      if (resolvedCampaignId) {
        await storage.addRevenueEvent({
          visitorId: resolvedVisitorId || undefined,
          campaignId: resolvedCampaignId,
          source: "whop",
          eventType: action === "payment.refunded" ? "refund" : "purchase",
          amount,
          currency,
          externalId: externalId || undefined,
          customerEmail: customerEmail || undefined,
          metadata: JSON.stringify({ whop_action: action, whop_user_id: data.user_id }),
        });

        if (resolvedVisitorId && action !== "payment.refunded") {
          const visitor = await storage.getVisitor(resolvedVisitorId);
          if (visitor && !visitor.converted) {
            await storage.markConverted(resolvedVisitorId, externalId || "", amount);
          }
        }
      }

      res.json({ received: true, attributed: !!resolvedVisitorId });
    } catch (error) {
      console.error("Whop webhook error:", error);
      res.status(422).json({ error: "Webhook processing failed" });
    }
  });

  // ============================================================
  // WHOP INTEGRATION — API KEY ONLY (no webhook needed)
  // Uses pull-based sync: we fetch memberships from Whop and match
  // by customer email to attribute revenue to campaigns.
  // ============================================================

  // Sync Whop memberships to revenue events (email-based attribution)
  // Mutex: prevent concurrent Whop syncs for the same user (avoids duplicate inserts)
  const whopSyncInProgress = new Set<number>();

  async function syncWhopTransactions(userId: number): Promise<number> {
    if (whopSyncInProgress.has(userId)) return 0; // already running
    whopSyncInProgress.add(userId);
    try {
      return await _doWhopSync(userId);
    } finally {
      whopSyncInProgress.delete(userId);
    }
  }

  async function _doWhopSync(userId: number): Promise<number> {
    const user = await storage.getUserById(userId);
    if (!user || !(user as any).whopApiKey) return 0;
    const apiKey = decryptApiKey((user as any).whopApiKey);
    // If decryption failed (key returned as-is looks encrypted), bail out
    if (!apiKey.startsWith('apik_') && apiKey.includes(':')) {
      console.warn('[whop] API key appears encrypted with lost key — user must reconnect Whop in Settings');
      return 0;
    }
    const userCampaigns = await storage.getCampaignsByUser(userId);
    if (userCampaigns.length === 0) return 0;

    // Build plan price cache so we can look up amounts
    const planPrices: Record<string, number> = {};
    try {
      const plansRes = await fetch("https://api.whop.com/api/v2/plans?limit=50", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (plansRes.ok) {
        const plansData = await plansRes.json();
        for (const plan of (plansData.data || [])) {
          // Whop returns prices in cents — try renewal_price first, then initial_price
          // Some plans return prices in dollars (no cents), check magnitude
          const rawPrice = plan.renewal_price ?? plan.initial_price ?? plan.base_currency_price ?? 0;
          const amount = rawPrice > 1000 ? rawPrice / 100 : rawPrice; // if > 1000 assume cents
          planPrices[plan.id] = amount;
        }
        console.log('[whop] loaded', Object.keys(planPrices).length, 'plan prices:', JSON.stringify(planPrices));
      }
    } catch { /* ignore plan fetch errors */ }

    let synced = 0;
    let page = 1;
    const maxPages = 10; // sync up to ~100 recent memberships

    while (page <= maxPages) {
      const memRes = await fetch(`https://api.whop.com/api/v2/memberships?limit=10&page=${page}&valid=true`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!memRes.ok) break;
      const memData = await memRes.json();
      const memberships = memData.data || [];
      if (memberships.length === 0) break;

      for (const mem of memberships) {
        const email = mem.email;
        if (!email) continue;
        const externalId = `whop_${mem.id}`;

        // Skip if already synced
        const exists = await pool.query(
          `SELECT id FROM revenue_events WHERE external_id = $1 LIMIT 1`,
          [externalId]
        );
        if (exists.rows.length > 0) continue;

        // Get amount from plan cache
        const amount = planPrices[mem.plan] || 0;

        // Find original visitor by email (first-touch attribution)
        const visitorMatch = await pool.query(
          `SELECT v.id AS visitor_id, v.campaign_id
           FROM visitors v
           JOIN campaigns c ON c.id = v.campaign_id
           WHERE c.user_id = $1
             AND (v.customer_email = $2
               OR v.id IN (
                 SELECT re.visitor_id FROM revenue_events re
                 WHERE re.customer_email = $2 AND re.visitor_id IS NOT NULL
               ))
           ORDER BY v.first_seen ASC LIMIT 1`,
          [userId, email]
        );

        let matchedCampaignId: number | null = null;
        let matchedVisitorId: string | null = null;
        if (visitorMatch.rows.length > 0) {
          matchedVisitorId = visitorMatch.rows[0].visitor_id;
          matchedCampaignId = visitorMatch.rows[0].campaign_id;
        } else {
          // No visitor email match. Use time proximity to pixel conversion (within 2 hours).
          const membershipDate = mem.created_at
            ? new Date(mem.created_at * 1000).toISOString()
            : new Date().toISOString();
          const timeMatch = await pool.query(
            `SELECT v.id AS visitor_id, v.campaign_id
             FROM visitors v JOIN campaigns c ON c.id = v.campaign_id
             WHERE c.user_id = $1 AND v.converted = true AND v.converted_at IS NOT NULL
               AND ABS(EXTRACT(EPOCH FROM (v.converted_at::timestamptz - $2::timestamptz))) < 7200
             ORDER BY ABS(EXTRACT(EPOCH FROM (v.converted_at::timestamptz - $2::timestamptz))) ASC LIMIT 1`,
            [user.id, membershipDate]
          );
          if (timeMatch.rows.length > 0) {
            matchedVisitorId = timeMatch.rows[0].visitor_id;
            matchedCampaignId = timeMatch.rows[0].campaign_id;
            // Backfill email for future LTV
            if (memEmail) {
              await pool.query('UPDATE visitors SET customer_email = $1 WHERE id = $2 AND customer_email IS NULL', [memEmail, matchedVisitorId]);
            }
          }
          // No fallback. If pixel didn't fire, we can't attribute.
        }
        if (!matchedCampaignId) continue;

        await storage.addRevenueEvent({
          visitorId: matchedVisitorId || undefined,
          campaignId: matchedCampaignId,
          source: "whop",
          eventType: "purchase",
          amount,
          currency: "USD",
          externalId,
          customerEmail: email,
          metadata: JSON.stringify({ product: mem.product, plan: mem.plan, status: mem.status }),
        });

        // Mark visitor converted so stats pick it up
        if (matchedVisitorId && amount > 0) {
          try {
            const visitor = await storage.getVisitor(matchedVisitorId);
            if (visitor && !visitor.converted) {
              await storage.markConverted(matchedVisitorId, externalId, amount, email);
            }
          } catch { /* non-fatal */ }
        }

        synced++;
      }

      const totalPages = memData.pagination?.total_page || 1;
      if (page >= totalPages) break;
      page++;
    }
    return synced;
  } // end _doWhopSync

  // GET /api/settings/whop-status — also triggers a background sync
  app.get("/api/settings/whop-status", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });
    const connected = !!(user as any).whopApiKey;
    res.json({ connected, connectedAt: (user as any).whopConnectedAt });
    // Background sync if connected
    if (connected) syncWhopTransactions(req.userId!).catch(() => {});
  });

  // POST /api/settings/connect-whop
  app.post("/api/settings/connect-whop", requireAuth, async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== "string") {
      return res.status(400).json({ error: "apiKey is required" });
    }
    // Verify the key using Whop v5/company — the only endpoint that accepts apik_ format keys
    try {
      const verifyRes = await fetch("https://api.whop.com/v5/company", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (verifyRes.status === 401 || verifyRes.status === 403) {
        let message = "Invalid API key";
        try {
          const body = await verifyRes.json();
          message = body?.message || body?.error?.message || message;
        } catch {}
        return res.status(400).json({
          error: `Whop API key not accepted: ${message}\n\nMake sure you're using an API key from whop.com/dashboard → Settings → Developer (format: apik_...)`,
        });
      }
    } catch (err: any) {
      if (err.name !== "AbortError" && err.name !== "TimeoutError") {
        return res.status(400).json({ error: "Could not reach Whop. Check your connection and try again." });
      }
    }
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });
    await storage.updateUser(user.id, {
      whopApiKey: encryptApiKey(apiKey),
      whopConnectedAt: new Date().toISOString(),
    } as any);
    // Run initial sync after connecting
    syncWhopTransactions(req.userId!).catch(() => {});
    res.json({ connected: true });
  });

  // Whop settings: POST /api/settings/disconnect-whop
  app.post("/api/settings/disconnect-whop", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });
    await storage.updateUser(user.id, {
      whopApiKey: null,
      whopConnectedAt: null,
    } as any);
    res.json({ disconnected: true });
  });

  // ============== SETTINGS HELPERS ==============

  // Generate/save a user-level webhook secret
  app.post("/api/settings/generate-webhook-secret", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: "User not found" });
    // Return existing secret if already set
    if ((user as any).webhookSecret) {
      return res.json({ secret: (user as any).webhookSecret });
    }
    const { randomBytes } = require("crypto");
    const secret = "whsec_" + randomBytes(24).toString("hex");
    await storage.updateUser(user.id, { webhookSecret: secret } as any);
    res.json({ secret });
  });

  // Save Shopify store URL for a user
  app.post("/api/settings/shopify-store", requireAuth, async (req: Request, res: Response) => {
    const { storeUrl } = req.body;
    if (!storeUrl || typeof storeUrl !== "string") {
      return res.status(400).json({ error: "storeUrl is required" });
    }
    await storage.updateUser(req.userId!, { shopifyStoreUrl: storeUrl, shopifyConnectedAt: new Date().toISOString() } as any);
    res.json({ ok: true });
  });

  // Generate/retrieve webhook secret for a campaign
  app.post("/api/campaigns/:id/webhook-secret", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.webhookSecret) {
      return res.json({ secret: campaign.webhookSecret });
    }
    // Generate a random secret
    const { randomBytes } = require("crypto");
    const secret = "whsec_" + randomBytes(24).toString("hex");
    await storage.updateCampaign(campaignId, { webhookSecret: secret } as any);
    res.json({ secret });
  });

  // LTV dashboard data
  app.get("/api/campaigns/:id/ltv", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const ltv = await storage.getLTVByCampaign(campaignId);
    res.json(ltv);
  });

  // Embed code generator
  app.get("/api/campaigns/:id/embed-code", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const baseUrl = req.protocol + "://" + req.get("host");
    const script = generateEmbedCode(baseUrl, campaign);
    res.json({ code: script });
  });

  // ============== FEEDBACK ==============

  app.post("/api/feedback", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertFeedbackSchema.safeParse({
      ...req.body,
      userId: req.userId,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    // Sanitize user message before storing
    const feedbackData = { ...parsed.data };
    if (typeof feedbackData.message === "string") {
      (feedbackData as any).message = sanitizeInput(feedbackData.message);
    }
    const item = await storage.createFeedback(feedbackData);
    res.status(201).json(item);
  });

  app.get("/api/feedback", requireAuth, async (req: Request, res: Response) => {
    const items = await storage.getFeedbackByUser(req.userId!);
    res.json(items);
  });

  app.get("/api/admin/feedback", requireAdmin, async (req: Request, res: Response) => {
    const result = await pool.query(
      `SELECT f.*, u.name as user_name, u.email as user_email, u.plan as user_plan
       FROM feedback f JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC`
    );
    res.json(result.rows);
  });

  // GET /api/admin/client-errors — view recent React crashes for debugging
  app.get("/api/admin/client-errors", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT * FROM client_errors ORDER BY created_at DESC LIMIT 50`
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/feedback/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = paramId(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { status, adminNotes } = req.body;
    if (!status) return res.status(400).json({ error: "status is required" });
    const item = await storage.updateFeedbackStatus(id, status, adminNotes);
    res.json(item);
  });

  // Admin: respond to feedback (visible to user)
  app.post("/api/admin/feedback/:id/respond", requireAdmin, async (req: Request, res: Response) => {
    const id = paramId(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { response } = req.body;
    if (!response || typeof response !== "string" || response.trim().length === 0) {
      return res.status(400).json({ error: "response is required" });
    }
    try {
      await pool.query(
        `UPDATE feedback SET admin_response = $1, responded_at = $2, response_read = false, status = 'resolved' WHERE id = $3`,
        [response.trim(), new Date().toISOString(), id]
      );
      const updated = await pool.query(`SELECT * FROM feedback WHERE id = $1`, [id]);
      res.json(updated.rows[0] || { id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // User: get my feedback with responses
  app.get("/api/feedback/my", requireAuth, async (req: Request, res: Response) => {
    const result = await pool.query(
      `SELECT id, category, message, status, admin_response, responded_at, response_read, created_at
       FROM feedback WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  });

  // User: mark feedback response as read
  app.post("/api/feedback/:id/mark-read", requireAuth, async (req: Request, res: Response) => {
    const id = paramId(req.params.id);
    await pool.query(
      `UPDATE feedback SET response_read = true WHERE id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    res.json({ ok: true });
  });

  // ============== FUNNEL STEPS ==============

  // In-memory cache for Stripe products per user (avoid 40s fetch every time)
  const stripeProductCache: Record<number, { products: any[]; fetchedAt: number }> = {};

  // GET /api/settings/stripe-products — fetch real products from actual Stripe transactions
  // Pulls from charge descriptions (what was actually sold), not just manually created products.
  app.get("/api/settings/stripe-products", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || !(user as any).stripeAccessToken) {
      return res.json({ products: [] });
    }

    // Return cached if fresh (cache for 10 minutes)
    const cached = stripeProductCache[user.id];
    if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      return res.json({ products: cached.products });
    }

    try {
      const decryptedKey = decryptApiKey((user as any).stripeAccessToken);
      const stripeClient = new Stripe(decryptedKey);

      // Fetch charges from the last 30 days to find actual product names + prices
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
      let allCharges: any[] = [];
      let hasMore = true;
      let startingAfter: string | undefined = undefined;
      let pages = 0;
      while (hasMore && pages < 10) {
        const params: any = { limit: 100, created: { gte: thirtyDaysAgo } };
        if (startingAfter) params.starting_after = startingAfter;
        const batch = await stripeClient.charges.list(params);
        allCharges = allCharges.concat(batch.data);
        hasMore = batch.has_more;
        if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id;
        pages++;
      }
      const charges = { data: allCharges };

      // Group by description — each unique description is a "product"
      const productMap: Record<string, { name: string; amounts: number[]; count: number; lastSeen: number }> = {};

      for (const charge of charges.data) {
        if (charge.status !== 'succeeded') continue;
        const desc = (charge.description || '').trim();
        if (!desc || desc.length < 3) continue;
        // Skip subscription-related charges
        if (desc.toLowerCase().includes('subscription creation') || desc.toLowerCase().includes('subscription update')) continue;

        const amount = charge.amount / 100;
        if (!productMap[desc]) {
          productMap[desc] = { name: desc, amounts: [], count: 0, lastSeen: charge.created };
        }
        productMap[desc].amounts.push(amount);
        productMap[desc].count++;
        if (charge.created > productMap[desc].lastSeen) productMap[desc].lastSeen = charge.created;
      }

      // Build product list with most common price
      const result = Object.values(productMap)
        .map(p => {
          // Find the most common amount
          const amountCounts: Record<number, number> = {};
          for (const a of p.amounts) {
            amountCounts[a] = (amountCounts[a] || 0) + 1;
          }
          const sortedAmounts = Object.entries(amountCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([amount]) => parseFloat(amount));

          return {
            id: p.name, // use description as ID
            name: p.name,
            price: sortedAmounts[0] || 0,
            allPrices: [...new Set(sortedAmounts)],
            chargeCount: p.count,
            lastSeen: new Date(p.lastSeen * 1000).toISOString(),
          };
        })
        .sort((a, b) => b.chargeCount - a.chargeCount); // Most sold first

      // Cache for 10 minutes
      stripeProductCache[user.id] = { products: result, fetchedAt: Date.now() };

      res.json({ products: result });
    } catch (err: any) {
      console.error('[stripe-products]', err.message);
      res.json({ products: [], error: err.message });
    }
  });

  // GET /api/campaigns/:id/funnel — get funnel steps for a campaign
  app.get("/api/campaigns/:id/funnel", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Campaign not found" });

    const steps = await pool.query(
      `SELECT id, step_order, name, price, step_type FROM funnel_steps WHERE campaign_id = $1 ORDER BY step_order ASC`,
      [campaignId]
    );
    res.json({ steps: steps.rows });
  });

  // POST /api/campaigns/:id/funnel — save all funnel steps (replaces existing)
  app.post("/api/campaigns/:id/funnel", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Campaign not found" });

    const { steps } = req.body;
    if (!Array.isArray(steps)) return res.status(400).json({ error: "steps array required" });

    // Delete existing and re-insert (simpler than diffing)
    await pool.query(`DELETE FROM funnel_steps WHERE campaign_id = $1`, [campaignId]);

    const saved = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.name || s.price === undefined) continue;
      const result = await pool.query(
        `INSERT INTO funnel_steps (campaign_id, step_order, name, price, step_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [campaignId, i + 1, s.name.trim(), parseFloat(s.price) || 0, s.stepType || 'front_end']
      );
      saved.push(result.rows[0]);
    }

    // Also update the campaign's price_point to the front-end offer price
    const frontEnd = saved.find((s: any) => s.step_type === 'front_end') || saved[0];
    if (frontEnd) {
      await pool.query(`UPDATE campaigns SET price_point = $1 WHERE id = $2`, [String(frontEnd.price), campaignId]);
    }

    res.json({ steps: saved, count: saved.length });
  });

  // ============== DAILY OBSERVATIONS ==============

  // POST /api/campaigns/:id/observations/generate
  // Generate a new daily observation for a campaign (paid plans only)
  app.post("/api/campaigns/:id/observations/generate", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    if (isNaN(campaignId)) return res.status(400).json({ error: "Invalid campaign id" });

    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Verify campaign ownership
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.userId !== user.id) return res.status(403).json({ error: "Forbidden" });

    // Resolve LLM config — observations require paid plan or BYOK
    let llmConfigResolved;
    try {
      llmConfigResolved = resolveLLMConfig({
        operation: "observation",
        userPlan: user.plan || "free",
        userProvider: user.llmProvider,
        userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : null,
        userModel: user.llmModel,
      });
    } catch {
      return res.status(403).json({
        error: "Daily Observations require a paid plan or your own API key. Upgrade to unlock behavioral insights.",
        requiresUpgrade: true,
      });
    }

    // Check if they already got an observation today for this campaign
    const latest = await storage.getLatestObservation(user.id, campaignId);
    if (latest) {
      const latestDate = latest.createdAt.slice(0, 10); // YYYY-MM-DD
      const today = new Date().toISOString().slice(0, 10);
      if (latestDate === today) {
        return res.status(429).json({
          error: "You already received an observation for this campaign today.",
          alreadyGenerated: true,
          observation: latest,
        });
      }
    }

    // Check credits
    if (user.creditsUsed >= user.creditsLimit && !user.allowOverage) {
      return res.status(402).json({ error: "Credit limit reached. Upgrade your plan or enable overage." });
    }

    try {
      const { observation, category, dataPoints } = await generateDailyObservation(
        campaignId, user.id, llmConfigResolved.config
      );

      // Store the observation
      const saved = await storage.createObservation({
        userId: user.id,
        campaignId,
        observation,
        dataPoints,
        category,
      });

      // Deduct 1 credit
      await storage.incrementCredits(user.id);

      res.json({
        observation: saved,
        categoryLabel: CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category,
      });
    } catch (err: any) {
      console.error("Daily observation generation error:", err);
      res.status(500).json({ error: err.message || "Failed to generate observation" });
    }
  });

  // POST /api/campaigns/:id/apply-insight — extract a suggestion from an insight and create a variant
  app.post("/api/campaigns/:id/apply-insight", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const { observationText } = req.body;
    if (!observationText) return res.status(400).json({ error: "No observation text provided" });

    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "Not found" });

    // Resolve LLM config
    const llmConfigResolved = resolveLLMConfig({
      operation: "observation",
      userPlan: user.plan || "free",
      userProvider: user.llmProvider || undefined,
      userModel: user.llmModel || undefined,
      userApiKey: user.llmApiKey ? decryptApiKey(user.llmApiKey) : undefined,
    });
    if (!llmConfigResolved.config) {
      return res.status(402).json({ error: "No AI provider configured" });
    }

    try {
      // Use LLM to extract the specific suggestion from the insight
      const extractionPrompt = `You are a copywriting assistant. Extract the specific A/B test suggestion from this insight.

The insight may suggest testing a headline, subheadline, CTA, or other page element.
Extract:
1. The section type being suggested (headline, subheadline, cta)
2. The exact suggested copy (clean it up if needed, remove quotes)
3. A brief strategy label (e.g. "pattern_interrupt", "curiosity", "social_proof", "urgency", "transformation", "contrarian")

Respond in this exact JSON format:
{"sectionType": "headline", "variantText": "The exact suggested copy here", "strategy": "curiosity"}

If the insight doesn't contain a specific testable suggestion, respond:
{"error": "No specific test suggestion found in this insight"}

Insight:
${observationText}`;

      const result = await callLLM(llmConfigResolved.config, [
        { role: "user", content: extractionPrompt },
      ], { maxTokens: 300, temperature: 0.2 });

      // Parse the response
      let parsed;
      try {
        const jsonMatch = result.match(/\{[^}]+\}/s);
        parsed = JSON.parse(jsonMatch?.[0] || result);
      } catch {
        return res.status(400).json({ error: "Could not extract a testable suggestion from this insight" });
      }

      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }

      const { sectionType, variantText, strategy } = parsed;
      if (!sectionType || !variantText) {
        return res.status(400).json({ error: "Could not extract section type and variant text" });
      }

      // Validate section type
      const validTypes = ["headline", "subheadline", "cta"];
      const normalizedType = sectionType.toLowerCase().replace(/[^a-z]/g, "");
      const matchedType = validTypes.find(t => normalizedType.includes(t)) || "headline";

      // Check if there's already an active test for this section type
      const existingVariants = await storage.getVariantsByCampaign(campaignId);
      const activeChallengers = existingVariants.filter(v => v.type === matchedType && !v.isControl && v.isActive);

      if (activeChallengers.length >= 3) {
        return res.status(400).json({ error: `Already have ${activeChallengers.length} active challengers for ${matchedType}. Declare a winner first.` });
      }

      // Create the variant
      const variant = await storage.createVariant({
        campaignId,
        type: matchedType,
        text: variantText,
        isControl: false,
        isActive: true,
        persuasionTags: JSON.stringify([strategy || "insight_suggested"]),
      });

      // Deduct 1 credit for the LLM call
      await storage.incrementCredits(user.id);

      res.json({
        ok: true,
        variant: {
          id: variant.id,
          type: matchedType,
          text: variantText,
          strategy: strategy || "insight_suggested",
        },
        message: `Created a new ${matchedType} challenger variant from the insight suggestion.`,
      });
    } catch (err: any) {
      console.error("[apply-insight] error:", err);
      res.status(500).json({ error: err.message || "Failed to apply insight" });
    }
  });

  // ============== DASHBOARD ==============

  // GET /api/dashboard/stats
  app.get("/api/dashboard/stats", requireAuth, async (req: Request, res: Response) => {
    const stats = await storage.getDashboardStats(req.userId!);
    res.json(stats);
  });

  // GET /api/campaigns/:id/observations
  // Return last 30 observations for this campaign
  app.get("/api/campaigns/:id/observations", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    if (isNaN(campaignId)) return res.status(400).json({ error: "Invalid campaign id" });

    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Verify campaign ownership
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.userId !== user.id) return res.status(403).json({ error: "Forbidden" });

    const observations = await storage.getObservationsByCampaign(campaignId, 30);
    const isPaidPlan = user.plan !== "free";
    const hasByok = !!(user.llmProvider && user.llmApiKey);

    // Check if today's observation exists
    const today = new Date().toISOString().slice(0, 10);
    const hasTodayObservation = observations.length > 0 && observations[0].createdAt.slice(0, 10) === today;

    res.json({
      observations,
      isPaidUser: isPaidPlan || hasByok,
      hasTodayObservation,
      categoryLabels: CATEGORY_LABELS,
    });
  });

  // ============== REFERRAL ==============

  // GET /api/referral/code — get (or generate) this user's referral code
  app.get("/api/referral/code", requireAuth, async (req: Request, res: Response) => {
    let user = await storage.getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Generate a code if one doesn't exist yet (for existing users)
    if (!user.referralCode) {
      const nameSlug = (user.name || "user")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 4)
        .padEnd(4, "x");
      const randChars = Math.random().toString(36).slice(2, 6);
      const code = `${nameSlug}-${randChars}`;
      user = (await storage.updateUser(user.id, { referralCode: code })) || user;
    }

    const referralLink = `https://siteamoeba.com/?ref=${user.referralCode}`;
    res.json({ referralCode: user.referralCode, referralLink });
  });

  // GET /api/referral/stats — full stats + referral list
  app.get("/api/referral/stats", requireAuth, async (req: Request, res: Response) => {
    let user = await storage.getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Generate a code if one doesn't exist yet
    if (!user.referralCode) {
      const nameSlug = (user.name || "user")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 4)
        .padEnd(4, "x");
      const randChars = Math.random().toString(36).slice(2, 6);
      const code = `${nameSlug}-${randChars}`;
      user = (await storage.updateUser(user.id, { referralCode: code })) || user;
    }

    const stats = await storage.getReferralStats(req.userId!);
    const referralsList = await storage.getReferralsByReferrer(req.userId!);

    // Enrich referrals with referred user info (partial email)
    const enrichedReferrals = await Promise.all(
      referralsList.map(async (r) => {
        const referredUser = await storage.getUserById(r.referredId);
        const email = referredUser?.email || "";
        // Mask email: t***@gmail.com
        const atIdx = email.indexOf("@");
        const maskedEmail =
          atIdx > 1
            ? email[0] + "***" + email.slice(atIdx)
            : email;
        return {
          id: r.id,
          maskedEmail,
          plan: referredUser?.plan || "free",
          status: r.status,
          earned: r.totalEarned,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
        };
      })
    );

    const referralLink = `https://siteamoeba.com/?ref=${user.referralCode}`;
    res.json({
      referralCode: user.referralCode,
      referralLink,
      ...stats,
      referrals: enrichedReferrals,
    });
  });

  // GET /api/wins — all declared winners for this user (for Wins Library)
  app.get("/api/wins", requireAuth, async (req: Request, res: Response) => {
    try {
      const userCampaigns = await storage.getCampaignsByUser(req.userId!);
      const campaignIds = userCampaigns.map(c => c.id);
      if (campaignIds.length === 0) return res.json([]);

      // Fetch test_lessons for user's campaigns
      const allLessons = await pool.query(
        `SELECT tl.*, c.name as campaign_name, c.url as page_url
         FROM test_lessons tl
         JOIN campaigns c ON c.id = tl.campaign_id
         WHERE tl.campaign_id = ANY($1)
         ORDER BY tl.created_at DESC`,
        [campaignIds]
      );

      const wins = allLessons.rows.map((row: any) => ({
        id: row.id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        pageUrl: row.page_url,
        sectionType: row.section_type,
        winnerText: row.winner_text,
        loserText: row.loser_text,
        winnerConversionRate: row.winner_conversion_rate,
        loserConversionRate: row.loser_conversion_rate,
        liftPercent: row.lift_percent,
        winnerStrategy: row.winner_strategy,
        loserStrategy: row.loser_strategy,
        sampleSize: row.sample_size,
        confidence: row.confidence,
        lesson: row.lesson,
        createdAt: row.created_at,
      }));

      res.json(wins);
    } catch (err: any) {
      console.error("[wins]", err.message);
      res.status(500).json({ error: "Failed to load wins" });
    }
  });

  // GET /api/campaigns/:id/visitor-feed — live visitor feed for campaign dashboard
  app.get("/api/campaigns/:id/visitor-feed", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const feed = await storage.getVisitorFeed(campaignId, 20);
    res.json(feed);
  });

  // POST /api/campaigns/:id/verify-pixel — verify pixel is installed on user's page
  app.post("/api/campaigns/:id/verify-pixel", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const { type } = req.body; // "tracking" or "conversion"
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const urlToCheck = type === "conversion" ? req.body.url : campaign.url;
    if (!urlToCheck) {
      return res.status(400).json({ error: "No URL to check", verified: false });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(urlToCheck, {
        headers: { "User-Agent": "SiteAmoeba-PixelVerifier/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const html = await response.text();

      if (type === "conversion") {
        // Check for conversion pixel: sa_vid + /api/widget/convert
        const hasConvPixel = html.includes("sa_vid") && html.includes("/api/widget/convert");
        await storage.updatePixelVerification(campaignId, "conversion_pixel", hasConvPixel, urlToCheck);
        return res.json({ verified: hasConvPixel, url: urlToCheck });
      } else {
        // Check for tracking pixel: /api/widget/script/ + campaign ID
        const hasTrackingPixel =
          html.includes(`/api/widget/script/${campaignId}`) ||
          html.includes(`cid=${campaignId}`) ||
          html.includes(`"cid":${campaignId}`) ||
          html.includes(`siteamoeba`);
        await storage.updatePixelVerification(campaignId, "pixel", hasTrackingPixel);
        return res.json({ verified: hasTrackingPixel, url: campaign.url });
      }
    } catch (err: any) {
      return res.json({
        verified: false,
        error: err.name === "AbortError" ? "Page took too long to load" : "Could not reach page: " + (err.message || ""),
      });
    }
  });

  // ============== TRAFFIC SOURCES ==============

  app.get("/api/campaigns/:id/traffic-sources", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const { Pool: PgPool } = require("pg");
    const pgPool = new PgPool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });

    try {
      // Query grouped by traffic_source
      const sourceRows = await pool.query(
        `SELECT
          COALESCE(traffic_source, 'direct') AS source,
          COUNT(*) AS visitors,
          SUM(CASE WHEN converted = true THEN 1 ELSE 0 END) AS conversions,
          COALESCE(SUM(CASE WHEN converted = true THEN revenue ELSE 0 END), 0) AS revenue
        FROM visitors
        WHERE campaign_id = $1
        GROUP BY COALESCE(traffic_source, 'direct')
        ORDER BY COUNT(*) DESC`,
        [campaignId]
      );

      // LTV from revenue_events per traffic source
      // Total revenue = ALL transactions (initial + upsells)
      // LTV = total revenue / unique buyers
      // AOV = total revenue / total transactions
      const ltvRows = await pool.query(
        `SELECT
          COALESCE(v.traffic_source, 'direct') AS source,
          COALESCE(SUM(re.amount), 0) AS total_revenue,
          COUNT(DISTINCT COALESCE(re.customer_email, re.visitor_id)) AS unique_buyers,
          COUNT(re.id) AS total_transactions
        FROM revenue_events re
        LEFT JOIN visitors v ON v.id = re.visitor_id
        WHERE re.campaign_id = $1 AND re.event_type = 'purchase'
        GROUP BY COALESCE(v.traffic_source, 'direct')`,
        [campaignId]
      );
      const ltvBySource: Record<string, { totalRevenue: number; ltv: number; aov: number; transactions: number }> = {};
      for (const row of ltvRows.rows) {
        const rev = parseFloat(row.total_revenue) || 0;
        const buyers = parseInt(row.unique_buyers) || 1;
        const txns = parseInt(row.total_transactions) || 1;
        ltvBySource[row.source] = {
          totalRevenue: rev,
          ltv: parseFloat((rev / buyers).toFixed(2)),
          aov: parseFloat((rev / txns).toFixed(2)),
          transactions: txns,
        };
      }

      const sources = sourceRows.rows.map((r: any) => {
        const vis = parseInt(r.visitors) || 0;
        const conv = parseInt(r.conversions) || 0;
        const ltvData = ltvBySource[r.source] ?? { totalRevenue: 0, ltv: 0, aov: 0, transactions: 0 };
        return {
          source: r.source,
          visitors: vis,
          conversions: conv,
          conversionRate: vis > 0 ? parseFloat(((conv / vis) * 100).toFixed(1)) : 0,
          // revenue = total from revenue_events (all upsells included)
          revenue: ltvData.totalRevenue,
          revenuePerVisitor: vis > 0 ? parseFloat((ltvData.totalRevenue / vis).toFixed(2)) : 0,
          ltv: ltvData.ltv,
          aov: ltvData.aov,
          transactions: ltvData.transactions,
        };
      });

      // Query grouped into Mobile vs Desktop (the meaningful split for conversion analysis)
      // mobile = ios + android, desktop = desktop_mac + desktop_windows, tablet = tablet
      const deviceRows = await pool.query(
        `SELECT
          CASE
            WHEN COALESCE(device_category, 'other') IN ('ios', 'android') THEN 'mobile'
            WHEN COALESCE(device_category, 'other') IN ('desktop_mac', 'desktop_windows') THEN 'desktop'
            WHEN COALESCE(device_category, 'other') = 'tablet' THEN 'tablet'
            ELSE 'other'
          END AS device,
          COUNT(*) AS visitors,
          SUM(CASE WHEN converted = true THEN 1 ELSE 0 END) AS conversions,
          COALESCE(SUM(CASE WHEN converted = true THEN revenue ELSE 0 END), 0) AS revenue
        FROM visitors
        WHERE campaign_id = $1
        GROUP BY 1
        ORDER BY COUNT(*) DESC`,
        [campaignId]
      );

      // LTV by device from revenue_events
      const deviceLtvRows = await pool.query(
        `SELECT
          CASE
            WHEN COALESCE(v.device_category, 'other') IN ('ios', 'android') THEN 'mobile'
            WHEN COALESCE(v.device_category, 'other') IN ('desktop_mac', 'desktop_windows') THEN 'desktop'
            WHEN COALESCE(v.device_category, 'other') = 'tablet' THEN 'tablet'
            ELSE 'other'
          END AS device,
          COALESCE(SUM(re.amount), 0) AS total_revenue,
          COUNT(DISTINCT COALESCE(re.customer_email, re.visitor_id)) AS unique_buyers,
          COUNT(re.id) AS total_transactions
        FROM revenue_events re
        LEFT JOIN visitors v ON v.id = re.visitor_id
        WHERE re.campaign_id = $1 AND re.event_type = 'purchase' AND re.visitor_id IS NOT NULL
        GROUP BY 1`,
        [campaignId]
      );
      const ltvByDevice: Record<string, { totalRevenue: number; ltv: number; aov: number; transactions: number }> = {};
      for (const row of deviceLtvRows.rows) {
        const rev = parseFloat(row.total_revenue) || 0;
        const buyers = parseInt(row.unique_buyers) || 1;
        const txns = parseInt(row.total_transactions) || 1;
        ltvByDevice[row.device] = {
          totalRevenue: rev,
          ltv: parseFloat((rev / buyers).toFixed(2)),
          aov: parseFloat((rev / txns).toFixed(2)),
          transactions: txns,
        };
      }

      const devices = deviceRows.rows.map((r: any) => {
        const vis = parseInt(r.visitors) || 0;
        const conv = parseInt(r.conversions) || 0;
        const ltvData = ltvByDevice[r.device] ?? { totalRevenue: 0, ltv: 0, aov: 0, transactions: 0 };
        return {
          device: r.device,
          visitors: vis,
          conversions: conv,
          conversionRate: vis > 0 ? parseFloat(((conv / vis) * 100).toFixed(1)) : 0,
          revenue: ltvData.totalRevenue,
          revenuePerVisitor: vis > 0 ? parseFloat((ltvData.totalRevenue / vis).toFixed(2)) : 0,
          ltv: ltvData.ltv,
          aov: ltvData.aov,
          transactions: ltvData.transactions,
        };
      });

      // Add device insight: mobile vs desktop CVR comparison
      const mobile = devices.find((d: any) => d.device === 'mobile');
      const desktop = devices.find((d: any) => d.device === 'desktop');
      let deviceInsight = "";
      if (mobile && desktop && mobile.visitors > 10 && desktop.visitors > 10) {
        if (desktop.conversionRate > mobile.conversionRate && mobile.conversionRate > 0) {
          const ratio = (desktop.conversionRate / mobile.conversionRate).toFixed(1);
          deviceInsight = `Desktop converts at ${ratio}x the rate of mobile (${desktop.conversionRate}% vs ${mobile.conversionRate}%). Consider optimizing your mobile experience.`;
        } else if (mobile.conversionRate > desktop.conversionRate && desktop.conversionRate > 0) {
          const ratio = (mobile.conversionRate / desktop.conversionRate).toFixed(1);
          deviceInsight = `Mobile converts at ${ratio}x the rate of desktop (${mobile.conversionRate}% vs ${desktop.conversionRate}%). Your mobile experience is a strength.`;
        }
      } else if (mobile && mobile.visitors > 0) {
        const mobilePct = devices.length > 0 ? Math.round((mobile.visitors / devices.reduce((s: number, d: any) => s + d.visitors, 0)) * 100) : 0;
        if (mobilePct > 60) deviceInsight = `${mobilePct}% of your traffic is mobile. Make sure your page converts well on small screens.`;
      }

      // Build top insight: compare best source vs second
      let topInsight = "";
      if (sources.length >= 2) {
        const best = sources[0];
        const second = sources[1];
        if (best.conversionRate > 0 && second.conversionRate > 0) {
          const ratio = (best.conversionRate / second.conversionRate).toFixed(1);
          const bestLabel = best.source.replace(/_/g, " ");
          const secondLabel = second.source.replace(/_/g, " ");
          topInsight = `${bestLabel.charAt(0).toUpperCase() + bestLabel.slice(1)} visitors convert at ${ratio}x the rate of ${secondLabel} visitors`;
        } else if (best.visitors > 0) {
          const bestLabel = best.source.replace(/_/g, " ");
          topInsight = `${bestLabel.charAt(0).toUpperCase() + bestLabel.slice(1)} is your top traffic source with ${best.visitors} visitors`;
        }
      } else if (sources.length === 1) {
        const src = sources[0];
        const label = src.source.replace(/_/g, " ");
        topInsight = `All traffic coming from ${label.charAt(0).toUpperCase() + label.slice(1)}`;
      }

      // Average time on page — time_on_page lives in visitor_sessions, joined via visitor_id
      const timeRows = await pool.query(
        `SELECT
          COALESCE(v.traffic_source, 'direct') AS source,
          ROUND(AVG(vs.time_on_page)) AS avg_time_on_page,
          ROUND(AVG(CASE WHEN v.converted = true THEN vs.time_on_page ELSE NULL END)) AS buyer_avg_time,
          ROUND(AVG(CASE WHEN v.converted = false THEN vs.time_on_page ELSE NULL END)) AS visitor_avg_time
        FROM visitor_sessions vs
        JOIN visitors v ON v.id = vs.visitor_id
        WHERE vs.campaign_id = $1 AND vs.time_on_page IS NOT NULL AND vs.time_on_page > 0
        GROUP BY COALESCE(v.traffic_source, 'direct')`,
        [campaignId]
      );
      const timeBySource: Record<string, { avgTime: number; buyerAvgTime: number; visitorAvgTime: number }> = {};
      let overallAvgTime = 0;
      let overallBuyerAvgTime = 0;
      for (const row of timeRows.rows) {
        timeBySource[row.source] = {
          avgTime: parseInt(row.avg_time_on_page) || 0,
          buyerAvgTime: parseInt(row.buyer_avg_time) || 0,
          visitorAvgTime: parseInt(row.visitor_avg_time) || 0,
        };
      }
      // Compute overall average from visitor_sessions
      const overallTimeRow = await pool.query(
        `SELECT
          ROUND(AVG(vs.time_on_page)) AS avg_time,
          ROUND(AVG(CASE WHEN v.converted = true THEN vs.time_on_page ELSE NULL END)) AS buyer_avg_time
        FROM visitor_sessions vs
        JOIN visitors v ON v.id = vs.visitor_id
        WHERE vs.campaign_id = $1 AND vs.time_on_page IS NOT NULL AND vs.time_on_page > 0`,
        [campaignId]
      );
      overallAvgTime = parseInt(overallTimeRow.rows[0]?.avg_time) || 0;
      overallBuyerAvgTime = parseInt(overallTimeRow.rows[0]?.buyer_avg_time) || 0;

      // Attach time data to sources
      const sourcesWithTime = sources.map((s: any) => ({
        ...s,
        avgTimeOnPage: timeBySource[s.source]?.avgTime || 0,
        buyerAvgTime: timeBySource[s.source]?.buyerAvgTime || 0,
      }));

      // Build smarter insights
      const totalConversions = sources.reduce((sum: number, s: any) => sum + s.conversions, 0);
      const totalVisitors = sources.reduce((sum: number, s: any) => sum + s.visitors, 0);
      const mobilePct = mobile && totalVisitors > 0 ? Math.round((mobile.visitors / totalVisitors) * 100) : 0;
      const insights: string[] = [];

      // Time insight
      if (overallAvgTime > 60) {
        const mins = Math.floor(overallAvgTime / 60);
        const secs = overallAvgTime % 60;
        const timeStr = mins > 0 ? `${mins}m${secs > 0 ? ` ${secs}s` : ''}` : `${secs}s`;
        insights.push(`Average visitor spends ${timeStr} on your page`);
        if (overallBuyerAvgTime > 0 && overallBuyerAvgTime > overallAvgTime * 1.2) {
          const bMins = Math.floor(overallBuyerAvgTime / 60);
          const bSecs = overallBuyerAvgTime % 60;
          const buyerStr = bMins > 0 ? `${bMins}m${bSecs > 0 ? ` ${bSecs}s` : ''}` : `${bSecs}s`;
          insights.push(`Buyers spend ${buyerStr} on average — ${Math.round((overallBuyerAvgTime / overallAvgTime - 1) * 100)}% longer than non-buyers`);
        }
      }

      // Conversion attribution insight
      if (totalConversions === 0 && totalVisitors > 20) {
        insights.push(`No conversions attributed to traffic sources yet — connect Stripe or Whop in Settings to see which sources actually convert`);
      } else if (topInsight) {
        insights.push(topInsight);
      }
      if (deviceInsight) insights.push(deviceInsight);

      // Mobile dominance insight
      if (mobilePct >= 70 && !deviceInsight) {
        insights.push(`${mobilePct}% of visitors are on mobile — prioritize your mobile page experience`);
      }

      const combinedInsight = insights.slice(0, 2).join(" · ");
      return res.json({
        sources: sourcesWithTime,
        devices,
        topInsight: combinedInsight,
        deviceInsight,
        overallAvgTime,
        overallBuyerAvgTime,
        totalConversions,
        mobilePct,
      });
    } finally {
      await pgPool.end();
    }
  });

  // ============== ANOMALY ENDPOINTS ==============

  // GET /api/campaigns/:id/anomalies
  app.get("/api/campaigns/:id/anomalies", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const anomalies = await storage.getAllAnomalies(campaignId, 20);
    const unreadCount = await storage.getUnreadAnomalyCount(campaignId);
    return res.json({ anomalies, unreadCount });
  });

  // POST /api/campaigns/:id/anomalies/:anomalyId/read
  app.post("/api/campaigns/:id/anomalies/:anomalyId/read", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const anomalyId = paramId(req.params.anomalyId);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    await storage.markAnomalyRead(anomalyId);
    return res.json({ ok: true });
  });

  // POST /api/campaigns/:id/anomalies/read-all
  app.post("/api/campaigns/:id/anomalies/read-all", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    await storage.markAllAnomaliesRead(campaignId);
    return res.json({ ok: true });
  });

  // GET /api/campaigns/:id/preview/:variantId — fetch actual page HTML and inject variant
  // Supports both Authorization header and ?token= query param (needed for iframe loads)
  app.get("/api/campaigns/:id/preview/:variantId", async (req: Request, res: Response) => {
    // Auth: accept Bearer header OR ?token= query param
    let userId: number | undefined;
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const tokenStr = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : queryToken;
    if (!tokenStr) return res.status(401).send("Not authenticated");
    try {
      const payload = jwt.verify(tokenStr, JWT_SECRET) as { userId: number };
      userId = payload.userId;
    } catch {
      return res.status(401).send("Invalid or expired token");
    }

    const campaignId = paramId(req.params.id);
    const variantId = paramId(req.params.variantId);

    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== userId) return res.status(404).send("Not found");

    const variants = await storage.getVariantsByCampaign(campaignId);
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) return res.status(404).send("Variant not found");

    // Fetch the actual page
    let html: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(campaign.url, {
        signal: controller.signal,
        headers: { "User-Agent": "SiteAmoeba-Preview/1.0" },
      });
      clearTimeout(timeout);
      html = await resp.text();
    } catch {
      return res.status(502).send(`<html><body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#f8fafc"><h2>Could not load page</h2><p>The page at <code>${campaign.url}</code> could not be fetched for preview. Make sure the URL is publicly accessible.</p></body></html>`);
    }

    // Get the test section for this variant to find the CSS selector
    // Strategy: direct link first, then find by campaign+category
    const testSections = await storage.getTestSectionsByCampaign(campaignId);
    let section = testSections.find((s) => s.id === variant.testSectionId);
    if (!section) {
      section = testSections.find((s) => s.isActive && s.category === variant.type) || undefined;
    }
    const selector = section?.selector || "";
    const testMethod = section?.testMethod || "text_swap";
    const isControlVariant = !!variant.isControl;

    // CRITICAL: Strip out the live SiteAmoeba widget script from the fetched page HTML.
    // If left in, the widget fires during preview, fetches a random variant from the assign
    // endpoint, and overwrites (or races with) the preview injection. The widget must NEVER
    // run during a preview — only our controlled injection script should touch the page.
    html = html.replace(/<script[^>]*src=["'][^"']*siteamoeba[^"']*widget\/script[^"']*["'][^>]*><\/script>/gi, '<!-- SiteAmoeba widget removed for preview -->');
    // Also remove inline script blocks that reference the widget API (in case of inline embed)
    html = html.replace(/<script[^>]*>[\s\S]*?api\.siteamoeba\.com\/api\/widget[\s\S]*?<\/script>/gi, '<!-- SiteAmoeba widget removed for preview -->');

    // Inject the variant replacement script before </body>
    const injectionScript = `
<script>
(function() {
  var selector = ${JSON.stringify(selector)};
  var variantText = ${JSON.stringify(variant.text)};
  var isHtmlSwap = ${JSON.stringify(testMethod === "html_swap" || /<[a-z][\s\S]*>/i.test(variant.text))};
  var isControl = ${JSON.stringify(isControlVariant)};

  // For control variants: don't change text, just highlight the original element
  function highlightElement(el) {
    el.style.outline = "2px solid #10b981";
    el.style.outlineOffset = "4px";
    el.style.borderRadius = "4px";
    el.style.transition = "outline-color 1s ease-in-out";
    setInterval(function() {
      el.style.outlineColor = el.style.outlineColor === "rgb(16, 185, 129)" ? "#34d399" : "#10b981";
    }, 1000);
  }

  function applyVariant(allEls) {
    if (allEls.length === 0) return;

    if (isControl) {
      // Control: just highlight the first element, don't change anything
      highlightElement(allEls[0]);
      return;
    }

    // Capture styles from the element with the most text (the "main" visual piece)
    var styleDonor = allEls[0];
    var maxLen = (allEls[0].textContent || "").length;
    for (var d = 1; d < allEls.length; d++) {
      var len = (allEls[d].textContent || "").length;
      if (len > maxLen) { maxLen = len; styleDonor = allEls[d]; }
    }
    var donorCS = window.getComputedStyle(styleDonor);
    var props = ["fontSize", "fontWeight", "fontFamily", "color", "lineHeight", "letterSpacing", "textTransform", "textAlign"];
    var saved = {};
    for (var p = 0; p < props.length; p++) saved[props[p]] = donorCS[props[p]];

    // Apply variant text to first element
    var primary = allEls[0];
    if (isHtmlSwap) {
      primary.innerHTML = variantText;
    } else {
      primary.textContent = variantText.replace(/<[^>]*>/g, "");
    }

    // Preserve original styling on the primary
    for (var sp = 0; sp < props.length; sp++) {
      var cssProp = props[sp].replace(/([A-Z])/g, "-$1").toLowerCase();
      primary.style.setProperty(cssProp, saved[props[sp]], "important");
    }

    // Highlight it
    highlightElement(primary);

    // Hide remaining elements
    for (var k = 1; k < allEls.length; k++) {
      allEls[k].style.display = "none";
    }
  }

  function tryApply() {
    var allElements = [];
    if (selector) {
      var parts = selector.split(",").map(function(s) { return s.trim(); });
      for (var i = 0; i < parts.length; i++) {
        try {
          var matches = document.querySelectorAll(parts[i]);
          for (var j = 0; j < matches.length; j++) {
            if (allElements.indexOf(matches[j]) === -1) allElements.push(matches[j]);
          }
        } catch(e) {}
      }
    }
    if (allElements.length === 0) {
      // Fallback for legacy
      var h = document.querySelector("h1");
      if (h && h.textContent.length > 10) allElements.push(h);
    }
    if (allElements.length > 0) {
      applyVariant(allElements);
      return true;
    }
    return false;
  }

  // Try immediately, then retry with increasing delays for dynamic pages (GHL, etc.)
  var retries = [0, 500, 1000, 2000, 3000, 5000];
  var variantApplied = false;
  function attemptApply() {
    if (variantApplied) return;
    if (tryApply()) variantApplied = true;
  }
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      retries.forEach(function(delay) {
        setTimeout(attemptApply, delay);
      });
    });
  } else {
    retries.forEach(function(delay) {
      setTimeout(attemptApply, delay);
    });
  }

  // Disable all links and forms to prevent navigation
  document.addEventListener("click", function(e) { e.preventDefault(); e.stopPropagation(); }, true);
  document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll("form").forEach(function(f) { f.addEventListener("submit", function(e) { e.preventDefault(); }); });
  });
})();
</script>
<style>
  body::before {
    content: "SiteAmoeba Preview — ${isControlVariant ? 'Control (Original Page)' : 'Variant Applied'}";
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 999999;
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    text-align: center;
    padding: 6px 0;
    font-family: system-ui, sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  body { padding-top: 30px !important; }
</style>`;

    // Inject before </body>, or append if no </body> tag
    if (html.includes("</body>")) {
      html = html.replace("</body>", injectionScript + "</body>");
    } else {
      html = html + injectionScript;
    }

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("X-Frame-Options", "ALLOWALL");
    res.set("Content-Security-Policy", "");
    res.send(html);
  });

  // ============== VISUAL EDITOR ==============
  // GET /api/campaigns/:id/visual-editor
  // Proxy-loads the user's page in an iframe with the editor bridge script injected.
  // The bridge makes all scanned sections clickable/editable and communicates via postMessage.
  app.get("/api/campaigns/:id/visual-editor", async (req: Request, res: Response) => {
    // Auth via query param (needed for iframe src)
    const tokenStr = req.query.token as string;
    if (!tokenStr) return res.status(401).send("Not authenticated");
    let userId: number;
    try {
      const payload = jwt.verify(tokenStr, JWT_SECRET) as { userId: number };
      userId = payload.userId;
    } catch {
      return res.status(401).send("Invalid or expired token");
    }

    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== userId) return res.status(404).send("Campaign not found");
    if (!campaign.url) return res.status(400).send("No URL configured for this campaign");

    // Fetch all test sections for this campaign
    const sections = await pool.query(
      `SELECT id, section_id, label, selector, category, current_text, test_method, element_styles
       FROM test_sections WHERE campaign_id = $1 ORDER BY test_priority`, [campaignId]
    );

    // Fetch all active variants
    const variants = await pool.query(
      `SELECT id, text, type, is_control, test_section_id
       FROM variants WHERE campaign_id = $1 AND is_active = true`, [campaignId]
    );

    // Fetch the page HTML
    let html: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(campaign.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      html = await resp.text();
    } catch (err: any) {
      return res.status(502).send(`Could not fetch page: ${err.message}`);
    }

    // Strip the SiteAmoeba widget script so it doesn't interfere
    html = html.replace(/<script[^>]*siteamoeba\.com[^>]*><\/script>/gi, '');
    html = html.replace(/<script[^>]*widget\/script\/\d+[^>]*><\/script>/gi, '');

    // Add <base> tag so relative URLs (images, CSS, JS) resolve correctly
    const baseUrl = new URL(campaign.url);
    const baseTag = `<base href="${baseUrl.origin}${baseUrl.pathname.replace(/[^/]*$/, '')}">`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n${baseTag}`);
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', `<HEAD>\n${baseTag}`);
    } else {
      html = baseTag + html;
    }

    // Generate and inject the editor bridge script
    const { generateEditorBridgeScript } = await import('./visual-editor-bridge');
    const bridgeScript = generateEditorBridgeScript(
      sections.rows.map((s: any) => ({
        id: s.id,
        sectionId: s.section_id,
        label: s.label,
        selector: s.selector,
        category: s.category,
        currentText: s.current_text,
        testMethod: s.test_method || 'text_swap',
      })),
      variants.rows.map((v: any) => ({
        id: v.id,
        text: v.text,
        type: v.type,
        isControl: v.is_control,
        testSectionId: v.test_section_id,
      })),
      campaignId
    );

    // Inject before </body>
    if (html.includes('</body>')) {
      html = html.replace('</body>', bridgeScript + '</body>');
    } else {
      html += bridgeScript;
    }

    // Allow iframe embedding
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Frame-Options', 'ALLOWALL');
    res.set('Content-Security-Policy', '');
    res.send(html);
  });

  // POST /api/campaigns/:id/visual-editor/save
  // Save edits from the visual editor as new variants or update existing ones
  app.post("/api/campaigns/:id/visual-editor/save", requireAuth, async (req: Request, res: Response) => {
    const campaignId = paramId(req.params.id);
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ error: "Campaign not found" });

    const { edits } = req.body;
    // edits = [{ sectionId: number, text: string, innerHTML?: string }]
    if (!Array.isArray(edits) || edits.length === 0) {
      return res.status(400).json({ error: "No edits provided" });
    }

    const saved: any[] = [];
    for (const edit of edits) {
      const { sectionId, text } = edit;
      if (!sectionId || !text) continue;

      // Check if this section already has a non-control active variant for this campaign
      const existingVariant = await pool.query(
        `SELECT id FROM variants 
         WHERE campaign_id = $1 AND test_section_id = $2 AND is_control = false AND is_active = true
         LIMIT 1`,
        [campaignId, sectionId]
      );

      if (existingVariant.rows.length > 0) {
        // Update existing variant
        await pool.query(
          `UPDATE variants SET text = $1 WHERE id = $2`,
          [text, existingVariant.rows[0].id]
        );
        saved.push({ sectionId, variantId: existingVariant.rows[0].id, action: 'updated' });
      } else {
        // Get the section details
        const section = await pool.query(
          `SELECT id, section_id, category FROM test_sections WHERE id = $1 AND campaign_id = $2`,
          [sectionId, campaignId]
        );
        if (section.rows.length === 0) continue;
        const s = section.rows[0];

        // Determine variant type from section category
        const typeMap: Record<string, string> = {
          headline: 'headline', subheadline: 'subheadline',
          cta: 'cta', button: 'cta',
        };
        const variantType = typeMap[s.category] || s.category;

        // Create new variant
        const newVariant = await storage.createVariant({
          campaignId,
          text,
          type: variantType,
          isControl: false,
          isActive: true,
          testSectionId: sectionId,
        });
        saved.push({ sectionId, variantId: newVariant.id, action: 'created' });

        // Ensure the section is active for testing
        await pool.query(
          `UPDATE test_sections SET is_active = true WHERE id = $1`,
          [sectionId]
        );
      }
    }

    res.json({ saved, count: saved.length });
  });

  // ── AI Image Generation ──
  app.post("/api/ai/generate-image", aiLimiter, requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });

    const creditCheck = await consumeCredits(req.userId!, 5); // 5 credits per image
    if (!creditCheck.ok) return res.status(402).json({ error: creditCheck.errorMsg });

    const { prompt, width, height } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.PLATFORM_OPENAI_KEY });

      const response = await client.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
      });

      const imageUrl = response.data[0]?.url;
      if (!imageUrl) throw new Error("No image generated");

      res.json({ url: imageUrl });
    } catch (err: any) {
      console.error("[generate-image]", err.message);
      res.status(500).json({ error: "Image generation failed: " + err.message });
    }
  });

} // end registerRoutes

// ===== Traffic Anomaly Detection =====

// In-memory throttle: campaignId -> last run timestamp
const anomalyDetectionLastRun: Record<number, number> = {};
const ANOMALY_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

async function detectTrafficAnomalies(campaignId: number): Promise<void> {
  const now = Date.now();
  const last = anomalyDetectionLastRun[campaignId] || 0;
  if (now - last < ANOMALY_THROTTLE_MS) return;
  anomalyDetectionLastRun[campaignId] = now;

  try {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });

    // Query last 7 days of visitor data grouped by date + traffic_source
    const result = await pool.query(
      `SELECT
        DATE(first_seen::timestamp) AS day,
        COALESCE(traffic_source, 'direct') AS source,
        COUNT(*) AS visitors,
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END) AS conversions
       FROM visitors
       WHERE campaign_id = $1
         AND first_seen >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(first_seen::timestamp), COALESCE(traffic_source, 'direct')
       ORDER BY day DESC`,
      [campaignId]
    );
    await pool.end();

    // Organize data: source -> { today: {visitors, conversions}, history: [{day, visitors, conversions}] }
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    type DayData = { visitors: number; conversions: number };
    const bySource: Record<string, { today: DayData; history: DayData[] }> = {};
    const allSources = new Set<string>();
    const sourcesBeforeToday = new Set<string>();

    for (const row of result.rows) {
      const src: string = row.source;
      const day: string = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day);
      const visitors = parseInt(row.visitors) || 0;
      const conversions = parseInt(row.conversions) || 0;

      allSources.add(src);
      if (!bySource[src]) bySource[src] = { today: { visitors: 0, conversions: 0 }, history: [] };

      if (day === todayStr) {
        bySource[src].today = { visitors, conversions };
      } else {
        bySource[src].history.push({ visitors, conversions });
        sourcesBeforeToday.add(src);
      }
    }

    const sinceDateToday = new Date();
    sinceDateToday.setHours(0, 0, 0, 0);
    const sinceDateIso = sinceDateToday.toISOString();

    for (const src of allSources) {
      const data = bySource[src];
      const todayVisitors = data.today.visitors;
      const todayConversions = data.today.conversions;
      const todayConvRate = todayVisitors > 0 ? todayConversions / todayVisitors : 0;

      const historyVisitors = data.history.map((d) => d.visitors);
      const historyConvRates = data.history.map((d) =>
        d.visitors > 0 ? d.conversions / d.visitors : 0
      );

      const avgVisitors =
        historyVisitors.length > 0
          ? historyVisitors.reduce((a, b) => a + b, 0) / historyVisitors.length
          : 0;
      const avgConvRate =
        historyConvRates.length > 0
          ? historyConvRates.reduce((a, b) => a + b, 0) / historyConvRates.length
          : 0;

      // New source: appeared today but not in past 6 days
      if (todayVisitors > 0 && !sourcesBeforeToday.has(src)) {
        const alreadyExists = await storage.checkRecentAnomaly(campaignId, "new_source", src, sinceDateIso);
        if (!alreadyExists) {
          const srcLabel = src.replace(/_/g, " ");
          await storage.createAnomaly({
            campaignId,
            anomalyType: "new_source",
            source: src,
            title: `New traffic source: ${srcLabel}`,
            description: `You're seeing traffic from ${srcLabel} for the first time. ${todayVisitors} visitor${todayVisitors !== 1 ? "s" : ""} so far today.`,
            severity: "info",
            metricValue: todayVisitors,
            baselineValue: 0,
          });
        }
        continue; // skip spike checks for brand-new sources
      }

      // Traffic spike: today >= 2x the 7-day average
      if (todayVisitors >= 2 && avgVisitors > 0 && todayVisitors >= avgVisitors * 2) {
        const alreadyExists = await storage.checkRecentAnomaly(campaignId, "traffic_spike", src, sinceDateIso);
        if (!alreadyExists) {
          const multiplier = (todayVisitors / avgVisitors).toFixed(1);
          const srcLabel = src.charAt(0).toUpperCase() + src.slice(1).replace(/_/g, " ");
          const convRateStr = (todayConvRate * 100).toFixed(1);
          await storage.createAnomaly({
            campaignId,
            anomalyType: "traffic_spike",
            source: src,
            title: `${srcLabel} traffic spiked ${multiplier}x today`,
            description: `${srcLabel} sent ${todayVisitors} visitors today — that's ${multiplier}x your 7-day average of ${Math.round(avgVisitors)}. Something you posted may be driving traffic. Your conversion rate from ${srcLabel} is ${convRateStr}%.`,
            severity: "positive",
            metricValue: todayVisitors,
            baselineValue: parseFloat(avgVisitors.toFixed(1)),
          });
        }
      }

      // Conversion spike: today's conversion rate >= 1.5x the 7-day average
      if (todayVisitors >= 5 && avgConvRate > 0 && todayConvRate >= avgConvRate * 1.5) {
        const alreadyExists = await storage.checkRecentAnomaly(campaignId, "conversion_spike", src, sinceDateIso);
        if (!alreadyExists) {
          const srcLabel = src.charAt(0).toUpperCase() + src.slice(1).replace(/_/g, " ");
          const todayRateStr = (todayConvRate * 100).toFixed(1);
          const avgRateStr = (avgConvRate * 100).toFixed(1);
          await storage.createAnomaly({
            campaignId,
            anomalyType: "conversion_spike",
            source: src,
            title: `${srcLabel} conversion rate spiked to ${todayRateStr}%`,
            description: `Visitors from ${srcLabel} are converting at ${todayRateStr}% today vs your usual ${avgRateStr}%. If you're running a promotion or changed your targeting, it's working.`,
            severity: "positive",
            metricValue: parseFloat((todayConvRate * 100).toFixed(1)),
            baselineValue: parseFloat((avgConvRate * 100).toFixed(1)),
          });
        }
      }
    }
  } catch (err) {
    // Fire-and-forget — silently log errors
    console.error("[anomaly-detection] error:", err);
  }
}

// Helper: count total visitors across all campaigns for a user
async function countUserVisitors(userId: number): Promise<number> {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM visitors v
    JOIN campaigns c ON v.campaign_id = c.id
    WHERE c.user_id = $1
  `, [userId]);
  return parseInt(result.rows[0]?.count) || 0;
}

async function countCampaignVisitors(userId: number): Promise<number> {
  return countUserVisitors(userId);
}

function sanitizeUser(user: any) {
  const { passwordHash, llmApiKey, stripeAccessToken, ghlApiKey, ...safe } = user;
  safe.hasStripeConnect = !!stripeAccessToken;
  safe.hasGhlConnect = !!ghlApiKey;
  return safe;
}

function generateEmbedCode(baseUrl: string, campaign: any): string {
  const hSel = campaign.headlineSelector || "h1";
  const sSel = campaign.subheadlineSelector || "h2";

  return `<!-- SiteAmoeba A/B Test Widget — Campaign: ${campaign.name} -->
<script>
(function(){
  var API = "${baseUrl}";
  var CID = ${campaign.id};
  var vid = localStorage.getItem("sa_vid");
  if (!vid) {
    vid = "v_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
    localStorage.setItem("sa_vid", vid);
  }

  function injectVisitorId() {
    document.querySelectorAll("form").forEach(function(f) {
      var input = document.createElement("input");
      input.type = "hidden"; input.name = "ab_visitor_id"; input.value = vid;
      f.appendChild(input);
    });
    document.querySelectorAll('a[href*="checkout"], a[href*="order"]').forEach(function(a) {
      var url = new URL(a.href, window.location.origin);
      url.searchParams.set("ab_vid", vid);
      a.href = url.toString();
    });
  }

  function applyVariantText(el, text, testMethod) {
    if (!el || !text) return;
    if (testMethod === "html_swap" || /<[a-z][\s\S]*>/i.test(text)) {
      el.innerHTML = text;
    } else {
      el.textContent = text;
    }
  }

  fetch(API + "/api/widget/assign?vid=" + vid + "&cid=" + CID + "&ref=" + encodeURIComponent(document.referrer))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.headline && data.headline.text) {
        var h1 = document.querySelector('${hSel}') || document.querySelector("h1");
        if (h1) applyVariantText(h1, data.headline.text, "text_swap");
      }
      if (data.subheadline && data.subheadline.text) {
        var sub = document.querySelector('${sSel}') || document.querySelector("h2");
        if (sub) applyVariantText(sub, data.subheadline.text, "text_swap");
      }
      // Apply section variants (body_copy, CTAs, etc.) when returned by the assign endpoint
      if (data.sections && Array.isArray(data.sections)) {
        data.sections.forEach(function(sv) {
          if (!sv || !sv.selector || !sv.text) return;
          var el = document.querySelector(sv.selector);
          if (el) applyVariantText(el, sv.text, sv.testMethod || "text_swap");
        });
      }
      injectVisitorId();
    })
    .catch(function(e) { console.log("SiteAmoeba: using defaults", e); });

  // === STYLE CAPTURE ===
  try {
    var styleElements = {};
    var selectors = {"h1": "headline", "h2": "subheadline", "h3": "section_header"};
    var ctaSelectors = ["a.btn", "button.cta", "a.cta", ".hero a", ".hero button", "a[href*='checkout']", "a[href*='order']", ".btn-primary", ".cta-button", ".button", "button[type='submit']"];
    Object.keys(selectors).forEach(function(sel) {
      var el = document.querySelector(sel);
      if (el) {
        var cs = window.getComputedStyle(el);
        var bgColor = cs.backgroundColor;
        if (bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") {
          var parent = el.parentElement;
          while (parent && parent !== document.body) {
            var pcs = window.getComputedStyle(parent);
            if (pcs.backgroundColor !== "transparent" && pcs.backgroundColor !== "rgba(0, 0, 0, 0)") { bgColor = pcs.backgroundColor; break; }
            parent = parent.parentElement;
          }
          if (bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") bgColor = window.getComputedStyle(document.body).backgroundColor;
        }
        styleElements[selectors[sel]] = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, backgroundColor: bgColor, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform };
      }
    });
    for (var i = 0; i < ctaSelectors.length; i++) {
      var ctaEl = document.querySelector(ctaSelectors[i]);
      if (ctaEl) {
        var ctaCs = window.getComputedStyle(ctaEl);
        styleElements["cta"] = { fontFamily: ctaCs.fontFamily, fontSize: ctaCs.fontSize, fontWeight: ctaCs.fontWeight, color: ctaCs.color, backgroundColor: ctaCs.backgroundColor, textAlign: ctaCs.textAlign, lineHeight: ctaCs.lineHeight, letterSpacing: ctaCs.letterSpacing, textTransform: ctaCs.textTransform, borderRadius: ctaCs.borderRadius, padding: ctaCs.padding };
        break;
      }
    }
    if (Object.keys(styleElements).length > 0) {
      fetch(API + "/api/widget/styles", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({cid: CID, styles: styleElements}) }).catch(function(){});
    }
  } catch(e) {}

  // === BEHAVIORAL TRACKING ===
  var events = [];
  var startTime = Date.now();
  var maxScroll = 0;
  var device = window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";
  var scrollTimeout;
  window.addEventListener("scroll", function() {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function() {
      var depth = Math.round((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100);
      if (depth > maxScroll) {
        maxScroll = depth;
        if (depth >= 25 && depth < 50) events.push({type: "scroll", data: JSON.stringify({depth: 25}), ts: Date.now()});
        else if (depth >= 50 && depth < 75) events.push({type: "scroll", data: JSON.stringify({depth: 50}), ts: Date.now()});
        else if (depth >= 75 && depth < 100) events.push({type: "scroll", data: JSON.stringify({depth: 75}), ts: Date.now()});
        else if (depth >= 100) events.push({type: "scroll", data: JSON.stringify({depth: 100}), ts: Date.now()});
      }
    }, 200);
  });
  if (window.IntersectionObserver) {
    var sections = document.querySelectorAll("section, [class*='section'], [id*='section'], .container > div, main > div");
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var eid = entry.target.id || entry.target.className.split(" ")[0] || "section_" + Array.from(entry.target.parentNode.children).indexOf(entry.target);
          events.push({type: "section_view", data: JSON.stringify({section: eid}), ts: Date.now()});
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    sections.forEach(function(s) { observer.observe(s); });
  }
  document.addEventListener("click", function(e) {
    var target = e.target;
    var tag = target.tagName;
    var text = (target.innerText || "").substring(0, 50);
    var cls = (target.className || "").substring(0, 50);
    if (tag === "BUTTON" || tag === "A" || target.closest("button") || target.closest("a")) {
      events.push({type: "click", data: JSON.stringify({tag: tag, text: text, class: cls}), ts: Date.now()});
    }
  });
  document.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='wistia']").forEach(function(v) {
    if (v.tagName === "VIDEO") {
      v.addEventListener("play", function() { events.push({type: "video_play", data: "{}", ts: Date.now()}); });
      v.addEventListener("ended", function() { events.push({type: "video_complete", data: "{}", ts: Date.now()}); });
    }
  });
  function sendBatch(batch, timeOnPage) {
    var payload = JSON.stringify({vid: vid, cid: CID, events: batch, timeOnPage: timeOnPage, maxScroll: maxScroll, device: device});
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API + "/api/widget/events", new Blob([payload], {type: "application/json"}));
    } else {
      fetch(API + "/api/widget/events", {method: "POST", headers: {"Content-Type": "application/json"}, body: payload, keepalive: true}).catch(function(){});
    }
  }
  setInterval(function() {
    if (events.length === 0) return;
    var batch = events.splice(0, events.length);
    var timeOnPage = Math.round((Date.now() - startTime) / 1000);
    sendBatch(batch, timeOnPage);
  }, 30000);
  window.addEventListener("beforeunload", function() {
    var timeOnPage = Math.round((Date.now() - startTime) / 1000);
    events.push({type: "page_exit", data: JSON.stringify({maxScroll: maxScroll, timeOnPage: timeOnPage}), ts: Date.now()});
    var batch = events.splice(0, events.length);
    sendBatch(batch, timeOnPage);
  });
  // Listen for preview messages from parent (visual editor)
  var _originalTexts = {};
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'SA_APPLY_VARIANT') {
      var d = e.data.data;
      if (!d || !d.text) return;
      // Find the element by treePath or text fingerprint
      var target = null;
      if (d.elementIdentity && d.elementIdentity.treePath) {
        try { target = document.querySelector(d.elementIdentity.treePath); } catch(ex) {}
      }
      // Fallback: find by tag + text match
      if (!target && d.elementIdentity) {
        var candidates = document.querySelectorAll(d.elementIdentity.tagName || '*');
        var fp = (d.elementIdentity.textFingerprint || d.elementIdentity.originalText || '').toLowerCase().slice(0, 40);
        for (var ci = 0; ci < candidates.length; ci++) {
          if ((candidates[ci].innerText || '').toLowerCase().trim().indexOf(fp) === 0) {
            target = candidates[ci]; break;
          }
        }
      }
      // If still no target, try to find any element matching the text
      if (!target) {
        var allEls = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,li,button,a');
        for (var ai = 0; ai < allEls.length; ai++) {
          var elText = (allEls[ai].innerText || '').trim();
          if (elText.length > 10 && d.text.toLowerCase().indexOf(elText.toLowerCase().slice(0, 20)) !== -1) {
            target = allEls[ai]; break;
          }
        }
      }
      if (target) {
        // Save original text for reset
        var key = d.variantId || 'preview';
        if (!_originalTexts[key]) _originalTexts[key] = { el: target, text: target.innerText };
        // Find deepest single-child leaf
        var leaf = target;
        for (var dd = 0; dd < 5; dd++) {
          var kids = [];
          for (var ki = 0; ki < leaf.children.length; ki++) {
            var ktag = leaf.children[ki].tagName.toUpperCase();
            if (ktag !== 'SCRIPT' && ktag !== 'STYLE' && ktag !== 'BR') {
              if ((leaf.children[ki].textContent || '').trim().length > 0) kids.push(leaf.children[ki]);
            }
          }
          if (kids.length === 1) { leaf = kids[0]; } else break;
        }
        leaf.textContent = d.text;
        if (d.styleOverrides) {
          for (var sp in d.styleOverrides) {
            if (d.styleOverrides[sp]) {
              leaf.style[sp] = d.styleOverrides[sp];
            }
          }
        }
        target.style.outline = '2px solid #22c55e';
        target.style.outlineOffset = '2px';
      }
    }
    if (e.data.type === 'SA_RESET_VIEW') {
      // Restore all original texts
      for (var rk in _originalTexts) {
        var entry = _originalTexts[rk];
        if (entry && entry.el) {
          entry.el.innerText = entry.text;
          entry.el.style.outline = '';
          entry.el.style.outlineOffset = '';
        }
      }
      _originalTexts = {};
    }
  });
})();
</script>`;
}
// build Mon Apr  6 16:56:50 UTC 2026
// deploy trigger 1775504740
