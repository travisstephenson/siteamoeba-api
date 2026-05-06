/**
 * external-research.ts
 *
 * Daily agent that researches established CRO principles from the canon + academic
 * sources + performance marketing practitioners, and admits them into
 * brain_knowledge as context-tagged hypotheses.
 *
 * RULES:
 *   - Every external entry MUST cite a real source URL and a verbatim quote.
 *   - Every external entry MUST specify the CONDITIONS the claim applies to
 *     (page_type, traffic_source, offer_position, niche).
 *   - External entries are flagged source_type='external' so the brain never
 *     treats them as stat-proven. They're hypothesis priors for variant generation.
 *   - Auto-admit with citation (per user decision) — no human review queue.
 *     We dedupe via context_hash so the same principle won't land twice.
 */

import { pool } from "./storage";
import { callLLM, LLMConfig } from "./llm";
import crypto from "crypto";

interface ExternalResearchResult {
  principles_found: number;
  principles_admitted: number;
  principles_rejected: number;
  sample: any[];
  error?: string;
}

type SourceTier = "dr_canon" | "cro_academic" | "practitioner";

// COPYWRITING-ONLY query pool (May 2026 refocus).
// We deliberately strip out general UX / checkout / form-field / eye-tracking
// research because that's not what SiteAmoeba can affect for users — we change
// COPY, so the brain should be world-class at copy. Every query below pulls
// signal that maps to a section-type variant we can actually generate:
// headlines, subheadlines, body copy, CTAs, social proof copy, offer framing,
// guarantees, and named copy frameworks (Lego, F.A.T.E., R.I.C.E., AIDA, PAS,
// Pre-Suasion, etc.) the brain already knows about and uses in generation.
const QUERY_POOL: Array<{ tier: SourceTier; query: string }> = [
  // ---- Direct response canon: headline + body copy frameworks ----
  { tier: "dr_canon", query: "Eugene Schwartz Breakthrough Advertising market sophistication stages headline rewrite examples" },
  { tier: "dr_canon", query: "Gary Halbert proven direct mail headline formulas tested winners" },
  { tier: "dr_canon", query: "Joe Sugarman slippery slide copy first sentence opening hooks" },
  { tier: "dr_canon", query: "John Caples Tested Advertising Methods proven headline structures" },
  { tier: "dr_canon", query: "David Ogilvy long-form magazine ad copy headline subhead body principles" },
  { tier: "dr_canon", query: "Clayton Makepeace emotional copy triggers fear greed envy guilt" },
  { tier: "dr_canon", query: "Drayton Bird Commonsense Direct Marketing headline opener tactics" },
  { tier: "dr_canon", query: "Dan Kennedy Ultimate Sales Letter section structure copy" },
  { tier: "dr_canon", query: "Robert Collier sales letter principles emotional connection" },
  { tier: "dr_canon", query: "Victor Schwab How to Write a Good Advertisement five-step formula" },

  // ---- Named frameworks the SiteAmoeba Brain already uses ----
  { tier: "dr_canon", query: "Lego Method paired-fact body copy persuasion examples" },
  { tier: "dr_canon", query: "F.A.T.E. model Focus Authority Tribe Emotion landing page" },
  { tier: "dr_canon", query: "R.I.C.E. framework copy reward identity ideology emotion" },
  { tier: "dr_canon", query: "AIDA Attention Interest Desire Action sales copy" },
  { tier: "dr_canon", query: "Problem Agitate Solution PAS sales page body copy" },
  { tier: "dr_canon", query: "Cialdini Pre-Suasion priming opening pages high-conversion examples" },
  { tier: "dr_canon", query: "new bad guy enemy frame absolution sales copy" },
  { tier: "dr_canon", query: "unique mechanism naming formula sales page reveal" },
  { tier: "dr_canon", query: "earned borrowed proximal authority types sales copy" },
  { tier: "dr_canon", query: "identity-based copywriting tribe belonging messaging" },

  // ---- Headline structure / formulas (specific) ----
  { tier: "cro_academic", query: "how to write a headline split test data 2024 2025 specificity numbers" },
  { tier: "cro_academic", query: "contrarian headline frame conversion rate test results" },
  { tier: "cro_academic", query: "curiosity gap headline body copy psychology research" },
  { tier: "cro_academic", query: "specificity precise numbers headline conversion lift study" },
  { tier: "cro_academic", query: "question vs declarative headline conversion rate test" },
  { tier: "cro_academic", query: "how to headline vs benefit headline split test winners" },
  { tier: "cro_academic", query: "transformation outcome headline sales page conversion lift" },

  // ---- CTA / button / micro-commitment copy ----
  { tier: "cro_academic", query: "CTA button copy first person 'get my' vs 'submit' test results" },
  { tier: "cro_academic", query: "micro commitment ladder yes-set sales page copy" },
  { tier: "cro_academic", query: "action verb call to action button copy split test winners" },

  // ---- Social proof copy specifically (text, not just star ratings) ----
  { tier: "cro_academic", query: "specific numerical social proof copy lift over generic 'thousands trust us'" },
  { tier: "cro_academic", query: "testimonial quote selection believability sales page conversion" },
  { tier: "cro_academic", query: "identity-mirror testimonial wording conversion rate research" },

  // ---- Offer framing + guarantee copy ----
  { tier: "cro_academic", query: "price anchor sales copy how to frame discount stack" },
  { tier: "cro_academic", query: "risk reversal guarantee wording conversion lift research" },
  { tier: "cro_academic", query: "value stack bonus stack copy structure sales page" },

  // ---- Practitioner: what's working in copy *right now* ----
  { tier: "practitioner", query: "top performing direct response sales letter headlines 2025 swipe file" },
  { tier: "practitioner", query: "VSL hook opening lines high converting 2025" },
  { tier: "practitioner", query: "Facebook ad copy hook formulas working 2025 cold traffic" },
  { tier: "practitioner", query: "high-ticket sales page body copy patterns 2025 winners" },
  { tier: "practitioner", query: "info product sales page rewrite case study before after copy" },
  { tier: "practitioner", query: "DTC product page benefit-led copy patterns conversion 2025" },
  { tier: "practitioner", query: "email subject line opening hook conversion split test winners 2025" },
];

