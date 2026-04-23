// ============================================================================
// CARROT RECOMMENDATION ENGINE
// ----------------------------------------------------------------------------
// When visitors drop off between two sections it usually means the END of the
// previous section closed a psychological loop — the reader felt "done," so
// they bounced. The fix is a "carrot": a cliffhanger line at the end of the
// previous section that OPENS a new loop and pulls the reader into the next
// section.
//
// This module produces that carrot. It reads the campaign's section_map +
// real-time dropoff data, figures out which section the reader just finished
// before they left, and asks the LLM to:
//   1. Diagnose WHY that loop closed (one crisp sentence)
//   2. Write 3 cliffhanger lines the user can paste onto the end of that
//      section — matched to the page's language and tone.
//
// Results are cached on campaigns.section_dropoff_recommendation and only
// regenerated when the biggest-drop section index changes or the magnitude
// shifts ≥ 5 percentage points.
// ============================================================================

import { callLLM, type LLMConfig } from "./llm";
import type { LLMMessage } from "./llm";
import { pool } from "./storage";

export interface CarrotCache {
  sectionIdx: number;        // the section people are dropping OFF of
  dropPct: number;           // % drop from prev section
  prevHeading: string;       // heading of the section BEFORE the drop
  prevLabel: string;         // classifier label of the section BEFORE the drop
  nextHeading: string;       // heading of the section they didn't reach
  diagnosis: string;         // 1-sentence explanation of why the loop closed
  cliffhangers: string[];    // 3 suggested carrot lines
  lang: string;              // detected language of the page (en, it, es, ...)
  generatedAt: string;       // ISO timestamp
}

export interface SectionForCarrot {
  idx: number;
  label: string;
  heading: string;
  offsetPct: number;
  reachPct: number;
  dropFromPrev?: number;
}

/**
 * Detect page language from the first meaningful heading we have.
 *
 * Heuristic that requires THREE distinct language-specific token matches
 * before declaring a non-English language. Single "a" / "o" / "la" / "el"
 * are ambiguous across languages (especially on English caps pages like
 * "A HIGH PROFIT DIGITAL PRODUCT") so we only count multi-letter tokens
 * or tokens with diacritics as strong signals.
 *
 * The LLM still gets the actual sample text and will write in the right
 * language regardless — this is only used to bias the instruction label.
 */
function detectLang(sample: string): string {
  const s = sample.toLowerCase();
  const hit = (re: RegExp): number => {
    const m = s.match(re);
    return m ? m.length : 0;
  };

  const scores: Record<string, number> = {
    it: hit(/\b(che|sono|questo|della|delle|quando|come funziona|garanzia|prezzo|acquist|ordina|adesso|più|perché|anche|ancora|hanno|vuoi)\b/g),
    es: hit(/\b(que|este|esta|cómo|para|garantía|precio|comprar|ahora|también|usted|tu |más|porque|después|además)\b/g),
    pt: hit(/\b(que|este|esta|como|para|garantia|preço|comprar|agora|você|também|mais|porque|depois|não|são|aqui)\b/g),
    fr: hit(/\b(que|ce|comme|pour|garantie|acheter|maintenant|vous|aussi|plus|parce|avec|à présent|déjà|très|merci)\b/g),
    de: hit(/\b(der|die|das|wie|für|garantie|preis|kaufen|jetzt|auch|mehr|weil|sehr|mit|nicht|sind|können)\b/g),
  };

  // Require at least 2 distinct hits AND a clear winner (2x the next language)
  let best: [string, number] = ["en", 0];
  let runnerUp = 0;
  for (const [lang, n] of Object.entries(scores)) {
    if (n > best[1]) { runnerUp = best[1]; best = [lang, n]; }
    else if (n > runnerUp) { runnerUp = n; }
  }
  if (best[1] >= 2 && best[1] >= runnerUp * 2) return best[0];
  return "en";
}

