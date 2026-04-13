/**
 * platform-webhooks.ts
 *
 * Unified webhook receiver for course/creator platforms.
 * Handles purchase events from Teachable, Kajabi, Thinkific, and Stan Store.
 *
 * Each platform has a unique webhook URL:
 *   POST /api/webhooks/{platform}/{userId}/{secret}
 *
 * The receiver:
 *   1. Validates the secret against the user's stored webhook secret
 *   2. Normalizes the payload into a standard format
 *   3. Matches the buyer to a visitor (by email → visitor with same email)
 *   4. Creates a revenue event and marks the visitor converted
 */

import { storage, pool } from "./storage";
import crypto from "crypto";

// ============================================================
// Types
// ============================================================

export interface NormalizedPurchase {
  platform: "teachable" | "kajabi" | "thinkific" | "stan" | "generic";
  email: string;
  amount: number; // in dollars (not cents)
  currency: string;
  productName: string;
  externalId: string; // unique ID from the platform
  customerName?: string;
  isRefund?: boolean;
  rawPayload?: any;
}

export type SupportedPlatform = "teachable" | "kajabi" | "thinkific" | "stan" | "generic";

export const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  teachable: "Teachable",
  kajabi: "Kajabi",
  thinkific: "Thinkific",
  stan: "Stan Store",
  generic: "Generic Webhook",
};

// ============================================================
// Payload Normalizers
// ============================================================

/**
 * Teachable: Transaction.created webhook
 * Payload is an array: [{ type: "Transaction.created", object: { ... } }]
 */
function normalizeTeachable(body: any): NormalizedPurchase | null {
  try {
    // Teachable sends an array
    const event = Array.isArray(body) ? body[0] : body;
    const type = event?.type || "";

    // Handle refunds
    const isRefund = type.includes("refunded");

    const obj = event?.object || {};
    const sale = obj.sale || {};
    const user = sale.user || obj.user || {};
    const course = sale.course || {};
    const product = sale.product || {};

    // Transaction amount — Teachable sends in cents in the charge data,
    // or as sale.final_price (in dollars)
    let amount = 0;
    if (obj.data?.amount) {
      amount = obj.data.amount / 100; // Stripe charge data (cents)
    } else if (obj.net_charge) {
      amount = parseFloat(obj.net_charge) || 0;
    } else if (sale.final_price) {
      amount = parseFloat(sale.final_price) || 0;
    } else if (sale.price) {
      amount = parseFloat(sale.price) || 0;
    }

    const email = user.email || obj.data?.metadata?.email || "";
    if (!email) return null;

    return {
      platform: "teachable",
      email: email.toLowerCase().trim(),
      amount: isRefund ? -Math.abs(amount) : amount,
      currency: (obj.data?.currency || sale.currency || "USD").toUpperCase(),
      productName: course.name || product.name || obj.purchased_item_name || "Unknown",
      externalId: obj.data?.id || `teachable_${event.id || Date.now()}`,
      customerName: user.name || "",
      isRefund,
      rawPayload: event,
    };
  } catch (err) {
    console.error("[webhook:teachable] Parse error:", err);
    return null;
  }
}

/**
 * Kajabi: Payment Succeeded webhook
 * Payload: { id, type: "purchases", attributes: { amount_in_cents, ... }, relationships: { customer, ... } }
 */
function normalizeKajabi(body: any): NormalizedPurchase | null {
  try {
    // Kajabi can send an array or single object
    const event = Array.isArray(body) ? body[0] : body;
    const attrs = event?.attributes || {};
    const relationships = event?.relationships || {};

    const amount = (attrs.amount_in_cents || 0) / 100;
    const customerId = relationships?.customer?.data?.id;

    // Kajabi webhook doesn't always include email directly —
    // it's in the customer relationship. We'll need the email from the payload.
    // Some Kajabi implementations include extra contact info
    const email = attrs.email ||
      attrs.raw_extra_contact_information?.email ||
      attrs.cardholder_name || // fallback — not ideal
      "";

    if (!email) {
      console.warn("[webhook:kajabi] No email in payload, customer ID:", customerId);
      return null;
    }

    const isRefund = attrs.deactivated_at != null && attrs.deactivation_reason === "refund";

    return {
      platform: "kajabi",
      email: email.toLowerCase().trim(),
      amount: isRefund ? -Math.abs(amount) : amount,
      currency: (attrs.currency || "USD").toUpperCase(),
      productName: relationships?.products?.data?.[0]?.id ? `Kajabi Product ${relationships.products.data[0].id}` : "Kajabi Purchase",
      externalId: `kajabi_${event.id || Date.now()}`,
      customerName: attrs.cardholder_name || "",
      isRefund,
      rawPayload: event,
    };
  } catch (err) {
    console.error("[webhook:kajabi] Parse error:", err);
    return null;
  }
}