function dayOfYearRotation<T>(pool: T[]): T[] {
  // Pick ~3 queries per day, rotated, so we cover ~1 week per full sweep
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const n = 3;
  const start = (day * n) % pool.length;
  const selected: T[] = [];
  for (let i = 0; i < n; i++) {
    selected.push(pool[(start + i) % pool.length]);
  }
  return selected;
}

function normalizeContext(raw: {
  page_type?: string | null;
  section_type?: string | null;
  niche?: string | null;
  traffic_source?: string | null;
  offer_position?: string | null;
  winner_strategy?: string | null;
}): string {
  const parts = [
    raw.page_type || "",
    raw.section_type || "",
    (raw.niche || "").toLowerCase(),
    raw.traffic_source || "",
    raw.offer_position || "",
    raw.winner_strategy || "",
  ].join("||");
  return crypto.createHash("sha1").update("external:" + parts).digest("hex").slice(0, 16);
}

// ==================================================================
// Main runner
// ==================================================================

export async function runExternalResearch(): Promise<ExternalResearchResult> {
  const platformKey = process.env.PLATFORM_ANTHROPIC_KEY;
  if (!platformKey) {
    const err = "PLATFORM_ANTHROPIC_KEY not set";
    await pool.query(
      `INSERT INTO external_research_log (source_tier, query, error_message)
       VALUES ('system', 'skipped', $1)`,
      [err]
    );
    return { principles_found: 0, principles_admitted: 0, principles_rejected: 0, sample: [], error: err };
  }

  const llmConfig: LLMConfig = {
    provider: "anthropic",
    apiKey: platformKey,
    model: "claude-sonnet-4-20250514",
  };

  const queries = dayOfYearRotation(QUERY_POOL);

  let totalFound = 0;
  let totalAdmitted = 0;
  let totalRejected = 0;
  const sample: any[] = [];

  for (const { tier, query } of queries) {
    console.log(`[external-research] Running tier=${tier} query="${query}"`);
    try {
      const principles = await fetchPrinciplesForQuery(llmConfig, tier, query);
      totalFound += principles.length;

      let admitted = 0;
      let rejected = 0;
      for (const p of principles) {
        const outcome = await admitPrinciple(p, tier, query);
        if (outcome === "admitted") {
          admitted++;
          if (sample.length < 10) sample.push(p);
        } else {
          rejected++;
        }
      }
      totalAdmitted += admitted;
      totalRejected += rejected;

      await pool.query(
        `INSERT INTO external_research_log (source_tier, query, principles_found, principles_admitted, principles_rejected)
         VALUES ($1, $2, $3, $4, $5)`,
        [tier, query, principles.length, admitted, rejected]
      );
    } catch (err: any) {
      console.error(`[external-research] query failed: ${err.message}`);
      await pool.query(
        `INSERT INTO external_research_log (source_tier, query, error_message) VALUES ($1, $2, $3)`,
        [tier, query, err.message?.slice(0, 500)]
      );
    }
  }

  console.log(
    `[external-research] Run complete. found=${totalFound} admitted=${totalAdmitted} rejected=${totalRejected}`
  );
  return {
    principles_found: totalFound,
    principles_admitted: totalAdmitted,
    principles_rejected: totalRejected,
    sample,
  };
}