/**
 * Decide whether the cached carrot is still valid.
 * Invalidate when:
 *   - the biggest-drop section index changed
 *   - the drop magnitude moved by >= 5 percentage points
 *   - the cached heading no longer matches the section map (page was edited)
 *   - the cache is older than 14 days
 */
export function isCarrotStale(
  cache: CarrotCache | null,
  current: { sectionIdx: number; dropPct: number; prevHeading: string },
): boolean {
  if (!cache) return true;
  if (cache.sectionIdx !== current.sectionIdx) return true;
  if (Math.abs(cache.dropPct - current.dropPct) >= 5) return true;
  if ((cache.prevHeading || "").trim() !== (current.prevHeading || "").trim()) return true;
  const ageMs = Date.now() - new Date(cache.generatedAt).getTime();
  if (ageMs > 14 * 24 * 60 * 60 * 1000) return true;
  return false;
}

/**
 * Build the LLM prompt for a carrot recommendation.
 *
 * The shape we want back is a structured JSON blob with:
 *   - diagnosis: one sentence explaining why the loop closed
 *   - cliffhangers: 3 distinct cliffhanger lines in the page's language
 *
 * We explicitly tell the LLM to:
 *   - write in the same language as the page copy sample
 *   - match the emotional register of the section it's bridging from/to
 *   - use open-loop techniques (pattern interrupt, specificity gap,
 *     curiosity, teased transformation, contrarian tease)
 *   - NOT add hype or exclamation points unless the surrounding tone has them
 */
