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

// Rotate through these query seeds so the agent explores the landscape over time
// rather than hammering the same topic every day. Day-of-year modulo pool length.
const QUERY_POOL: Array<{ tier: SourceTier; query: string }> = [
  // Direct response canon
  { tier: "dr_canon", query: "Eugene Schwartz market sophistication stages headline principles" },
  { tier: "dr_canon", query: "Gary Halbert headline formulas direct response" },
  { tier: "dr_canon", query: "Joe Sugarman slippery slide copy principles" },
  { tier: "dr_canon", query: "John Caples proven headline formulas Tested Advertising" },
  { tier: "dr_canon", query: "David Ogilvy long form copy principles" },
  { tier: "dr_canon", query: "Clayton Makepeace emotional copy triggers" },
  { tier: "dr_canon", query: "Drayton Bird direct response fundamentals" },
  { tier: "dr_canon", query: "AIDA copywriting framework examples conversions" },

  // CRO research + academic
  { tier: "cro_academic", query: "Baymard Institute checkout usability research 2025" },
  { tier: "cro_academic", query: "NN Group landing page eye tracking studies" },
  { tier: "cro_academic", query: "ConversionXL headline a/b test meta analysis" },
  { tier: "cro_academic", query: "Cialdini scarcity urgency conversion research" },
  { tier: "cro_academic", query: "Kahneman loss aversion landing page studies" },
  { tier: "cro_academic", query: "form field reduction conversion rate research" },
  { tier: "cro_academic", query: "social proof numeric specificity landing page research" },
  { tier: "cro_academic", query: "video sales letter conversion rate studies" },

  // Practitioners actively running ads
  { tier: "practitioner", query: "best performing Facebook ad headline patterns 2025" },
  { tier: "practitioner", query: "VSL conversion optimization 2025 high ticket offers" },
  { tier: "practitioner", query: "CTA button copy test winners direct response 2025" },
  { tier: "practitioner", query: "sales page headline structure cold traffic 2025" },
  { tier: "practitioner", query: "subheadline conversion a b test results" },
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
  const prompt = `You are a CRO research agent. Your job is to identify proven copywriting or landing-page conversion principles from ESTABLISHED published sources and return them as structured JSON for ingestion into a knowledge base.

SEARCH FOCUS (this run): ${query}
SOURCE TIER: ${tier}

Return 2-5 principles. HARD RULES:
1. Every principle MUST have a real source_url pointing to a real published source (book reference, article, study, documented case study). Do NOT invent URLs.
2. Every principle MUST include at least one verbatim quote from the source that supports the claim.
3. Every principle MUST specify the CONDITION under which it applies — page_type (sales_page|landing_page|optin|checkout|masterclass), section_type (headline|subheadline|cta|social_proof|guarantee|pricing|body_copy), and optionally niche, traffic_source (cold_paid|warm_email|organic), offer_position (above_fold|below_fold|linked_page), and winner_strategy (curiosity_gap|contrarian|social_proof|transformation|urgency|loss_aversion|specificity|feature_benefit).
4. Skip common-sense filler. Do NOT return "use a clear CTA" or "write compelling headlines." Only specific, actionable principles with numbers or named frameworks.
5. Prefer principles that conflict with common copywriting advice (these are the most valuable).

Return ONLY a JSON array, no markdown fences, matching this shape:
[
  {
    "principle": "One sentence summary.",
    "source_url": "https://...",
    "source_citation": "Author, Book Title (Year)",
    "verbatim_quote": "Direct quote from the source.",
    "condition": { "page_type": "sales_page", "section_type": "headline", "traffic_source": "cold_paid" },
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
