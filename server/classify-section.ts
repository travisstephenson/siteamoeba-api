/**
 * classifySectionRole \u2014 backfill persuasion metadata for sections that were
 * scanned before the enhanced scan rolled out.
 *
 * This is a single-section classifier. It takes an existing test_sections row
 * (with its current_text, category, etc.) and asks the LLM: "what JOB does this
 * element do in the sales psychology arc?" The result fills persuasion_role,
 * funnel_stage, psychological_lever, framework, angle.
 *
 * We only run this for sections where persuasion_role IS NULL so a single
 * backfill pass is idempotent and we never re-spend credits on already-tagged
 * rows.
 */

import { pool } from "./storage";
import { callLLM, resolveLLMConfig } from "./llm";
import { decryptApiKey } from "./encryption";
import {
  buildSectionMetadata,
  hashText,
  PERSUASION_ROLES,
  FUNNEL_STAGES,
  PSYCH_LEVERS,
  FRAMEWORKS,
} from "./persuasion-metadata";

interface SectionRow {
  id: number;
  campaign_id: number;
  section_id: string;
  label: string;
  category: string;
  current_text: string | null;
  test_priority: number;
  position_index: number | null;
}

function buildClassifierPrompt(section: SectionRow, pageContext: {
  pageType?: string | null;
  pageGoal?: string | null;
  niche?: string | null;
}) {
  const rolesList = PERSUASION_ROLES.join(" | ");
  const stagesList = FUNNEL_STAGES.join(" | ");
  const leversList = PSYCH_LEVERS.join(" | ");
  const frameworksList = FRAMEWORKS.join(" | ");
  const text = (section.current_text || "").slice(0, 1500);

  const system = `You are an expert direct-response copywriter classifying the JOB of a single page element.

Pick the BEST-FIT value for each field. Do not invent values \u2014 only use the ones listed.

Return ONLY valid JSON with these keys:
{
  "persuasionRole": one of [${rolesList}],
  "funnelStage": one of [${stagesList}],
  "psychologicalLever": one of [${leversList}],
  "framework": one of [${frameworksList}],
  "angle": a short sentence (under 25 words) explaining what this element does for the reader
}`;

  const user = `Page type: ${pageContext.pageType || "unknown"}
Page goal: ${pageContext.pageGoal || "unknown"}
Niche: ${pageContext.niche || "unknown"}

Element category (as tagged by scanner): ${section.category}
Element label: ${section.label}
Element position on page (0 = first): ${section.position_index ?? section.test_priority - 1}

Element text:
"""
${text}
"""

Classify the job of this element. Return JSON only.`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/**
 * Classify one section and persist the result. Returns the updated metadata,
 * or null if the LLM failed. Silent-failure by design \u2014 backfill is
 * opportunistic, not critical.
 */
export async function classifyAndPersistSection(sectionId: number): Promise<{ persuasionRole: string | null; framework: string | null } | null> {
  const secRes = await pool.query(
    `SELECT ts.id, ts.campaign_id, ts.section_id, ts.label, ts.category,
            ts.current_text, ts.test_priority, ts.position_index,
            c.page_type, c.page_goal, c.niche, c.user_id
       FROM test_sections ts
       JOIN campaigns c ON c.id = ts.campaign_id
      WHERE ts.id = $1`,
    [sectionId]
  );
  if (secRes.rows.length === 0) return null;
  const row = secRes.rows[0];
  if (!row.current_text) return null;

  // Resolve LLM \u2014 use the campaign owner's provider so classification credits
  // come out of the right bucket.
  const userRes = await pool.query(`SELECT plan, llm_provider, llm_api_key, llm_model FROM users WHERE id = $1`, [row.user_id]);
  if (userRes.rows.length === 0) return null;
  const u = userRes.rows[0];
  let llmConfigResolved;
  try {
    llmConfigResolved = resolveLLMConfig({
      operation: "scan",
      userPlan: u.plan || "free",
      userProvider: u.llm_provider,
      userApiKey: u.llm_api_key ? decryptApiKey(u.llm_api_key) : null,
      userModel: u.llm_model,
    });
  } catch {
    return null;
  }

  const messages = buildClassifierPrompt(row as SectionRow, {
    pageType: row.page_type,
    pageGoal: row.page_goal,
    niche: row.niche,
  });

  let raw: string;
  try {
    raw = await callLLM(llmConfigResolved.config, messages, { maxTokens: 500 });
  } catch (err: any) {
    console.warn(`[classify-section] C${row.campaign_id} section ${sectionId}: LLM failed: ${err.message}`);
    return null;
  }

  let parsed: any;
  try {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) throw new Error("no JSON");
    parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  } catch {
    console.warn(`[classify-section] C${row.campaign_id} section ${sectionId}: failed to parse LLM output`);
    return null;
  }

  // Re-run through validator so bogus values become null and we never poison the DB
  const meta = buildSectionMetadata(parsed, row.position_index ?? row.test_priority - 1);
  const textHash = hashText(row.current_text);

  await pool.query(
    `UPDATE test_sections
        SET persuasion_role    = COALESCE($1, persuasion_role),
            funnel_stage       = COALESCE($2, funnel_stage),
            psychological_lever= COALESCE($3, psychological_lever),
            framework          = COALESCE($4, framework),
            angle              = COALESCE($5, angle),
            original_text_hash = COALESCE(original_text_hash, $6),
            position_index     = COALESCE(position_index, $7)
      WHERE id = $8`,
    [meta.persuasion_role, meta.funnel_stage, meta.psychological_lever,
     meta.framework, meta.angle, textHash, meta.position_index, sectionId]
  );

  return { persuasionRole: meta.persuasion_role, framework: meta.framework };
}

/**
 * Backfill all unclassified sections for a campaign.
 * Returns { processed, classified, skipped }.
 */
export async function backfillCampaignMetadata(campaignId: number): Promise<{ processed: number; classified: number; skipped: number }> {
  const rows = await pool.query(
    `SELECT id FROM test_sections
      WHERE campaign_id = $1
        AND persuasion_role IS NULL
        AND current_text IS NOT NULL
        AND length(current_text) > 5
      ORDER BY test_priority ASC, id ASC`,
    [campaignId]
  );
  let classified = 0, skipped = 0;
  for (const row of rows.rows) {
    const result = await classifyAndPersistSection(row.id);
    if (result) classified++; else skipped++;
  }
  return { processed: rows.rows.length, classified, skipped };
}