function buildCarrotMessages(params: {
  campaignName: string;
  campaignUrl: string;
  niche?: string | null;
  pageType?: string | null;
  prevSection: SectionForCarrot;
  nextSection: SectionForCarrot;
  dropPct: number;
  prevSectionSample: string;
  nextSectionSample: string;
  allSections: SectionForCarrot[];
  lang: string;
}): LLMMessage[] {
  const {
    campaignName, campaignUrl, niche, pageType,
    prevSection, nextSection, dropPct,
    prevSectionSample, nextSectionSample, allSections, lang,
  } = params;

  const langMap: Record<string, string> = {
    it: "Italian (match the exact tone of the page — do not translate from English)",
    es: "Spanish (match the exact tone of the page)",
    pt: "Portuguese (match the exact tone of the page)",
    fr: "French (match the exact tone of the page)",
    de: "German (match the exact tone of the page)",
    en: "English (match the exact tone of the page)",
  };
  const langInstruction = langMap[lang] || langMap.en;

  const systemPrompt = `You are a direct-response copywriter specializing in sales page flow and open-loop copy techniques. You have studied Eugene Schwartz, Dan Kennedy, Gary Halbert, Parris Lampropoulos, and the modern VSL greats.

Your job is to fix a specific problem on a sales page: a visitor drop-off between two sections.

THE CORE INSIGHT — THE "CARROT" PRINCIPLE
When visitors drop off between two sections, it almost always means the END of the section they just finished closed a psychological loop. The reader felt "done" — the idea resolved, the thought completed, the curiosity satisfied — so their brain said "I have enough, I can leave."

The fix is NOT to make the next section flashier. The fix is to add a cliffhanger line to the END of the section they just finished — a "carrot" that opens a NEW loop and pulls them forward. Examples:
- "And what came next blew me away..."
- "But here's the part nobody tells you..."
- "Then I discovered the one variable that changed everything..."
- "Before I show you how, there's something you need to see first..."

The carrot must:
1. Open an unresolved question, surprise, or tension in the reader's mind
2. Hint specifically at what's coming next (so it doesn't feel generic)
3. Match the page's emotional register and language
4. Be ONE line — not a paragraph

## OUTPUT FORMAT
Return a single JSON object. No prose, no code fences. Schema:
{
  "diagnosis": "One sentence (max 25 words) explaining why the loop closed at the end of the prev section. Be specific. Reference the actual content.",
  "cliffhangers": [
    "First cliffhanger line — open loop, specific hint at next section",
    "Second cliffhanger line — different angle/technique (e.g. specificity gap)",
    "Third cliffhanger line — different angle/technique (e.g. contrarian tease)"
  ]
}

## RULES
- Write the cliffhangers in: ${langInstruction}
- Diagnosis in English (internal operator briefing).
- Cliffhangers must feel like they were written by whoever wrote the page, not injected by a tool. Match their voice and punctuation style.
- Do NOT use exclamation points unless the surrounding copy uses them heavily.
- Each cliffhanger must be genuinely different — not three rewordings of the same sentence. Different open-loop techniques: surprise, specificity gap, contrarian tease, promised reveal, pattern interrupt.
- Never use clichés like "you won't believe what happened next" or "the results will shock you" unless the page is already in that register.
- If the previous section's tone is clinical/medical/professional, use restrained cliffhangers. If it's conversational/storytelling, be punchier.
- NEVER reference a specific number/stat/claim that isn't already in the page copy you were given.`;

  const pageStructure = allSections.map((s, i) => {
    const marker = i === prevSection.idx ? " ← reader finished here"
                 : i === nextSection.idx ? " ← reader bounced before reaching"
                 : "";
    const title = s.heading || s.label;
    return `  ${i}. [${s.offsetPct}%] ${title} (${s.reachPct}% reach)${marker}`;
  }).join("\n");

  const userMessage = `CAMPAIGN: "${campaignName}"
URL: ${campaignUrl}
${niche ? `NICHE: ${niche}\n` : ""}${pageType ? `PAGE TYPE: ${pageType}\n` : ""}DETECTED LANGUAGE: ${lang}

PAGE STRUCTURE (all sections in order, with % of visitors who reached each):
${pageStructure}

THE DROP-OFF
${dropPct}% of visitors leave between section ${prevSection.idx} ("${prevSection.heading || prevSection.label}") and section ${nextSection.idx} ("${nextSection.heading || nextSection.label}").

SECTION THEY JUST FINISHED (where the loop closed — this is where the carrot goes):
---
${prevSectionSample.slice(0, 1200)}
---

SECTION THEY DIDN'T REACH (what the carrot should hint toward):
---
${nextSectionSample.slice(0, 1200)}
---

TASK
Write a carrot — three cliffhanger lines — that belongs at the END of the section they just finished. Each cliffhanger should open a loop that only gets resolved by reading the next section. Return JSON exactly matching the schema in your system prompt.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
}

/**
 * Extract representative text for a section from the campaign's stored
 * scan_data (if available). Falls back to heading + label so the LLM
 * at least has something to ground on.
 */
async function fetchSectionSample(
  campaignId: number,
  section: SectionForCarrot,
): Promise<string> {
  // We try to pull section-level text from the latest scan. The scan stores
  // full page text but not per-section slices, so for now we return the
  // heading + label so the LLM at least has an anchor. If we later add
  // per-section text capture this is the one place to upgrade.
  const headingPart = section.heading ? section.heading.trim() : "";
  const labelPart = section.label ? section.label.replace(/_/g, " ") : "";
  const parts = [headingPart, labelPart].filter(Boolean);
  if (parts.length === 0) return `Section at ${section.offsetPct}% of page height.`;
  return parts.join(" — ");
}

/**
 * Main entry point: generate or return a cached carrot recommendation.
 *
 * Returns null if no meaningful drop-off exists.
 */
export async function getCarrotRecommendation(params: {
  campaignId: number;
  campaign: { name: string; url: string; niche?: string | null; pageType?: string | null };
  sections: SectionForCarrot[];
  llmConfig: LLMConfig | null;
}): Promise<CarrotCache | null> {
  const { campaignId, campaign, sections, llmConfig } = params;
  if (!sections || sections.length < 2) return null;

  // Find the biggest drop-off point (skip footer)
  let biggestIdx = -1;
  let biggestDrop = 0;
  for (let i = 1; i < sections.length; i++) {
    const drop = sections[i].dropFromPrev ?? 0;
    if (drop > biggestDrop && sections[i].label !== "footer") {
      biggestDrop = drop;
      biggestIdx = i;
    }
  }
  if (biggestIdx < 0 || biggestDrop < 5) return null; // nothing worth a carrot

  const prevSection = sections[biggestIdx - 1];
  const nextSection = sections[biggestIdx];

  // Load existing cache
  let cache: CarrotCache | null = null;
  try {
    const cacheResult = await pool.query(
      "SELECT section_dropoff_recommendation FROM campaigns WHERE id = $1",
      [campaignId]
    );
    const raw = cacheResult.rows[0]?.section_dropoff_recommendation;
    if (raw && typeof raw === "object") cache = raw as CarrotCache;
  } catch { /* non-fatal */ }

  const currentState = {
    sectionIdx: biggestIdx,
    dropPct: biggestDrop,
    prevHeading: prevSection.heading || prevSection.label,
  };

  if (!isCarrotStale(cache, currentState) && cache) {
    return cache;
  }

  // Stale or missing — regenerate. If we have no LLM config (free user,
  // no platform key), return a structural hint WITHOUT LLM copy so the
  // UI still shows useful guidance.
  if (!llmConfig) {
    return {
      sectionIdx: biggestIdx,
      dropPct: biggestDrop,
      prevHeading: prevSection.heading || prevSection.label,
      prevLabel: prevSection.label,
      nextHeading: nextSection.heading || nextSection.label,
      diagnosis: `The end of "${prevSection.heading || prevSection.label}" is closing a loop — readers feel done and leave before reaching "${nextSection.heading || nextSection.label}".`,
      cliffhangers: [
        "And what came next blew me away...",
        "But there was one thing I still hadn't figured out...",
        "Before I show you how, there's something you need to see first...",
      ],
      lang: "en",
      generatedAt: new Date().toISOString(),
    };
  }

  // Gather samples for the LLM
  const prevSample = await fetchSectionSample(campaignId, prevSection);
  const nextSample = await fetchSectionSample(campaignId, nextSection);

  const langSample = [
    prevSection.heading, nextSection.heading,
    sections.map(s => s.heading).filter(Boolean).slice(0, 5).join(" "),
  ].filter(Boolean).join(" ").slice(0, 500);
  const lang = detectLang(langSample);

  const messages = buildCarrotMessages({
    campaignName: campaign.name,
    campaignUrl: campaign.url,
    niche: campaign.niche,
    pageType: campaign.pageType,
    prevSection,
    nextSection,
    dropPct: biggestDrop,
    prevSectionSample: prevSample,
    nextSectionSample: nextSample,
    allSections: sections,
    lang,
  });

  let parsed: { diagnosis: string; cliffhangers: string[] } | null = null;
  try {
    const raw = await callLLM(llmConfig, messages, { maxTokens: 600 });
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const maybe = JSON.parse(cleaned);
    if (maybe && typeof maybe.diagnosis === "string" && Array.isArray(maybe.cliffhangers)) {
      const cleanedCliff = maybe.cliffhangers
        .filter((c: any) => typeof c === "string" && c.trim().length > 0)
        .map((c: string) => c.trim().replace(/^["'""]|["'""]$/g, ""))
        .slice(0, 3);
      if (cleanedCliff.length >= 2) {
        parsed = { diagnosis: maybe.diagnosis.trim(), cliffhangers: cleanedCliff };
      }
    }
  } catch (err) {
    console.error("[carrot] LLM parse failed, using structural fallback:", (err as Error).message);
  }

  const result: CarrotCache = parsed ? {
    sectionIdx: biggestIdx,
    dropPct: biggestDrop,
    prevHeading: prevSection.heading || prevSection.label,
    prevLabel: prevSection.label,
    nextHeading: nextSection.heading || nextSection.label,
    diagnosis: parsed.diagnosis,
    cliffhangers: parsed.cliffhangers,
    lang,
    generatedAt: new Date().toISOString(),
  } : {
    // LLM failed — return structural fallback (never block the UI)
    sectionIdx: biggestIdx,
    dropPct: biggestDrop,
    prevHeading: prevSection.heading || prevSection.label,
    prevLabel: prevSection.label,
    nextHeading: nextSection.heading || nextSection.label,
    diagnosis: `Readers finish "${prevSection.heading || prevSection.label}" feeling the idea has resolved, so they leave before reaching "${nextSection.heading || nextSection.label}".`,
    cliffhangers: [
      "And what came next blew me away...",
      "But there was one thing I still hadn't figured out...",
      "Before I show you the how, there's something you need to see first...",
    ],
    lang,
    generatedAt: new Date().toISOString(),
  };

  // Persist the cache
  try {
    await pool.query(
      "UPDATE campaigns SET section_dropoff_recommendation = $1 WHERE id = $2",
      [JSON.stringify(result), campaignId]
    );
  } catch { /* non-fatal */ }

  return result;
}

/**
 * Convenience wrapper: read the campaign's section_map + live visitor
 * scroll data and return the current carrot.
 *
 * Used by Daily Observations, Autopilot, and Brain Chat so they share
 * the exact same insight data as the UI. Returns null if there isn't
 * enough data to produce a meaningful carrot.
 */
export async function getCarrotForCampaign(
  campaignId: number,
  llmConfig: LLMConfig | null,
): Promise<CarrotCache | null> {
  // Load section map + campaign metadata
  const campaignRow = await pool.query(
    "SELECT id, name, url, niche, page_type, section_map FROM campaigns WHERE id = $1",
    [campaignId]
  );
  const campaign = campaignRow.rows[0];
  if (!campaign) return null;

  const sectionMap = campaign.section_map;
  if (!sectionMap || !Array.isArray(sectionMap) || sectionMap.length < 2) return null;

  // Pull scroll distribution across visitors (same query the dropoff route uses)
  const scrollResult = await pool.query(
    `SELECT vs.max_scroll_depth, v.converted, COUNT(*) as cnt
     FROM visitor_sessions vs
     JOIN visitors v ON v.id = vs.visitor_id AND v.campaign_id = vs.campaign_id
     WHERE vs.campaign_id = $1 AND vs.max_scroll_depth > 0
     GROUP BY vs.max_scroll_depth, v.converted`,
    [campaignId]
  );
  if (scrollResult.rows.length === 0) return null;

  let totalVisitors = 0;
  const scrollCounts: Record<number, { total: number; converted: number }> = {};
  for (const row of scrollResult.rows) {
    const depth = parseInt(row.max_scroll_depth);
    const count = parseInt(row.cnt);
    if (!scrollCounts[depth]) scrollCounts[depth] = { total: 0, converted: 0 };
    scrollCounts[depth].total += count;
    if (row.converted) scrollCounts[depth].converted += count;
    totalVisitors += count;
  }

  // Build per-section reach + drop
  const sections: SectionForCarrot[] = sectionMap.map((s: any, i: number) => {
    let reached = 0;
    for (const [depthStr, counts] of Object.entries(scrollCounts)) {
      if (parseInt(depthStr) >= s.offsetPct) reached += (counts as any).total;
    }
    const reachPct = totalVisitors > 0 ? Math.round(reached / totalVisitors * 100) : 0;
    return {
      idx: i,
      label: s.label,
      heading: s.heading || "",
      offsetPct: s.offsetPct,
      reachPct,
    };
  });
  for (let i = 1; i < sections.length; i++) {
    sections[i].dropFromPrev = sections[i - 1].reachPct - sections[i].reachPct;
  }
  if (sections.length > 0) sections[0].dropFromPrev = 0;

  return getCarrotRecommendation({
    campaignId,
    campaign: {
      name: campaign.name,
      url: campaign.url,
      niche: campaign.niche,
      pageType: campaign.page_type,
    },
    sections,
    llmConfig,
  });
}