// ==================================================================
// LLM-backed extraction
// ==================================================================

interface ExternalPrinciple {
  principle: string;             // the insight in one sentence
  source_url: string;            // real URL
  source_citation: string;       // author/book/article
  verbatim_quote: string;        // at least one sentence from the source, verbatim
  condition: {                   // when this applies
    page_type?: string;
    section_type?: string;
    niche?: string;
    traffic_source?: string;
    offer_position?: string;
    winner_strategy?: string;
  };
  rationale: string;             // why this claim is credible
}

async function fetchPrinciplesForQuery(
  config: LLMConfig,
  tier: SourceTier,
  query: string
): Promise<ExternalPrinciple[]> {
  const prompt = `You are SiteAmoeba's COPYWRITING research agent. Your sole job is to identify proven *copywriting* and *sales-psychology* principles from established published sources — specifically things that change WORDS on a page — and return them as structured JSON for the knowledge base.

SEARCH FOCUS (this run): ${query}
SOURCE TIER: ${tier}

WHAT WE CARE ABOUT (admit these):
- Headline / subheadline structure, formulas, and patterns (specificity, contrarian, curiosity gap, transformation, identity, mechanism reveal)
- Body-copy techniques (Lego Method paired facts, Pre-Suasion priming, Problem-Agitate-Solution, AIDA, the New Bad Guy / enemy frame, story arcs, R.I.C.E. ideology-over-reward, identity-based messaging, micro-commitment ladder)
- Authority placement copy (earned vs borrowed vs proximal authority WORDING)
- Social-proof copy WORDING (specific numbers, identity-mirror testimonials, named outcomes)
- CTA button / link COPY (action verbs, first-person, specificity)
- Offer framing / value stack / risk-reversal / guarantee WORDING
- Pricing copy framing (anchoring, drop, chunking)
- Wallpaper-filter / pattern-interrupt opening lines

WHAT WE EXPLICITLY DO NOT WANT (reject these):
- Page LAYOUT, design, typography, color, button color, button size, image placement
- Form-field reduction, checkout flow, multi-step funnels (we don't change those)
- Eye-tracking studies, heatmap research about non-text elements
- Page load speed, anti-flicker, technical performance
- A/B test methodology / statistical-significance advice
- Generic 'use a clear CTA' / 'write compelling headlines' filler. We need *specific* claims with named frameworks or numbers.

Return 2–5 principles. HARD RULES:
1. Every principle MUST be about COPY — the actual words / phrasing on a page — not layout, UX, or technical CRO.
2. Every principle MUST have a real source_url pointing to a real published source (book, article, documented case study). Do NOT invent URLs.
3. Every principle MUST include at least one verbatim quote from the source.
4. Every principle MUST specify CONDITION:
   - page_type: sales_page | landing_page | optin | checkout | masterclass | pricing
   - section_type: headline | subheadline | cta | social_proof | guarantee | pricing | body_copy | hero_journey | offer_stack
   - optionally: niche, traffic_source (cold_paid | warm_email | organic), offer_position (above_fold | below_fold), winner_strategy (curiosity_gap | contrarian | social_proof | transformation | urgency | loss_aversion | specificity | feature_benefit | identity | lego_method | new_bad_guy | pre_suasion | mechanism_reveal | risk_reversal | authority_borrowed | authority_proximal)
5. Prefer principles that contradict naive copywriting advice (those are the ones the Brain can teach users they wouldn't know).

Return ONLY a JSON array, no markdown fences, matching this shape:
[
  {
    "principle": "One sentence summary describing a COPY change a user could make.",
    "source_url": "https://...",
    "source_citation": "Author, Book Title (Year)",
    "verbatim_quote": "Direct quote from the source.",
    "condition": { "page_type": "sales_page", "section_type": "headline", "traffic_source": "cold_paid", "winner_strategy": "specificity" },
    "rationale": "Why this claim is credible — cite the evidence."
  }
]`;

  const raw = await callLLM(config, [{ role: "user", content: prompt }], { maxTokens: 4000 });

  // Parse — strip code fences if any
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let arr: any[] = [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    // Try to find the array
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      try { arr = JSON.parse(m[0]); } catch { arr = []; }
    }
  }

  // Validate each principle
  const valid: ExternalPrinciple[] = [];
  for (const p of arr) {
    if (!p || typeof p !== "object") continue;
    if (typeof p.principle !== "string" || p.principle.length < 20) continue;
    if (typeof p.source_url !== "string" || !/^https?:\/\//.test(p.source_url)) continue;
    if (typeof p.verbatim_quote !== "string" || p.verbatim_quote.length < 15) continue;
    if (!p.condition || typeof p.condition !== "object") continue;
    valid.push({
      principle: p.principle,
      source_url: p.source_url,
      source_citation: p.source_citation || "",
      verbatim_quote: p.verbatim_quote,
      condition: p.condition,
      rationale: p.rationale || "",
    });
  }
  return valid;
}

