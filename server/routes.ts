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
import { buildHeadlineGenerationPrompt, buildSubheadlineGenerationPrompt, buildSectionGenerationPrompt, buildClassificationPrompt, buildPageScanPrompt, buildBrainChatPrompt, buildTestLessonPrompt, type GenerationContext } from "./prompts";
import { getBrainPageAuditKnowledge, getRelevantTestLessons } from "./brain-selector";
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
  pro:       { credits: 500,  campaigns: 999, priceId: "price_1TICnfLj5hhothOuz2yfIWZi" },
  business:  { credits: 1200, campaigns: 999, priceId: "price_1TICngLj5hhothOuPEzJ9Nwa" },
  autopilot: { credits: 3000, campaigns: 999, priceId: "price_1TICngLj5hhothOuIYr4AGgK" },
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

export async function registerRoutes(server: Server, app: Express) {
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
    res.json({ user: sanitizeUser(user) });
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: `${req.headers.origin}/#/billing?success=true`,
      cancel_url: `${req.headers.origin}/#/billing?canceled=true`,
      metadata: { userId: String(user.id), plan },
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

  // Stripe webhook for subscription events
  app.post("/api/webhook/stripe-billing", async (req: Request, res: Response) => {
    const event = req.body;

    if (event.type === "checkout.session.completed") {
      const meta = event.data?.object?.metadata;
      if (meta?.userId && meta?.plan) {
        const userId = parseInt(meta.userId);
        const planConfig = PLANS[meta.plan];
        if (planConfig) {
          await storage.updateUser(userId, {
            plan: meta.plan,
            creditsLimit: planConfig.credits,
            campaignsLimit: planConfig.campaigns,
            stripeSubscriptionId: event.data?.object?.subscription || null,
          });
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const customerId = event.data?.object?.customer;
      if (customerId) {
        // Find user by stripe customer ID and downgrade to free
        const user = await storage.getUserByStripeCustomerId(customerId);
        if (user) {
          await storage.updateUser(user.id, {
            plan: "free",
            creditsLimit: 0,
            stripeSubscriptionId: null,
          });
        }
      }
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

    const count = await storage.getCampaignCountByUser(user.id);
    if (count >= user.campaignsLimit) {
      return res.status(403).json({ error: "Campaign limit reached. Upgrade your plan." });
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

  // ============== VARIANTS ==============

  app.get("/api/campaigns/:id/variants", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    res.json(await storage.getVariantsByCampaign(campaign.id));
  });

  app.post("/api/campaigns/:id/variants", requireAuth, async (req: Request, res: Response) => {
    const campaign = await storage.getCampaign(paramId(req.params.id));
    if (!campaign || campaign.userId !== req.userId) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // persuasionTags can be passed directly (from AI generation) or will be auto-classified
    // Strip persuasionTags from validation since it comes as array but schema expects string
    const { persuasionTags: rawTags, ...bodyWithoutTags } = req.body;
    const parsed = insertVariantSchema.safeParse({
      ...bodyWithoutTags,
      campaignId: campaign.id,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const variantData: any = { ...parsed.data };

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
    // Calculate totals from headline variants only (primary split dimension)
    const headlineStats = variantStats.filter(v => v.type === "headline");
    const totalVisitors = headlineStats.reduce((sum, v) => sum + v.impressions, 0);
    const totalConversions = headlineStats.reduce((sum, v) => sum + v.conversions, 0);
    const totalRevenue = headlineStats.reduce((sum, v) => sum + v.revenue, 0);
    const conversionRate = totalVisitors > 0 ? totalConversions / totalVisitors : 0;

    // Map to the shape the frontend expects
    const variants = variantStats.map(v => ({
      id: v.variantId,
      text: v.text,
      type: v.type,
      isControl: v.isControl,
      isActive: v.isActive,
      testSectionId: v.testSectionId,
      visitors: v.impressions,
      conversions: v.conversions,
      conversionRate: v.conversionRate * 100,
      revenue: v.revenue,
      confidence: v.confidence,
      persuasionTags: v.persuasionTags,
    }));

    res.json({
      totalVisitors,
      totalConversions,
      totalRevenue,
      conversionRate: conversionRate * 100,
      variants,
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
  async function matchStripeTransactionsToVisitors(userId: number): Promise<number> {
    const user = await storage.getUserById(userId);
    if (!user || !(user as any).stripeAccessToken) return 0;

    const decryptedKey = decryptApiKey((user as any).stripeAccessToken);
    const stripeClient = new Stripe(decryptedKey);

    // Fetch up to 100 recent charges
    const charges = await stripeClient.charges.list({ limit: 100 });
    const userCampaigns = await storage.getCampaignsByUser(userId);
    let matched = 0;

    for (const charge of charges.data) {
      if (charge.status !== "succeeded") continue;
      const customerEmail = charge.billing_details?.email || null;
      if (!customerEmail) continue;

      // Check if we already have a revenue event for this charge
      const existing = await pool.query(
        `SELECT id FROM revenue_events WHERE external_id = $1 AND source = 'stripe_account' LIMIT 1`,
        [charge.id]
      );
      if (existing.rows.length > 0) continue;

      // Look for a visitor that already has a revenue_event with this email
      let matchedCampaignId: number | null = null;
      let matchedVisitorId: string | null = null;

      const visitorMatch = await pool.query(
        `SELECT re.visitor_id, re.campaign_id
         FROM revenue_events re
         JOIN campaigns c ON c.id = re.campaign_id
         WHERE re.customer_email = $1 AND c.user_id = $2 AND re.visitor_id IS NOT NULL
         LIMIT 1`,
        [customerEmail, userId]
      );

      if (visitorMatch.rows.length > 0) {
        matchedVisitorId = visitorMatch.rows[0].visitor_id;
        matchedCampaignId = visitorMatch.rows[0].campaign_id;
      } else if (userCampaigns.length > 0) {
        // Assign to first active campaign as fallback
        const activeCampaign = userCampaigns.find((c: any) => c.isActive && c.status === "active") || userCampaigns[0];
        matchedCampaignId = activeCampaign.id;
      }

      if (!matchedCampaignId) continue;

      await storage.addRevenueEvent({
        visitorId: matchedVisitorId || undefined,
        campaignId: matchedCampaignId,
        source: "stripe_account",
        eventType: charge.refunded ? "refund" : "purchase",
        amount: charge.amount / 100, // Stripe amounts are in cents
        currency: charge.currency?.toUpperCase() || "USD",
        externalId: charge.id,
        customerEmail: customerEmail,
        metadata: JSON.stringify({
          description: charge.description,
          paymentMethod: charge.payment_method_details?.type,
        }),
      });
      matched++;
    }

    return matched;
  }

  // ============== STRIPE CONNECT OAUTH ==============
  const STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || "";
  const STRIPE_REDIRECT_URI = (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "https://api.siteamoeba.com") + "/api/settings/stripe-callback";

  // A) GET /api/settings/stripe-connect-url — generates the OAuth authorize URL
  app.get("/api/settings/stripe-connect-url", requireAuth, async (req: Request, res: Response) => {
    if (!STRIPE_CONNECT_CLIENT_ID) {
      return res.status(500).json({ error: "Stripe Connect not configured. Contact support." });
    }
    const state = `${req.userId!}_${Date.now()}`; // simple state for CSRF
    const authorizeUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${STRIPE_CONNECT_CLIENT_ID}&scope=read_only&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(STRIPE_REDIRECT_URI)}`;
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
      res.json({
        connected: true,
        accountId: (user as any).stripeAccountId,
        recentCharges: charges.data.length,
        connectedAt: (user as any).stripeConnectedAt,
        connectAvailable: true,
      });
    } catch (err) {
      // Token is invalid — clear it
      await storage.updateUser(user.id, {
        stripeAccountId: null,
        stripeAccessToken: null,
        stripeConnectedAt: null,
      } as any);
      res.json({ connected: false, connectAvailable: !!STRIPE_CONNECT_CLIENT_ID });
    }
  });

  // D) GET /api/settings/stripe-transactions
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

    // Fetch the page HTML
    let rawHtml: string;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        return res.status(422).json({ error: `Could not fetch page: HTTP ${response.status}` });
      }
      rawHtml = await response.text();
    } catch (err: any) {
      if (err.name === "AbortError") {
        return res.status(422).json({ error: "Page fetch timed out (15s). The URL may be slow or unreachable." });
      }
      return res.status(422).json({ error: `Could not fetch page: ${err.message || "Network error"}` });
    }

    // Strip scripts, styles, SVGs, and comments to reduce noise
    let cleaned = rawHtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    // Truncate to ~8000 chars to fit in context
    if (cleaned.length > 8000) {
      cleaned = cleaned.slice(0, 8000) + "\n<!-- [truncated] -->";
    }

    const messages = buildPageScanPrompt(url, cleaned);

    let rawResponse: string;
    try {
      rawResponse = await callLLM(llmConfigResolved.config, messages);
    } catch (err: any) {
      console.error("Page scan LLM call failed:", err);
      return res.status(502).json({ error: err.message || "AI provider error. Check your API key and credits in Settings." });
    }

    // Parse the JSON response
    let scanResult: { pageName: string; pageType: string; pageGoal?: string; pricePoint?: string; niche?: string; sections: any[] };
    try {
      const cleanedResponse = rawResponse
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      scanResult = JSON.parse(cleanedResponse);
      if (!scanResult.sections || !Array.isArray(scanResult.sections)) {
        throw new Error("Expected sections array");
      }
    } catch (err: any) {
      console.error("Failed to parse page scan response:", rawResponse);
      return res.status(502).json({ error: "AI returned invalid response. Please try again." });
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
          await storage.updateCampaign(campaignId, {
            pageType: scanResult.pageType || null,
            pageGoal: scanResult.pageGoal || null,
            pricePoint: (scanResult.pricePoint && scanResult.pricePoint !== "null") ? scanResult.pricePoint : null,
            niche: scanResult.niche || null,
          } as any);
        }
      } catch (err) {
        // Non-fatal — scan result is still returned
        console.warn("Could not update campaign classification fields:", err);
      }
    }

    res.json(scanResult);
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
      return res.status(400).json({ error: "Please configure your AI provider in Settings or upgrade to a paid plan." });
    }

    const { campaignId, type, sectionId } = req.body;
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

    // Inject brain knowledge for paid users
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
      }))
      .slice(0, 3);

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

    // === TEST LESSON: Auto-generate and store a lesson from this result ===
    // Only generate a lesson if there's a meaningful comparison (winner vs loser stats available)
    let lesson: any = null;
    try {
      if (winnerStats && controlStats && winnerStats.impressions >= 10 && controlStats.impressions >= 10) {
        const loserVariant = typeVariants.find(v => v.id === controlStats.variantId) ||
                             typeVariants.find(v => v.id !== winningVariant.id);

        const winnerCvr = winnerStats.conversionRate;
        const loserCvr = controlStats.conversionRate;
        const liftPct = loserCvr > 0 ? ((winnerCvr - loserCvr) / loserCvr) * 100 : 0;
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
    const liftPctFinal = controlCvr > 0 ? ((winnerCvr - controlCvr) / controlCvr) * 100 : 0;
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

    const playbook = getPlaybook(campaign.pageType || "landing_page");
    const currentStepIndex = campaign.autopilotStep ?? 0;
    const currentPlaybookStep = playbook[currentStepIndex] || null;

    // Find the current test section being tested
    let currentSectionId: number | null = null;
    if (currentPlaybookStep) {
      const sections = await storage.getTestSectionsByCampaign(campaign.id);
      const activeSection = sections.find(
        (s) => s.isActive && s.category === currentPlaybookStep.sectionCategory
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
      minVisitorsNeeded: null, // frontend can compute from user settings
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
      return res.status(400).json({ error: "Brain Chat requires a paid plan or your own API key configured in Settings." });
    }

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
    const variantStats = await storage.getVariantStats(campaign.id);
    const testSections = await storage.getTestSectionsByCampaign(campaign.id);
    const totalVisitors = await storage.getVisitorCountByCampaign(campaign.id);
    const totalConversions = variantStats.reduce((sum, v) => sum + (v.type === "headline" ? v.conversions : 0), 0);
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

    // Get relevant test lessons for context
    const sectionTypesActive = testSections.map(s => s.category);
    // Use most common section type from this campaign's active sections as the primary query
    const primarySectionType = sectionTypesActive[0] || "headline";
    const testLessonsText = await getRelevantTestLessons(
      campaign.pageType || "sales_page",
      primarySectionType,
      campaign.niche || undefined
    );

    const chatContext = {
      campaignUrl: campaign.url,
      campaignName: campaign.name,
      pageContent, // actual text content from the page
      sections: testSections.map(s => ({
        label: s.label,
        category: s.category,
        currentText: s.currentText,
        isActive: s.isActive,
        testMethod: s.testMethod,
      })),
      variants: variantStats.map(v => ({
        id: v.variantId,
        text: v.text,
        type: v.type,
        isControl: v.isControl,
        isActive: v.isActive,
        visitors: v.impressions,
        conversions: v.conversions,
        conversionRate: v.conversionRate * 100,
        confidence: v.confidence,
        persuasionTags: v.persuasionTags,
      })),
      totalVisitors,
      totalConversions,
      conversionRate,
      brainKnowledge: brainKnowledge + dynamicBrainKnowledge,
      winConfidenceThreshold: user.winConfidenceThreshold,
      // Page context fields
      pageType: campaign.pageType || undefined,
      pageGoal: campaign.pageGoal || undefined,
      pricePoint: campaign.pricePoint || undefined,
      niche: campaign.niche || undefined,
      // Real test data from past lessons
      testLessons: testLessonsText || undefined,
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
        chatContext.sections.length > 0
          ? `\nActive sections:\n${chatContext.sections.map(s => `  - ${s.label} (${s.category}): "${(s.currentText || "").slice(0, 80)}"`).join("\n")}`
          : "",
        chatContext.variants.length > 0
          ? `\nVariants:\n${chatContext.variants.map(v => `  - "${(v.text || "").slice(0, 60)}" | ${v.visitors} visitors | ${v.conversions} conversions | ${v.conversionRate.toFixed(2)}% CVR | ${v.confidence.toFixed(0)}% confidence${v.isControl ? " (control)" : ""}${v.isActive ? " [active]" : ""}`).join("\n")}`
          : "",
        chatContext.pageContent ? `\nPage content excerpt:\n${chatContext.pageContent.slice(0, 2000)}` : "",
        chatContext.brainKnowledge ? `\n${chatContext.brainKnowledge.slice(0, 1500)}` : "",
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
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  app.get("/api/widget/assign", widgetLimiter, async (req: Request, res: Response) => {
    const visitorId = req.query.vid as string;
    const campaignId = parseInt(req.query.cid as string);

    if (!visitorId || !campaignId) {
      return res.status(400).json({ error: "Missing vid or cid" });
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

    // Check for existing visitor
    const existing = await storage.getVisitor(visitorId);
    if (existing && existing.campaignId === campaignId) {
      const h = await storage.getVariant(existing.headlineVariantId);
      const s = await storage.getVariant(existing.subheadlineVariantId);
      return res.json({
        visitorId: existing.id,
        headline: h ? { id: h.id, text: h.text } : null,
        subheadline: s ? { id: s.id, text: s.text } : null,
      });
    }

    const headlineVariants = await storage.getActiveVariantsByCampaign(campaignId, "headline");
    const subheadlineVariants = await storage.getActiveVariantsByCampaign(campaignId, "subheadline");

    if (headlineVariants.length === 0 && subheadlineVariants.length === 0) {
      return res.json({ visitorId, headline: null, subheadline: null });
    }

    const hVariant = headlineVariants.length > 0
      ? headlineVariants[Math.floor(Math.random() * headlineVariants.length)]
      : null;
    const sVariant = subheadlineVariants.length > 0
      ? subheadlineVariants[Math.floor(Math.random() * subheadlineVariants.length)]
      : null;

    const utmSource   = (req.query.utm_source   as string) || null;
    const utmMedium   = (req.query.utm_medium   as string) || null;
    const utmCampaign = (req.query.utm_campaign as string) || null;
    const utmContent  = (req.query.utm_content  as string) || null;
    const utmTerm     = (req.query.utm_term     as string) || null;
    const referrer    = (req.query.ref          as string) || null;
    const ua          = req.headers["user-agent"] || null;
    const trafficSource  = parseTrafficSource(referrer || "", utmSource || "", utmMedium || "");
    const deviceCategory = parseDeviceCategory(ua || "");

    const visitor = await storage.createVisitor({
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
    });

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
      headline: hVariant ? { id: hVariant.id, text: hVariant.text } : null,
      subheadline: sVariant ? { id: sVariant.id, text: sVariant.text } : null,
    });

    // Fire-and-forget anomaly detection (throttled to once per 5 min per campaign)
    detectTrafficAnomalies(campaignId).catch(() => {});
  });

  // ============== CONVERSION PIXEL (public, CORS) ==============

  app.post("/api/widget/convert", widgetLimiter, async (req: Request, res: Response) => {
    const { vid, cid, revenue } = req.body;
    if (!vid || !cid) {
      return res.status(400).json({ error: "Missing vid or cid" });
    }

    const campaignId = parseInt(cid);
    const visitor = await storage.getVisitor(vid);
    if (!visitor || visitor.campaignId !== campaignId) {
      return res.status(404).json({ error: "Visitor not found for this campaign" });
    }

    if (visitor.converted) {
      return res.json({ received: true, already_converted: true });
    }

    const rev = typeof revenue === "number" ? revenue : 0;
    await storage.markConverted(vid, "pixel_" + Date.now(), rev);
    return res.json({ received: true, attributed: true });
  });

  // Also support GET for simple image pixel fallback
  app.get("/api/widget/convert", widgetLimiter, async (req: Request, res: Response) => {
    const vid = req.query.vid as string;
    const cid = req.query.cid as string;
    const revenue = parseFloat(req.query.revenue as string) || 0;

    if (vid && cid) {
      const campaignId = parseInt(cid);
      const visitor = await storage.getVisitor(vid);
      if (visitor && visitor.campaignId === campaignId && !visitor.converted) {
        await storage.markConverted(vid, "pixel_" + Date.now(), revenue);
      }
    }

    // Return a 1x1 transparent GIF
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store");
    res.send(pixel);
  });

  // ============== BEHAVIORAL EVENTS (public, CORS via widget middleware) ==============

  // POST /api/widget/events — batch event ingestion from the widget
  app.post("/api/widget/events", widgetLimiter, async (req: Request, res: Response) => {
    const { vid, cid, events, timeOnPage, maxScroll, device } = req.body;

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
        if (typeof timeOnPage === "number" && timeOnPage > 0) sessionUpdates.timeOnPage = timeOnPage;
        if (device) sessionUpdates.deviceType = device;

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
    res.set("Cache-Control", "public, max-age=300"); // 5-min cache
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
      const result = await pgPool.query(
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

  app.get("/api/admin/feedback", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || user.email !== "test@test.com") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const items = await storage.getAllFeedback();
    res.json(items);
  });

  app.patch("/api/admin/feedback/:id", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUserById(req.userId!);
    if (!user || user.email !== "test@test.com") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = paramId(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { status, adminNotes } = req.body;
    if (!status) return res.status(400).json({ error: "status is required" });
    const item = await storage.updateFeedbackStatus(id, status, adminNotes);
    res.json(item);
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
      const sourceRows = await pgPool.query(
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

      // Also query LTV from revenue_events per traffic source
      const ltvRows = await pgPool.query(
        `SELECT
          COALESCE(v.traffic_source, 'direct') AS source,
          COALESCE(SUM(re.amount), 0) AS ltv_revenue,
          COUNT(DISTINCT COALESCE(re.visitor_id, re.customer_email)) AS ltv_customers
        FROM revenue_events re
        LEFT JOIN visitors v ON v.id = re.visitor_id
        WHERE re.campaign_id = $1 AND re.event_type != 'refund'
        GROUP BY COALESCE(v.traffic_source, 'direct')`,
        [campaignId]
      );
      const ltvBySource: Record<string, { ltv: number }> = {};
      for (const row of ltvRows.rows) {
        const rev = parseFloat(row.ltv_revenue) || 0;
        const cust = parseInt(row.ltv_customers) || 1;
        ltvBySource[row.source] = { ltv: parseFloat((rev / cust).toFixed(2)) };
      }

      const sources = sourceRows.rows.map((r: any) => {
        const vis = parseInt(r.visitors) || 0;
        const conv = parseInt(r.conversions) || 0;
        const rev = parseFloat(r.revenue) || 0;
        const ltvData = ltvBySource[r.source];
        return {
          source: r.source,
          visitors: vis,
          conversions: conv,
          conversionRate: vis > 0 ? parseFloat(((conv / vis) * 100).toFixed(1)) : 0,
          revenue: parseFloat(rev.toFixed(2)),
          revenuePerVisitor: vis > 0 ? parseFloat((rev / vis).toFixed(2)) : 0,
          ltv: ltvData ? ltvData.ltv : 0,
        };
      });

      // Query grouped by device_category
      const deviceRows = await pgPool.query(
        `SELECT
          COALESCE(device_category, 'other') AS device,
          COUNT(*) AS visitors,
          SUM(CASE WHEN converted = true THEN 1 ELSE 0 END) AS conversions,
          COALESCE(SUM(CASE WHEN converted = true THEN revenue ELSE 0 END), 0) AS revenue
        FROM visitors
        WHERE campaign_id = $1
        GROUP BY COALESCE(device_category, 'other')
        ORDER BY COUNT(*) DESC`,
        [campaignId]
      );

      const devices = deviceRows.rows.map((r: any) => {
        const vis = parseInt(r.visitors) || 0;
        const conv = parseInt(r.conversions) || 0;
        const rev = parseFloat(r.revenue) || 0;
        return {
          device: r.device,
          visitors: vis,
          conversions: conv,
          conversionRate: vis > 0 ? parseFloat(((conv / vis) * 100).toFixed(1)) : 0,
          revenue: parseFloat(rev.toFixed(2)),
          revenuePerVisitor: vis > 0 ? parseFloat((rev / vis).toFixed(2)) : 0,
        };
      });

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

      return res.json({ sources, devices, topInsight });
    } finally {
      await pgPool.end();
    }
  });

  // ============== ANOMALY ENDPOINTS ==============

  // GET /api/campaigns/anomaly-counts — unread counts for all user campaigns (for sidebar)
  app.get("/api/campaigns/anomaly-counts", requireAuth, async (req: Request, res: Response) => {
    try {
      const counts = await storage.getUnreadAnomalyCountsByUser(req.userId!);
      return res.json(counts);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

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
}

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
        DATE(created_at::timestamp) AS day,
        COALESCE(traffic_source, 'direct') AS source,
        COUNT(*) AS visitors,
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END) AS conversions
       FROM visitors
       WHERE campaign_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at::timestamp), COALESCE(traffic_source, 'direct')
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
  const { passwordHash, llmApiKey, ...safe } = user;
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
})();
</script>`;
}
