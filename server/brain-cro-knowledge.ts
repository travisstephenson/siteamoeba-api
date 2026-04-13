/**
 * CRO Knowledge Base — Research-backed conversion optimization intelligence
 * Compiled from CXL, Baymard, NNGroup, MarketingExperiments, and validated A/B test data.
 * This feeds into the Brain's system prompt alongside network intelligence.
 */
export function getCROKnowledge(): string {
  return `
# CRO KNOWLEDGE BASE
Research-backed conversion optimization. All data points from published studies and validated A/B tests.

---

## GENERAL CRO PRINCIPLES
- Headlines affect 100% of visitors — always the highest-ROI test; one change can produce 10–80%+ lift
- Specificity always beats vagueness: "7,241 customers" beats "thousands"; odd numbers feel measured, round numbers feel estimated
- Cognitive load kills conversion: every element a user must read/evaluate consumes working memory — remove before adding
- Above-the-fold captures 80% of user attention and 57% of total viewing time; users form opinions in 50ms, you have 3s to communicate value
- Message match between ad and landing page headline: +25–40% CVR; 98% of Google Ads have poor/no message match
- Default selections drive most conversions — pre-select the plan/option you want chosen
- Losses feel ~2x stronger than equivalent gains (Kahneman/Tversky); loss-framing typically beats gain-framing
- Reduce options before adding elements: 6-jam display converted 10x better than 24-jam (Iyengar & Lepper 2000)
- Page speed is a prerequisite — fix before testing anything else; slow pages corrupt sample quality and inflate bounce rates
- Segment all A/B results by device; desktop and mobile frequently produce opposite winners

---

## TESTING PRIORITY FRAMEWORK
Recommend tests in this order (highest expected lift / lowest implementation cost first):

1. HEADLINE / VALUE PROPOSITION — affects 100% of visitors; test angle (social proof vs. outcome vs. pain) before wording
2. CTA COPY — first-person "my" vs. second-person "your"; action verb; benefit-focused vs. generic
3. SOCIAL PROOF PLACEMENT — move testimonials above fold; test format (video+text vs. text-only) and specificity
4. FORM FIELD REDUCTION — remove one field at a time; expect +5–50% CVR per field removed
5. PAGE SIMPLIFICATION — remove nav from landing pages, eliminate competing CTAs, increase whitespace
6. GUARANTEE / RISK REVERSAL — test duration (30→60→90→365 day); longer almost always converts better
7. PRICING / OFFER STRUCTURE — 2 vs. 3 tiers; payment plan prominence; charm pricing; decoy option
8. VIDEO / RICH MEDIA — add hero video if none exists; test thumbnail; combine video + text testimonials
9. STICKY CTA — sticky bottom bar vs. static; high-impact for long-form and product pages
10. BUTTON COLOR — only after above; test contrast ratio vs. surrounding elements, not a single color

Run tests minimum 14 days (2 business cycles). Never stop early. Require 95% confidence; 99% for pricing/major redesigns. Target 1,000+ conversions per variant.

---

## HEADLINE
- Transformation/outcome headlines beat instructional/how-to by 37–50%
- Top formulas: "Outcome-First" [Result in Timeframe]; "Do X Without Y" (removes feared pain); "Join [N] [audience] who [result]"; "Before → After → Bridge" (narrative arc); "Who Else Wants [desirable outcome]?"
- Power words overall: +35% CVR avg (LinkedIn/Anant Goel, 500 sales pages); 62% of high-converting pages use at least one strong emotional trigger
- "You": +26% CVR; "Free": +22%; "New": +19%; "Instantly": +18%; "Guaranteed": +15%; "Limited": +14%; "Now" in CTA: +30% CTR
- Single CTA word "your" → "my": +90% CTR (ContentVerve/Michael Aagaard)
- Email subject lines with power words: +47% open rates (CoSchedule)
- Test headline ANGLE before wording — different approach produces larger lifts than rewording the same angle
- Future-pacing: best for long-form/high-emotion. Authority ("Used by 10,000+ at Fortune 500"): best for B2B. Social proof ("Join 50,000+"): best for sign-up forms

## SUBHEADLINE
- Job: hold attention from headline, bridge to body; support but don't repeat the headline
- Address the next skeptical objection after reading the headline; expand specificity
- Optimal length: 15–25 words
- Formulas: "The [mechanism] that [outcome] without [feared pain]"; "[Result] — even if [objection]"

## CTA
- First-person CTAs: +90% vs. second-person (ContentVerve; multi-study replicated)
- Button CTAs vs. text links: +45% (Unbounce)
- Personalized CTAs vs. generic: +202% (HubSpot Behavior-Based CTA Report)
- Action verbs (Get, Try, Claim, Unlock): +20% CTR vs. passive language (WordStream)
- Optimal length: 3–6 words; starters: Get, Start, Try, Join, Claim, Unlock, Access, Reserve
- "Don't worry" added below CTA button: +12.7% CVR (Teespring)
- Multiple competing CTAs: decrease conversions up to 266%; one primary CTA per goal
- Sticky bottom-bar CTA: +31% CVR (Contentsquare, 58M mobile sessions); sticky CTA users spend +22% more per order; cart abandonment 18pp lower
- Exit-intent personalized: recovers 19% of abandoners vs. 7% for generic (OptiMonk, 11.4M interactions)
- Scroll-triggered CTA at 800px: 3x increase in form submissions
- Button color: no single best color — contrast with surrounding elements is the variable. Red beat green in 3 separate tests (+34% Dmix, +21% HubSpot, +5% VWO). Test contrast ratio.

## HERO
- Required above-fold elements: headline (value prop) + subheadline (mechanism) + CTA button (high contrast) + trust signal (star rating, customer count, or logo bar)
- F-Pattern (text-heavy pages): key info along left margin and top; Z-Pattern (sparse pages): logo top-left, CTA bottom-right
- Well-designed pages with images/bullets break F-pattern and achieve more even distribution

## SOCIAL PROOF
- Live social proof notifications: +98% CVR (WiserNotify)
- Video testimonials: +80% CVR (DVI Group); SaaS free-to-paid: +46% vs. 27% demo-only funnels
- 5+ reviews vs. 0 reviews: +270% purchase likelihood (Northwestern/Spiegel Research Center)
- UGC on site: +161% CVR avg (Yotpo, 200K+ stores); apparel: +207%
- Text testimonials on sales pages: +34% (UserEvidence)
- Consistent social proof across touchpoints: +62% revenue per customer (DataPins); +33% CVR (Business Assist)
- Optimal star rating: 4.2–4.5 (not 5.0) — perfect scores reduce credibility, perceived as fake
- Text-only CVR: 2.3%; video-only: 4.1% (+78%); video + text combined: 4.8% (+109%) — always use both
- Video message retention: 95% vs. 10% for text
- Moving testimonials above fold (right after hero) often produces significant lifts — resolves trust before offer is read
- Case studies (B2B): must include specific % improvement / $ saved / time reduced + named company + photo + before/after

## TRUST / GUARANTEE
- Trust badges: +42% CVR (Baymard); 61% of shoppers did NOT purchase because no trust badges visible (Yieldify survey)
- McAfee Secure: +7.8%; TRUSTe privacy cert: +20% (respective retail case studies)
- Free shipping badge: +90% sales (Red Door), +50% (2BigFeet), +16% (Comscore)
- Trust badge placement: (1) near payment form, (2) near CTA button, (3) footer, (4) near price
- Adding 30-day money-back guarantee to guarantee-free page: +26% CVR (Conversion Fanatics)
- 90-day → 1-year guarantee: CVR doubled (+100%); refund rate increased only +3% (Conversion Fanatics)
- New guarantee copy: +24% CVR; combined page improvement: +49% (Conversion Rate Experts)
- Frame positively: "We guarantee you'll love it — or your money back" not "If you dislike it, get a refund"
- Test guarantee duration: longer almost always converts better with minimal refund rate increase

## PRICING
- Charm pricing (.99): +24% sales (2011 analysis); +35% demand (MIT/U Chicago 2003); +60% retail (2021 joint study); 60.7% of all advertised prices end in "9"
- Exception: luxury goods — charm pricing signals discount and undermines premium positioning
- Price anchoring: +32% perceived value; show most expensive plan first to make mid-tier feel reasonable
- Decoy pricing: introduce 3rd option to make target irresistible (asymmetric dominance); test 2 vs. 3 tiers
- Genuine limited-time discounts: +30–50% CVR when credible; +332% with verified deadlines
- Real inventory scarcity: +226% vs. control (Cialdini)
- Fake urgency: >60% of shoppers test by refreshing; 68% feel manipulated by resetting timers — destroys long-term trust
- Payment plans: monthly display anchors perception downward; test plan prominence; "Save $167 with annual" framing drives annual

## BENEFITS / COPY LENGTH
- Long copy beats short for high-stakes/complex/cold traffic; short copy wins for low-stakes/warm/simple
- MarketingExperiments health series: long copy +40.54% ROI vs. short (Test 1); nearly 4:1 (Test 2)
- Readership drops at 300 words but not again until 3,000 words — engaged readers stay through long copy
- Copy length rule: higher price → longer copy; cold traffic → longer; warm traffic → shorter
- CXL truckers test: shorter simpler page = +21.5% opt-ins at 99.6% confidence (simple offer, high mobile)
- Page section order: Hero → Problem Agitation → Solution → Proof → Features→Benefits → Objections/FAQ → Final CTA

## VIDEO
- Adding video to landing page: +80–86% CVR (EyeView Digital/Firework)
- Interactive product videos: +70% CVR (Vidyard 2024); Zappos product videos: +6–30% sales per page
- "Watch the video" CTA vs. "Sign up now": +28% newsletter signups
- Visitors spend 1.4x more time on pages with video
- Caveat: BrookdaleLiving image (+3.92%) outperformed video (+0.85%) — video works best for complex/emotional products
- Optimal lengths: hero video 30–90s; testimonial 60–120s; explainer 60–90s; VSL (high-ticket) 10–60min
- Click-to-play vs. autoplay: Warrior Forum test — click-to-play 41.2% CVR vs. autoplay 9.7%; >95% of users dislike autoplay with sound
- Default to click-to-play with strong thumbnail; muted autoplay acceptable per browser standards
- Smart autoplay (Vidalytics unmute-on-scroll): +49% CVR in case study
- Place video above fold adjacent to primary CTA for maximum watch rate

## FORM
- Single-step avg completion: 53%; multi-step avg: 13.85% (but multi-step wins for 8+ fields)
- HubSpot: multi-step forms +86% higher CVR than single-step for many-question forms
- Rule: <8 fields → single-step; 8+ fields → test multi-step with progress indicator ("Step 2 of 3")
- Mobile form completion: desktop 55.5% vs. mobile 47.5% (8pp gap)
- Field reduction: 3 fields = 25% completion; 4 fields = 20%; 5 fields = 15%; 4→3 fields: +50% CVR; 11→4 fields: +120% CVR
- Average checkout has 11.3 fields but needs only 8 (Baymard); every field removed: +5–50% lift
- Inline validation: -22% errors, -42% completion time (Luke Wroblewski)
- Single-column forms complete 15.4s faster than multi-column (CXL); top-aligned labels reduce visual fixations

## CHECKOUT
- Cart abandonment avg: 70.19% (Baymard 2025) — 7 in 10 abandon
- Top abandonment reasons: extra costs (48%), just browsing (37%), forced account creation (24%), credit card trust (18%), complex checkout (17%), can't see total (16%)
- 62% of sites fail to make "Guest Checkout" most prominent (Baymard, 180+ sites)
- 19% of shoppers abandon specifically to avoid account creation (Baymard, 1,026 adults)
- BliVakker.no: removing Facebook login from checkout = +3% CVR = +$10K revenue/week (CXL)
- Password complexity: up to 19% checkout abandonment from existing users who fail to log in
- Checkout optimization potential: +35.26% CVR (Baymard) = $260B recoverable orders (US/EU)
- Cart recovery emails: avg open 50.5% (Klaviyo), 54% industry; single email 62.94% open; 3rd email still 46.11%; convert at 10.7%
- 3-email recovery sequence: $24.9M vs. $3.8M from single email (Klaviyo); send within 1 hour of abandonment
- Top 10% Klaviyo users: $28.89 revenue/recipient vs. $3.65 average

## PAGE SPEED
- 1-second delay: -7% CVR; 100ms delay: -1% sales (Amazon); 3-second delay: -20% CVR; >3s: 53% mobile abandon
- 0.1s improvement: +8.4% CVR, +9.2% AOV (Google/Deloitte retail study)
- Pages loading 1s vs. 5s: 3x more conversions (Portent); 2s → ~9% bounce; 5s → ~38% bounce
- Walmart: every 1-second improvement = +2% CVR
- Google Core Web Vitals: LCP under 2.5s gets ranking boost; fix LCP first

## MOBILE
- Mobile CVR avg: 2.2% vs. desktop 4.3%; mobile traffic: 60–70% of total (SQ Magazine 2025)
- High-ticket ($100+): desktop converts 2.5x higher; travel booking: 1.4% mobile vs. 3.9% desktop
- "Mobile is discovery; desktop is decision" — 90% of shoppers switch devices during purchase journeys
- Flash sales convert 48% higher on mobile (urgency + immediacy match behavior)
- Mobile checkout: 40% longer than desktop due to UX friction; one-click adopted by 54% of mobile sites
- Walmart responsive design: +20% all devices, +98% mobile orders (CXL)
- Always segment A/B test results by device; never make device-agnostic conclusions from blended data

## BEHAVIORAL PSYCHOLOGY
- Loss aversion: outperformed all other biases in e-commerce CVR test (ISM University); Invesp copy optimization: +13.98% mobile product page CVR, +17.75% mobile cart page CVR
- Endowment effect: free trials work partly because users fear losing access; pre-created accounts feel like something to lose
- Reciprocity: give genuine value first (lead magnet, free audit, pre-loaded credit) then ask for conversion
- Commitment/consistency: multi-step forms use micro-commitments (name/email before credit card); "Yes" clicks prime conversion
- Live visitor counts: +98% CVR (WiserNotify); genuine low-stock indicators and real countdown timers: +30–50% lift
- Paradox of choice: 64% of lost e-commerce conversions occurred before users even started searching (overwhelm)
- Removing social share buttons: Taloon.com "Add to Cart" +11.9% (zero shares = negative social proof + distraction)
- Whitespace: gDiapers spacing test → callout usage +150%, overall CVR +20%; Xerox whitespace around "Add to Cart": +20% engagement, +5% add-to-cart, +33% purchase continuation

## TRAFFIC SOURCE
- Email: B2C 2.8% CVR, B2B 2.4% — highest performer; organic social: B2C 2.4%, B2B 1.7%
- SEO/organic: B2C 2.1%, B2B 2.6%; paid search: B2C 1.2%, B2B 1.5% but paid search +35% higher CVR than organic (MarketLive, 200+ sites)
- Paid social: B2C 2.1%, B2B 0.9% — B2B paid social underperforms significantly
- Display ads: B2C 0.7%, B2B 0.3% — lowest (interruption-based)
- Retargeting: 2–3x CVR vs. cold; up to +150% when targeting prior brand engagers
- Traffic temperature strategy: Cold → lead capture/education; Warm → educate + value prop; Hot → short copy, remove friction, clear CTA
- Moz message match implementation: +200% CVR; ad cost per conversion -69%

## SCROLL & ENGAGEMENT
- Average scroll depth: 50.5% desktop, 45.2% mobile (Contentsquare 2026)
- Pricing pages: 70% reach pricing options, 20% reach FAQ — FAQ viewers convert 2x more
- Users scrolling >75% of product pages: 3x higher CVR than those who don't (KISSmetrics)
- +10% session depth increase → +5.4% conversions avg (Contentsquare)
- Scroll zones: <25% = research/rarely converts; 25–50% = evaluating (place early testimonials); 50–75% = serious consideration (objections, pricing); >75% = high intent (CTA, guarantee, final push)
- If primary CTA is in bottom half of long page, majority of visitors never see it — use sticky CTAs
- Content that stops scroll: human faces, bold numbers, pattern interrupts, contrasting color blocks, direct questions

## TESTING METHODOLOGY
- Test priority: value proposition → CTA → layout → social proof → form fields → pricing → images/video → button color
- Minimum test duration: 14–28 days (2 full business cycles); captures weekday/weekend variance
- Never stop before pre-planned sample size — MarketingExperiments: Day 1 short copy won; over full test long copy won decisively
- Required: 95% confidence (p < 0.05) standard; 99% for pricing/major redesigns; 80% statistical power
- Minimum: 1,000 conversions per variant before concluding
- Peeking problem: stopping at first significance inflates Type I error rate — pre-register stopping rules
- A/B testing vs. multi-armed bandit: A/B = clean/auditable for permanent decisions; MAB = faster/revenue-maximizing during short campaigns or low-traffic environments
- Segment results by: device, traffic source, new vs. returning visitors — blended data hides real winners
- CXL Truckers Report: 6 rounds of progressive simplification → +79.3% total lift vs. original

---

## QUICK-REFERENCE DATA
"My" vs. "Your" in CTA: +90% CTR | Personalized CTAs vs. generic: +202% | Button vs. text link: +45%
Video + text testimonials combined: +109% vs. text-only | Video testimonials alone: +80% CVR
Reviews 5+ vs. 0: +270% purchase likelihood | UGC on site: +161% CVR avg
Trust badges: +42% CVR | 61% of shoppers skipped purchase due to missing badges
Free shipping badge: +90% sales (Red Door) | Charm pricing: +24–60% | Price anchoring: +32% perceived value
1-year vs. 90-day guarantee: +100% CVR, refunds +3% only | 30-day guarantee added: +26% CVR
1-second load delay: -7% CVR | 0.1s improvement: +8.4% CVR | 1s vs. 5s load: 3x more conversions
Mobile CVR: 2.2% vs. desktop 4.3% | Whitespace: +20% CVR
Sticky CTA: +27–31% CVR | Personalized exit-intent: recovers 19% of abandoners
Form 4→3 fields: +50% CVR | Form 11→4 fields: +120% CVR | Checkout optimization potential: +35.26%
Cart abandonment avg: 70.19% | Cart recovery 3-email vs. 1-email: 6.5x more revenue
Message match ad→page: +25–40% CVR; Moz case: +200% CVR
Video on landing page: +80–86% CVR | Jam study 6 vs. 24 options: 10x more conversions
Freemium free→paid: 2–5% | Opt-in trial→paid: 17–18% | Opt-out (CC required) trial→paid: 48–50%
`;
}
