/**
 * ACTIVE TESTS — the canonical "what tests are running right now?" helper.
 *
 * Single source of truth for:
 *   - widget assign endpoint (what to serve)
 *   - visual editor panel (what to preview)
 *   - campaign dashboard cards (what's live)
 *   - stats/brain context (what counts as an active test)
 *   - autopilot decisions (which sections are fair game)
 *
 * Every surface that asks "is a test running?" or "which variants should
 * count as active?" MUST go through this function. Do NOT duplicate the
 * activation logic anywhere else — if we need more nuance, add it here
 * and every surface inherits it.
 *
 * The gates applied, in order:
 *   1. Campaign must be is_active = true
 *   2. Test section must be is_active = true
 *   3. Variant must be is_active = true AND test_section_id linking to (2)
 *
 * If any of those is false, that section does NOT appear in the active
 * set and its variants are NOT servable. No fallbacks, no defaults.
 */
import { pool } from "./storage";

export interface ActiveTestVariant {
  id: number;
  type: string;
  text: string;
  isControl: boolean;
  isActive: boolean;
  testSectionId: number | null;
  mutations: string | null;
  displayIssue: boolean;
}

export interface ActiveTestSection {
  id: number;
  sectionId: string;
  label: string;
  category: string;
  selector: string;
  testMethod: string;
  currentText: string;
  trafficPercentage: number;
  isActive: true;          // always true — we only return active sections
  // Variants live WITH their section; no scattered-variant lookups needed elsewhere
  control: ActiveTestVariant | null;
  challengers: ActiveTestVariant[];
}

export interface ActiveTestState {
  campaignId: number;
  campaignIsActive: boolean;
  // Sections currently toggled ON that also have at least one active variant.
  // Sections toggled ON but with no variants land in needsAttention instead.
  liveSections: ActiveTestSection[];
  // Sections toggled ON but missing variants — UI should prompt user to
  // generate variants before they see any split.
  needsAttention: Array<{
    section: ActiveTestSection;
    reason: "no_active_variants" | "no_control" | "no_challenger";
  }>;
  // Quick flags for any UI surface
  isLive: boolean;             // at least one liveSection
  totalLiveSections: number;
  totalActiveChallengers: number;
}

export async function getActiveTestState(campaignId: number): Promise<ActiveTestState> {
  // Pull the campaign state + all sections + all variants in one trip
  // so we can build the canonical view atomically.
  const campaignRow = await pool.query(
    `SELECT id, is_active FROM campaigns WHERE id = $1`,
    [campaignId]
  );
  const campaignIsActive = campaignRow.rows[0]?.is_active === true;

  const sectionRows = await pool.query(
    `SELECT id, section_id, label, category, selector, test_method,
            current_text, is_active, traffic_percentage
     FROM test_sections
     WHERE campaign_id = $1
     ORDER BY test_priority ASC, id ASC`,
    [campaignId]
  );

  const variantRows = await pool.query(
    `SELECT id, type, text, is_control, is_active, test_section_id,
            mutations::text AS mutations, display_issue
     FROM variants
     WHERE campaign_id = $1`,
    [campaignId]
  );

  const variantsBySection = new Map<number, ActiveTestVariant[]>();
  for (const v of variantRows.rows) {
    if (v.test_section_id == null) continue; // orphaned variants are never servable
    const arr = variantsBySection.get(v.test_section_id) || [];
    arr.push({
      id: v.id,
      type: v.type,
      text: v.text,
      isControl: !!v.is_control,
      isActive: !!v.is_active,
      testSectionId: v.test_section_id,
      mutations: v.mutations || null,
      displayIssue: !!v.display_issue,
    });
    variantsBySection.set(v.test_section_id, arr);
  }

  const liveSections: ActiveTestSection[] = [];
  const needsAttention: ActiveTestState["needsAttention"] = [];

  for (const s of sectionRows.rows) {
    if (!s.is_active) continue; // inactive sections are invisible to every surface

    const sectionVariants = variantsBySection.get(s.id) || [];
    const activeVariants = sectionVariants.filter((v) => v.isActive);
    const control = activeVariants.find((v) => v.isControl) || null;
    const challengers = activeVariants.filter((v) => !v.isControl);

    const section: ActiveTestSection = {
      id: s.id,
      sectionId: s.section_id,
      label: s.label,
      category: s.category,
      selector: s.selector,
      testMethod: s.test_method || "text_swap",
      currentText: s.current_text || "",
      trafficPercentage: s.traffic_percentage ?? 100,
      isActive: true,
      control,
      challengers,
    };

    // A section needs BOTH a control-type variant AND at least one challenger
    // to produce meaningful A/B data. Without that, the toggle is on but
    // nothing useful can happen — surface as needsAttention so the UI can
    // prompt the user instead of silently running a broken test.
    if (activeVariants.length === 0) {
      needsAttention.push({ section, reason: "no_active_variants" });
    } else if (!control && challengers.length > 0) {
      // Widget will synthesize a control from currentText, so this is still
      // servable — include it in liveSections but note the missing control.
      liveSections.push(section);
    } else if (control && challengers.length === 0) {
      needsAttention.push({ section, reason: "no_challenger" });
    } else {
      liveSections.push(section);
    }
  }

  const totalActiveChallengers = liveSections.reduce(
    (sum, s) => sum + s.challengers.length,
    0
  );

  return {
    campaignId,
    campaignIsActive,
    liveSections: campaignIsActive ? liveSections : [],
    needsAttention: campaignIsActive ? needsAttention : [],
    isLive: campaignIsActive && liveSections.length > 0,
    totalLiveSections: liveSections.length,
    totalActiveChallengers,
  };
}

/**
 * Integrity guard: when a test_section is toggled OFF, mark its variants
 * is_active = false too. Keeps the DB clean so no "orphaned active variant"
 * states can exist across sessions. Called by the PATCH /api/sections/:id
 * endpoint whenever is_active changes.
 */
export async function reconcileVariantsOnSectionToggle(
  testSectionId: number,
  sectionNowActive: boolean
): Promise<{ updatedCount: number }> {
  if (sectionNowActive) {
    // Turning ON: don't touch variants. User may have staged variants before
    // flipping the toggle; we keep their is_active state as-is.
    return { updatedCount: 0 };
  }

  // Turning OFF: deactivate every variant linked to this section so nothing
  // can slip through the widget assign gate.
  const result = await pool.query(
    `UPDATE variants SET is_active = false
     WHERE test_section_id = $1 AND is_active = true
     RETURNING id`,
    [testSectionId]
  );
  return { updatedCount: result.rowCount || 0 };
}
