/**
 * offer-detector.ts
 *
 * Pure HTML heuristics — no LLM call. Detects:
 *   - VSL presence + vertical position on page
 *   - First CTA/offer position (pixel offset + % of page)
 *   - Whether checkout/order is inline or on a separate URL
 *
 * Scroll depth on a page with an above-fold VSL+CTA means something very different
 * from scroll depth on a long-form sales letter. This lets us judge tests fairly.
 */

import { storage, pool } from "./storage";

// Tokens that indicate a VSL/video player
const VIDEO_MARKERS = [
  /<video[\s>]/i,
  /player\.vimeo\.com/i,
  /fast\.wistia\.(net|com)/i,
  /youtube\.com\/embed/i,
  /youtu\.be\/embed/i,
  /vturb\.com\.br/i,
  /vsl\.fastpaid\./i,
  /vturb-smartplayers/i,
  /\bvsl-/i,
  /<div[^>]+class="[^"]*\b(vsl|video-player|wistia_embed)\b/i,
];

// CTA token patterns — button/link text that indicates "buy/register/claim/start"
const CTA_TEXT_PATTERNS = [
  /\b(buy|order|register|get\s+(started|access|instant)|claim|start\s+(free|now|today)|add to cart|checkout|subscribe|join|enroll|yes[,!]?\s+\w+|sign\s+up|reserve|book|download)\b/i,
];

// External checkout domains — if first CTA links here, offer is a separate page
const EXTERNAL_CHECKOUT_DOMAINS = [
  "checkout.stripe.com",
  "buy.stripe.com",
  "pay.stripe.com",
  "paypal.com/checkout",
  "paypal.com/cgi-bin/webscr",
  "clickbank.net",
  "samcart.com",
  "thrivecart.com",
  "paykickstart.com",
  "whop.com/checkout",
  "whop.com/c/",
  "gumroad.com/l/",
];

export interface OfferContext {
  hasVsl: boolean;
  vslPosition: "above_fold" | "below_fold" | null;
  ctaOffsetPct: number | null;           // 0-100, where the FIRST actionable CTA appears
  offerPosition: "above_fold" | "below_fold" | "linked_page" | "unknown";
  offerPageSeparate: boolean;            // first CTA links to a different URL (checkout)
  firstCtaText: string | null;
  firstCtaHref: string | null;
  detectedAt: Date;
}

/**
 * Parse the HTML source and extract offer context.
 *
 * We operate on the raw HTML string so we don't need a DOM library at runtime;
 * regex is enough for the signals we care about.
 */