// ==================================================================
// Admission into brain_knowledge
// ==================================================================

async function admitPrinciple(
  p: ExternalPrinciple,
  tier: SourceTier,
  query: string
): Promise<"admitted" | "duplicate" | "invalid"> {
  const ctxHash = normalizeContext(p.condition);

  // Dedupe: don't insert if the same context+source already exists
  const existing = await pool.query(
    `SELECT id FROM brain_knowledge
     WHERE source_type = 'external'
       AND (context_hash = $1 OR source_url = $2)
     LIMIT 1`,
    [ctxHash, p.source_url]
  );
  if (existing.rows.length > 0) return "duplicate";

  const tagsArr = [tier, ...(p.condition.winner_strategy ? [p.condition.winner_strategy] : [])];
  const insight = `${p.principle}\n\nSource quote: "${p.verbatim_quote.slice(0, 500)}"${p.rationale ? `\n\nWhy credible: ${p.rationale}` : ""}`;

  await pool.query(
    `INSERT INTO brain_knowledge
       (knowledge_type, page_type, niche, section_type, winning_text, insight, tags,
        source_type, source_url, source_citation, context_hash,
        traffic_source, offer_position, status, confirmation_count, created_at, last_confirmed_at)
     VALUES ('external_principle', $1, $2, $3, NULL, $4, $5,
             'external', $6, $7, $8, $9, $10, 'active', 0, NOW(), NOW())`,
    [
      p.condition.page_type || null,
      p.condition.niche || null,
      p.condition.section_type || null,
      insight,
      tagsArr.join(","),
      p.source_url,
      p.source_citation || null,
      ctxHash,
      p.condition.traffic_source || null,
      p.condition.offer_position || null,
    ]
  );
  return "admitted";
}
