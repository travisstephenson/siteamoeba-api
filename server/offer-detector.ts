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

// CTA token patterns — button/link text that indicates "buy/register/claim/start".
// Multi-language to cover European markets (IT/ES/FR/PT/DE) we see real user traffic from.
const CTA_TEXT_PATTERNS = [
  // English
  /\b(buy|order|register|get\s+(started|access|instant)|claim|start\s+(free|now|today)|add to cart|checkout|subscribe|join|enroll|yes[,!]?\s+\w+|sign\s+up|reserve|book|download)\b/i,
  // Italian
  /\b(ordina|acquista|ottieni|ricevi|scopri|scarica|iscriviti|prenota|clicca qui|inizia|sì,?\s*voglio)\b/i,
  // Spanish / Portuguese (shared roots)
  /\b(comprar|ordenar|reservar|descargar|obtener|obten|inscribir|inscribete|suscríbete|comenzar|empezar|inicio|regist(ro|rar)|sí,?\s*quiero|quiero|acesso|garanta|comprar agora|quero)\b/i,
  // French
  /\b(acheter|commander|réserver|télécharger|obtenir|s'inscrire|inscription|commencer|démarrer|oui,?\s*je)\b/i,
  // German
  /\b(kaufen|bestellen|reservieren|herunterladen|anmelden|registrieren|jetzt\s+starten|ja,?\s*ich)\b/i,
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
  // Find the first <a> or <button> whose visible text OR aria-label OR value matches a CTA.
  // We check attributes + inner text because modern builders (GHL, Elementor, Vue SPAs) often
  // put the CTA copy in aria-label/value and render the visible text via JS later.
  //
  // Implementation: we scan for tag OPENINGS only. On a 500KB page, a full
  // open-to-close regex blows up the backtracker. The opening tag alone gives
  // us position + attrs, and for visible-text resolution we walk forward a
  // bounded number of chars.
  let firstCtaIdx = -1;
  let firstCtaText: string | null = null;
  let firstCtaHref: string | null = null;

  const openTagRegex = /<(a|button|input)\b([^>]{0,2000})>/gi;
  let m: RegExpExecArray | null;
  while ((m = openTagRegex.exec(rawHtml)) !== null) {
    const tagName = m[1].toLowerCase();
    const attrs = m[2] || "";

    // Pull candidate text from: aria-label, value attr, title attr
    const ariaLabel = attrs.match(/\saria-label="([^"]+)"/i)?.[1]?.trim();
    const valueAttr = attrs.match(/\svalue="([^"]+)"/i)?.[1]?.trim();
    const titleAttr = attrs.match(/\stitle="([^"]+)"/i)?.[1]?.trim();
    const hrefAttr  = attrs.match(/\shref="([^"]+)"/i)?.[1] || null;
    const typeAttr  = attrs.match(/\stype="([^"]+)"/i)?.[1]?.toLowerCase();

    // For <input>: require a submit/button type — ignore hidden/text/email
    if (tagName === "input" && typeAttr && !/^(submit|button|image)$/.test(typeAttr)) {
      continue;
    }
    // For <a>: ignore javascript:/mailto:/tel: and email-protection, but ALLOW
    // on-page anchors (#form) because lots of pages use them to scroll to the order form.
    if (tagName === "a" && hrefAttr) {
      if (/^(javascript:|mailto:|tel:)/.test(hrefAttr)) continue;
      if (/cdn-cgi\/l\/email-protection/.test(hrefAttr)) continue;
    }

    // Resolve visible text by walking forward from tag end up to 1500 chars
    // looking for the matching </tag>. Bounded so we don't hang on malformed HTML.
    const tagEnd = m.index + m[0].length;
    const scanWindow = rawHtml.slice(tagEnd, tagEnd + 1500);
    const closeMatch = scanWindow.match(new RegExp(`</${tagName}\\s*>`, "i"));
    const innerHtml = closeMatch ? scanWindow.slice(0, closeMatch.index) : "";
    const visibleText = innerHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();

    const candidates = [ariaLabel, valueAttr, titleAttr, visibleText].filter(
      (s): s is string => !!s && s.length >= 2 && s.length <= 140
    );
    const hit = candidates.find(c => CTA_TEXT_PATTERNS.some(p => p.test(c)));
    if (hit) {
      firstCtaIdx = m.index;
      firstCtaText = hit;
      firstCtaHref = hrefAttr;
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