/**
 * Thinkific: ORDER_TRANSACTION.SUCCEEDED webhook
 * Payload: { event, payload: { order: { ... }, user: { ... } } }
 */
function normalizeThinkific(body: any): NormalizedPurchase | null {
  try {
    const payload = body?.payload || body;
    const order = payload?.order || {};
    const user = payload?.user || {};
    const product = payload?.product || order?.product || {};

    const isRefund = (body?.event || "").includes("REFUNDED");

    let amount = 0;
    if (order.amount_cents) {
      amount = order.amount_cents / 100;
    } else if (order.amount_dollars) {
      amount = parseFloat(order.amount_dollars) || 0;
    } else if (order.final_price) {
      amount = parseFloat(order.final_price) || 0;
    }

    const email = user.email || order.billing_email || "";
    if (!email) return null;

    return {
      platform: "thinkific",
      email: email.toLowerCase().trim(),
      amount: isRefund ? -Math.abs(amount) : amount,
      currency: (order.currency || "USD").toUpperCase(),
      productName: product.name || order.product_name || "Thinkific Course",
      externalId: `thinkific_${order.id || Date.now()}`,
      customerName: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
      isRefund,
      rawPayload: body,
    };
  } catch (err) {
    console.error("[webhook:thinkific] Parse error:", err);
    return null;
  }
}

/**
 * Stan Store: Purchase event (via Zapier/Pabbly webhook relay)
 * Stan doesn't have native webhooks — uses Zapier triggers.
 * Payload format varies, but typically includes email + amount.
 */
function normalizeStan(body: any): NormalizedPurchase | null {
  try {
    // Stan payloads come through Zapier, so format varies
    // Look for common fields
    const email = body?.email || body?.customer_email || body?.buyer_email ||
      body?.data?.email || "";
    if (!email) return null;

    const amount = parseFloat(body?.amount || body?.price || body?.total ||
      body?.data?.amount || body?.data?.price || "0") || 0;

    return {
      platform: "stan",
      email: email.toLowerCase().trim(),
      amount,
      currency: (body?.currency || "USD").toUpperCase(),
      productName: body?.product_name || body?.product || body?.item_name || "Stan Store Purchase",
      externalId: `stan_${body?.id || body?.order_id || Date.now()}`,
      customerName: body?.name || body?.customer_name || "",
      isRefund: false,
      rawPayload: body,
    };
  } catch (err) {
    console.error("[webhook:stan] Parse error:", err);
    return null;
  }
}

/**
 * Generic webhook — accepts any JSON with email + amount
 * Useful for platforms we don't explicitly support yet
 */
function normalizeGeneric(body: any): NormalizedPurchase | null {
  try {
    // Try to find email and amount in any structure
    const email = body?.email || body?.customer_email || body?.buyer_email ||
      body?.user?.email || body?.object?.email || body?.data?.email || "";
    if (!email) return null;

    let amount = 0;
    const rawAmount = body?.amount || body?.total || body?.price ||
      body?.data?.amount || body?.object?.amount || 0;
    if (typeof rawAmount === "number") {
      amount = rawAmount > 500 ? rawAmount / 100 : rawAmount; // Auto-detect cents vs dollars
    } else {
      amount = parseFloat(rawAmount) || 0;
    }

    return {
      platform: "generic",
      email: email.toLowerCase().trim(),
      amount,
      currency: (body?.currency || "USD").toUpperCase(),
      productName: body?.product_name || body?.product || body?.description || "Purchase",
      externalId: `generic_${body?.id || Date.now()}`,
      customerName: body?.name || body?.customer_name || "",
      isRefund: body?.type?.includes?.("refund") || body?.event?.includes?.("refund") || false,
      rawPayload: body,
    };
  } catch (err) {
    console.error("[webhook:generic] Parse error:", err);
    return null;
  }
}

// Platform normalizer map
const NORMALIZERS: Record<SupportedPlatform, (body: any) => NormalizedPurchase | null> = {
  teachable: normalizeTeachable,
  kajabi: normalizeKajabi,
  thinkific: normalizeThinkific,
  stan: normalizeStan,
  generic: normalizeGeneric,
};

// ============================================================
// Core Processing
// ============================================================

/**
 * Process a normalized purchase — match to visitor, create revenue event.
 */