export function detectOfferContext(
  rawHtml: string,
  campaignUrl: string
): OfferContext {
  const totalLen = rawHtml.length || 1;
  const lowerHtml = rawHtml.toLowerCase();

  // ----- VSL detection -----
  let vslPosition: "above_fold" | "below_fold" | null = null;
  let firstVideoIdx = -1;
  for (const pattern of VIDEO_MARKERS) {
    const m = rawHtml.match(pattern);
    if (m && m.index !== undefined) {
      if (firstVideoIdx === -1 || m.index < firstVideoIdx) {
        firstVideoIdx = m.index;
      }
    }
  }
  const hasVsl = firstVideoIdx !== -1;
  if (hasVsl) {
    // Treat first ~20% of HTML as "above the fold" proxy. This isn't pixel-perfect
    // but scan-time we don't have a rendered viewport — document position is our
    // best cheap proxy and it aligns with the DOM order most builders emit.
    const videoPct = (firstVideoIdx / totalLen) * 100;
    vslPosition = videoPct < 25 ? "above_fold" : "below_fold";
  }

  // ----- First CTA detection -----
  // Find the first <a> or <button> whose visible text matches a CTA pattern.
  let firstCtaIdx = -1;
  let firstCtaText: string | null = null;
  let firstCtaHref: string | null = null;

  // Greedy-free match for anchor/button tags with their inner text
  const tagRegex = /<(a|button)\b[^>]*?(?:\shref="([^"]*)")?[^>]*>([\s\S]{0,300}?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(rawHtml)) !== null) {
    const href = m[2] || null;
    const innerHtml = m[3] || "";
    // Strip nested tags to get visible text
    const visibleText = innerHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!visibleText || visibleText.length > 80) continue;  // skip junk
    if (CTA_TEXT_PATTERNS.some(p => p.test(visibleText))) {
      firstCtaIdx = m.index;
      firstCtaText = visibleText;
      firstCtaHref = href;
      break;
    }
  }

  const ctaOffsetPct = firstCtaIdx === -1 ? null : Math.round((firstCtaIdx / totalLen) * 100);

  // ----- Offer-page-separate detection -----
  let offerPageSeparate = false;
  if (firstCtaHref) {
    try {
      // Resolve relative URLs against the campaign URL
      const resolved = new URL(firstCtaHref, campaignUrl);
      const campaignHost = new URL(campaignUrl).hostname.toLowerCase();
      const ctaHost = resolved.hostname.toLowerCase();

      // External checkout processor
      if (EXTERNAL_CHECKOUT_DOMAINS.some(d => (ctaHost + resolved.pathname).includes(d))) {
        offerPageSeparate = true;
      } else if (ctaHost !== campaignHost && ctaHost !== "") {
        // Different hostname altogether
        offerPageSeparate = true;
      } else if (resolved.pathname && resolved.pathname !== new URL(campaignUrl).pathname) {
        // Same host, different path — most "add to cart → /checkout" flows
        // Only flag separate if path materially differs (not an anchor/query)
        const campaignPath = new URL(campaignUrl).pathname.replace(/\/$/, "");
        const ctaPath = resolved.pathname.replace(/\/$/, "");
        if (ctaPath && ctaPath !== campaignPath) {
          offerPageSeparate = true;
        }
      }
    } catch {
      // unparsable href — leave as inline
    }
  }

  // ----- Offer position classification -----
  let offerPosition: "above_fold" | "below_fold" | "linked_page" | "unknown" = "unknown";
  if (offerPageSeparate) {
    offerPosition = "linked_page";
  } else if (ctaOffsetPct !== null) {
    offerPosition = ctaOffsetPct < 20 ? "above_fold" : "below_fold";
  }

  return {
    hasVsl,
    vslPosition,
    ctaOffsetPct,
    offerPosition,
    offerPageSeparate,
    firstCtaText,
    firstCtaHref,
    detectedAt: new Date(),
  };
}

/**
 * Persist offer context to a campaign row. Safe to call repeatedly.
 */
export async function saveOfferContext(campaignId: number, ctx: OfferContext): Promise<void> {
  await pool.query(
    `UPDATE campaigns SET
       offer_position = $1,
       has_vsl = $2,
       vsl_position = $3,
       offer_page_separate = $4,
       cta_offset_pct = $5,
       offer_context_detected_at = NOW()
     WHERE id = $6`,
    [
      ctx.offerPosition,
      ctx.hasVsl,
      ctx.vslPosition,
      ctx.offerPageSeparate,
      ctx.ctaOffsetPct,
      campaignId,
    ]
  );
}

/**
 * Fetch + detect + save for a single campaign. Returns the detected context or null on failure.
 */
export async function detectAndSaveForCampaign(campaignId: number): Promise<OfferContext | null> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign || !campaign.url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(campaign.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);
    const rawHtml = await response.text();
    const ctx = detectOfferContext(rawHtml, campaign.url);
    await saveOfferContext(campaignId, ctx);
    console.log(
      `[offer-detect] C${campaignId}: vsl=${ctx.hasVsl}(${ctx.vslPosition}) ` +
      `offer=${ctx.offerPosition} ctaOffset=${ctx.ctaOffsetPct}% ` +
      `separate=${ctx.offerPageSeparate} cta="${ctx.firstCtaText?.slice(0, 40)}"`
    );
    return ctx;
  } catch (err: any) {
    console.error(`[offer-detect] C${campaignId} failed:`, err.message);
    return null;
  }
}

/**
 * Backfill: detect offer context for every active campaign missing it.
 * Runs in parallel batches so 50 campaigns don't serialize behind each other.
 */
export async function backfillOfferContexts(opts: {
  force?: boolean;
  maxConcurrent?: number;
} = {}): Promise<{ processed: number; successes: number; failures: number }> {
  const { force = false, maxConcurrent = 5 } = opts;
  const where = force
    ? `status = 'active'`
    : `status = 'active' AND offer_context_detected_at IS NULL`;
  const res = await pool.query(`SELECT id FROM campaigns WHERE ${where} ORDER BY id`);
  const ids: number[] = res.rows.map((r: any) => r.id);

  let successes = 0;
  let failures = 0;
  const queue = [...ids];
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) return;
      const ctx = await detectAndSaveForCampaign(id);
      if (ctx) successes++;
      else failures++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, queue.length) }, () => worker()));
  return { processed: ids.length, successes, failures };
}
