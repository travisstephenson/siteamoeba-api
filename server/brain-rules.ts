/**
 * brain-rules.ts
 *
 * Page-type context rules for the Brain.
 * These are HARD RULES injected into every Brain prompt — not suggestions.
 * The LLM must treat them as absolute constraints.
 */

/**
 * Returns a block of HARD RULES based on page type and goal.
 * Inject these into every Brain prompt (chat + variant generation).
 *
 * @param pageType  e.g. "sales_page", "opt_in_page", "webinar_registration", "product_page", "checkout_page", "landing_page"
 * @param pageGoal  e.g. "direct_purchase", "lead_capture", "webinar_signup", "free_trial", "demo_request"
 * @param pricePoint  optional price string, e.g. "$27", "$497"
 * @param niche  optional detected niche, e.g. "info product", "SaaS", "e-commerce"
 */
export function getPageContextRules(
  pageType: string | null | undefined,
  pageGoal: string | null | undefined,
  pricePoint?: string | null,
  niche?: string | null
): string {
  // Normalize to defaults so the Brain always has context
  const type = pageType || "sales_page";
  const goal = pageGoal || "direct_purchase";

  const priceInfo = pricePoint ? `\nProduct price point: ${pricePoint}` : "";
  const nicheInfo = niche ? `\nNiche/industry: ${niche}` : "";

  const pageContext = `## PAGE CONTEXT
Page type: ${type}
Page goal: ${goal}${priceInfo}${nicheInfo}`;

  let pageTypeRules = "";

  if (type === "sales_page" || goal === "direct_purchase") {
    pageTypeRules = `
## PAGE-TYPE RULES: SALES PAGE (Direct Purchase)
- NEVER suggest sending traffic elsewhere — no lead magnets, no other pages, no "build an email list first" advice. The visitor is ON the page. Keep them there.
- NEVER suggest reducing the price, making it free, or a freemium model. The price is set. Optimize the copy.
- NEVER suggest adding an opt-in step before purchase — this is a direct-response sales page.
- Focus ALL suggestions on: headline optimization, objection handling, social proof, guarantee strengthening, CTA optimization, value stacking, urgency/scarcity (real, not manufactured).
- Micro-commitments on this page = psychological within-page agreements (yes-ladder in copy, expanding sections, watching a video, "See if you qualify" step before the buy button). NOT multi-page funnels.
- The Lego Method belongs ONLY in body copy, story, or hero journey sections. NEVER in headlines or CTAs.
- Loss aversion (fear of missing out, cost of inaction) is your strongest tool on a sales page. Use it in body copy.`;
  } else if (type === "opt_in_page" || goal === "lead_capture") {
    pageTypeRules = `
## PAGE-TYPE RULES: OPT-IN PAGE (Lead Capture)
- Focus on: headline clarity, the value proposition of the freebie/lead magnet, reducing friction, trust signals.
- Keep suggestions SHORT and SIMPLE — opt-in pages should be minimal. The fewer the elements, the higher the conversion.
- NEVER suggest adding pricing, guarantees (there is no purchase), product stacks, or bonuses — these belong on sales pages.
- NEVER suggest adding more copy — opt-in pages convert better with less.
- The CTA should focus on the free value being delivered, not sales language. "Get My Free Guide" beats "Buy Now" and also beats "Submit".
- Trust signals here mean: no spam pledge, privacy assurance, maybe a quick social proof count ("Join 10,000+ marketers").
- Do NOT suggest micro-commitment sequences — a single-step opt-in is the goal.`;
  } else if (type === "webinar_registration" || goal === "webinar_signup") {
    pageTypeRules = `
## PAGE-TYPE RULES: WEBINAR REGISTRATION PAGE
- Focus on: authority signals, curiosity about what they'll learn, social proof (attendee count, past participant results), urgency (date/time of the webinar).
- NEVER suggest product pricing, money-back guarantees, or extended sales copy — there is nothing to buy yet.
- NEVER suggest adding multiple CTAs or sending visitors elsewhere — every action should drive to registration.
- The headline should focus on the transformation or revelation they'll experience ON the webinar, not the webinar itself.
- Urgency is genuine here: use the actual date/time. "Starts Thursday at 8 PM EST" beats vague urgency.
- Keep the form minimal — name and email only. Every extra field kills conversion.`;
  } else if (type === "product_page" || type === "ecommerce_page") {
    pageTypeRules = `
## PAGE-TYPE RULES: PRODUCT PAGE (E-Commerce)
- Focus on: product imagery and description quality, reviews/ratings specificity, shipping/return info clarity, comparison to alternatives.
- Psychology here is different from long-form sales pages — buyers are in browse mode, not read-everything mode.
- NEVER suggest adding long-form copy, hero journey stories, or extensive objection-handling sections — keep it scannable.
- The primary CTA must be above the fold and visually dominant.
- Social proof = reviews with specifics (star ratings, number of reviews, highlighted quotes). Generic "customers love it" is weak.
- Shipping info and return policy reduce purchase anxiety — test surfacing these more prominently.
- Price anchoring works: show original price crossed out next to the sale price.`;
  } else if (type === "checkout_page") {
    pageTypeRules = `
## PAGE-TYPE RULES: CHECKOUT PAGE
- Focus on: reducing friction, trust signals at point of purchase, order bump optimization.
- NEVER suggest driving traffic away or adding content — the buyer is ready to pay. Get out of their way.
- Trust signals: security badges, payment logos, refund policy reminder near the CTA.
- Minimize form fields — every extra field increases abandonment.
- An order bump (a relevant add-on below the main product) can increase AOV 20-30% — if there isn't one, suggest testing it.
- The headline should confirm what they're getting, not resell it — they've already decided.
- Urgency here is appropriate if there is a real reason (limited stock, bonus expiring).`;
  } else {
    // landing_page or generic
    pageTypeRules = `
## PAGE-TYPE RULES: LANDING PAGE
- Consider the single conversion goal of this page and make every suggestion serve that goal.
- NEVER suggest adding elements that distract from the primary CTA — landing pages should be single-purpose.
- Remove navigation, external links, and anything that pulls attention away from conversion.
- Focus on: clarity of value proposition, proof that the offer delivers, friction reduction.`;
  }

  const absoluteRules = `
## ABSOLUTE TECHNIQUE-TO-SECTION RULES (override everything else — no exceptions)
- **Lego Method** → ONLY in body_copy, hero_journey, or story sections. NEVER in headlines, subheadlines, or CTAs.
- **Pre-Suasion / Priming** → ONLY in body_copy sections that appear BEFORE the main offer reveal.
- **Micro-commitments on sales pages** → within-page ONLY (yes-ladder in copy, interactive elements, "See if you qualify" step). NOT multi-page funnels. NOT email sequences.
- **Headline techniques** → ONLY: pattern interrupt, specificity (exact numbers), curiosity gap, bold claims with proof, named enemy ("New Bad Guy"). Nothing else.
- **CTA techniques** → ONLY: strong action verbs, benefit framing, urgency/scarcity language, first-person framing ("Start My Trial"). Never long copy, stories, or frameworks.
- **NEVER suggest redirecting traffic away from the page being optimized.** The visitor is there. Keep them.
- **NEVER suggest adding elements that don't match the page type** (e.g., pricing tables on an opt-in page, guarantee copy where there's no purchase).
- **When referencing a named framework** (Lego Method, R.I.C.E., F.A.T.E., Pre-Suasion, etc.), ALWAYS explain it in 1 plain-English sentence. Never assume the user knows the acronym.`;

  return `${pageContext}\n${pageTypeRules}\n${absoluteRules}`;
}