export async function processPlatformPurchase(
  userId: number,
  purchase: NormalizedPurchase
): Promise<{ matched: boolean; visitorId?: string; campaignId?: number }> {
  const { email, amount, currency, productName, externalId, isRefund, platform } = purchase;

  // Check for duplicate
  const existing = await pool.query(
    "SELECT id FROM revenue_events WHERE external_id = $1 LIMIT 1",
    [externalId]
  );
  if (existing.rows.length > 0) {
    return { matched: false }; // Already processed
  }

  // Find the visitor by email across all of this user's campaigns
  const visitorResult = await pool.query(
    `SELECT v.id, v.campaign_id, v.converted, v.headline_variant_id, v.subheadline_variant_id
     FROM visitors v
     JOIN campaigns c ON c.id = v.campaign_id AND c.user_id = $1
     WHERE v.customer_email = $2
     ORDER BY v.first_seen DESC
     LIMIT 1`,
    [userId, email]
  );

  let matchedVisitorId: string | null = null;
  let matchedCampaignId: number | null = null;

  if (visitorResult.rows.length > 0) {
    matchedVisitorId = visitorResult.rows[0].id;
    matchedCampaignId = visitorResult.rows[0].campaign_id;
  } else {
    // Try matching by recent unconverted visitor on any active campaign
    // (within 24 hours — broader window since webhook may arrive later)
    const recentResult = await pool.query(
      `SELECT v.id, v.campaign_id
       FROM visitors v
       JOIN campaigns c ON c.id = v.campaign_id AND c.user_id = $1
       WHERE v.converted = false
         AND v.first_seen > NOW() - INTERVAL '24 hours'
       ORDER BY v.first_seen DESC
       LIMIT 1`,
      [userId]
    );
    if (recentResult.rows.length > 0) {
      matchedVisitorId = recentResult.rows[0].id;
      matchedCampaignId = recentResult.rows[0].campaign_id;
    }
  }

  // If no campaign matched, try to find the user's most active campaign
  if (!matchedCampaignId) {
    const activeCampaign = await pool.query(
      `SELECT c.id FROM campaigns c
       WHERE c.user_id = $1 AND c.status = 'active'
       ORDER BY (SELECT COUNT(*) FROM visitors WHERE campaign_id = c.id) DESC
       LIMIT 1`,
      [userId]
    );
    if (activeCampaign.rows.length > 0) {
      matchedCampaignId = activeCampaign.rows[0].id;
    }
  }

  if (!matchedCampaignId) {
    console.warn(`[webhook:${platform}] No campaign found for user ${userId}, email ${email}`);
    return { matched: false };
  }

  // Create the revenue event
  await storage.addRevenueEvent({
    visitorId: matchedVisitorId || undefined,
    campaignId: matchedCampaignId,
    source: `${platform}_webhook`,
    eventType: isRefund ? "refund" : "purchase",
    amount: amount,
    currency,
    externalId,
    customerEmail: email,
    metadata: JSON.stringify({ platform, productName, rawId: externalId }),
  });

  // Mark visitor converted if we have one
  if (matchedVisitorId && !isRefund) {
    const visitor = await storage.getVisitor(matchedVisitorId);
    if (visitor && !visitor.converted) {
      await storage.markConverted(matchedVisitorId, externalId, amount, email);
    } else if (visitor && visitor.converted && amount > 0) {
      // Upsell — add to existing revenue
      await pool.query(
        "UPDATE visitors SET revenue = COALESCE(revenue, 0) + $1 WHERE id = $2",
        [amount, matchedVisitorId]
      );
    }
    // Backfill email on the visitor
    if (email) {
      await pool.query(
        "UPDATE visitors SET customer_email = $1 WHERE id = $2 AND (customer_email IS NULL OR customer_email = '')",
        [email, matchedVisitorId]
      ).catch(() => {});
    }
  }

  console.log(
    `[webhook:${platform}] $${amount} ${email} -> C${matchedCampaignId} ` +
    `(${matchedVisitorId ? "visitor:" + matchedVisitorId.substring(0, 12) : "unmatched"}) ` +
    `product: ${productName}`
  );

  return {
    matched: !!matchedVisitorId,
    visitorId: matchedVisitorId || undefined,
    campaignId: matchedCampaignId,
  };
}

/**
 * Generate a webhook secret for a user+platform combination.
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Normalize a webhook payload based on platform type.
 */
export function normalizePayload(platform: SupportedPlatform, body: any): NormalizedPurchase | null {
  const normalizer = NORMALIZERS[platform];
  if (!normalizer) return null;
  return normalizer(body);
}
