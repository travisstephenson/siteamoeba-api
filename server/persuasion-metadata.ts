/**
 * Persuasion metadata helpers.
 *
 * Every test_section carries structured metadata describing the JOB the
 * element does in the sales psychology arc (not just what HTML tag it is).
 * This is the primary attribution key for the widget and the visual editor.
 *
 * - normalizeForHash(text): strip whitespace/punctuation/case for a stable
 *   fingerprint so small formatting drift doesn't break matching.
 * - hashText(text): sha256 of the normalized text.
 * - buildSectionMetadata(section, index): returns the canonical DB column
 *   payload for an insert/update so every ingestion path writes the same shape.
 */

import crypto from "node:crypto";

export const PERSUASION_ROLES = [
  "hero_promise",
  "outcome_promise",
  "problem_agitation",
  "objection_handler",
  "credibility_anchor",
  "mechanism_reveal",
  "social_proof_stack",
  "urgency_trigger",
  "risk_reversal",
  "offer_stack",
  "identity_call",
  "transformation_hook",
  "cta_action",
  "section_header",
  "utility",
] as const;
export type PersuasionRole = (typeof PERSUASION_ROLES)[number];

export const FUNNEL_STAGES = ["attention", "interest", "desire", "action", "retention"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const PSYCH_LEVERS = [
  "curiosity_gap",
  "loss_aversion",
  "social_proof",
  "authority",
  "scarcity",
  "reciprocity",
  "identification",
  "specificity",
  "pattern_interrupt",
  "future_pacing",
  "commitment",
  "risk_reversal",
] as const;
export type PsychLever = (typeof PSYCH_LEVERS)[number];

export const FRAMEWORKS = [
  "PAS",
  "AIDA",
  "hero_journey",
  "product_launch_formula",
  "storybrand",
  "offer_stack",
  "trust_stack",
  "cta_ladder",
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

/**
 * Normalize text for hashing: lowercase, collapse whitespace, strip non-word
 * characters. The first 2000 chars are enough to disambiguate any element
 * without blowing up memory on giant body_copy blocks.
 */
export function normalizeForHash(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim()
    .slice(0, 2000);
}

export function hashText(text: string): string {
  const normalized = normalizeForHash(text);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Validate against the enum, returning null if the AI hallucinated a value. */
function validate<T extends readonly string[]>(value: any, allowed: T): T[number] | null {
  if (typeof value !== "string") return null;
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : null;
}

/**
 * Canonical metadata payload for a scanned section. The LLM may omit fields
 * (older prompts, truncation), so every field is defensively validated and
 * anything invalid becomes null. Null is fine — the lazy backfill classifier
 * fills gaps on demand.
 */
export function buildSectionMetadata(
  raw: any,
  positionIndex: number,
): {
  persuasion_role: string | null;
  funnel_stage: string | null;
  psychological_lever: string | null;
  framework: string | null;
  angle: string | null;
  original_text_hash: string | null;
  position_index: number;
} {
  const hash = hashText(raw?.currentText || "");
  return {
    persuasion_role: validate(raw?.persuasionRole, PERSUASION_ROLES),
    funnel_stage: validate(raw?.funnelStage, FUNNEL_STAGES),
    psychological_lever: validate(raw?.psychologicalLever, PSYCH_LEVERS),
    framework: validate(raw?.framework, FRAMEWORKS),
    angle: typeof raw?.angle === "string" ? raw.angle.trim().slice(0, 400) : null,
    original_text_hash: hash || null,
    position_index: Number.isFinite(positionIndex) ? positionIndex : 0,
  };
}
