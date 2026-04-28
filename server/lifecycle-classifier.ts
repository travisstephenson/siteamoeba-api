/**
 * Lifecycle stage classifier
 *
 * Built Apr 28, 2026 because we discovered 97 signups in the last 60 days had
 * resulted in only 9 reaching the "got results" stage. The other 88 weren't
 * churned — they were stuck at specific, fixable stages of activation.
 *
 * Rather than fire generic re-engagement emails, classify each user into one of
 * 7 lifecycle stages and let the email layer decide what to send (or, for now,
 * export to a beehiiv segment).
 *
 * The 7 stages, in funnel order:
 *
 *   01_signed_up_no_campaign       — never created a campaign
 *   02_campaign_no_sections        — campaign exists but no test_sections
 *   03_sections_no_variants        — sections exist but no variants
 *   04_variants_no_pixel_or_traffic — variants exist but no visitors yet (pixel issue or zero traffic)
 *   05_traffic_below_100           — has traffic, under 100 visitors per variant (no significance yet)
 *   06_traffic_no_revenue          — has 100+ visitors but no revenue events (revenue tracking issue)
 *   07_got_results                 — has visitors AND revenue events; healthy active user
 *
 * Email gating:
 *   - Only emit a stage's email if the user has been at that stage for >= 48 hours.
 *   - Only emit once per (user_id, stage, template_version).
 *   - Stage 07 is special: emit a "first results" email once, then stop.
 *
 * This module is the source of truth for stage logic. Both the admin dashboard
 * and the nightly cron call classifyUser(userId).
 */

import { Pool } from "pg";

export type LifecycleStage =
  | "01_signed_up_no_campaign"
  | "02_campaign_no_sections"
  | "03_sections_no_variants"
  | "04_variants_no_pixel_or_traffic"
  | "05_traffic_below_100"
  | "06_traffic_no_revenue"
  | "07_got_results";

export interface UserLifecycleClassification {
  userId: number;
  stage: LifecycleStage;
  campaignCount: number;
  totalVisitors: number;
  visitorsLast7d: number;
  variantsCount: number;
  activeSectionsCount: number;
  hasRevenueEvent: boolean;
}

export async function classifyAllUsers(pool: Pool): Promise<UserLifecycleClassification[]> {
  // Single SQL pass — much cheaper than N round trips.
  const { rows } = await pool.query(`
    WITH user_stats AS (
      SELECT
        u.id AS user_id,
        (SELECT COUNT(*) FROM campaigns c WHERE c.user_id = u.id)::int AS campaign_count,
        (SELECT COUNT(*) FROM campaigns c JOIN test_sections ts ON ts.campaign_id = c.id WHERE c.user_id = u.id)::int AS sections_count,
        (SELECT COUNT(*) FROM campaigns c JOIN test_sections ts ON ts.campaign_id = c.id WHERE c.user_id = u.id AND ts.is_active = true)::int AS active_sections_count,
        (SELECT COUNT(*) FROM campaigns c JOIN variants v ON v.campaign_id = c.id WHERE c.user_id = u.id)::int AS variants_count,
        (SELECT COUNT(*) FROM campaigns c JOIN visitors v ON v.campaign_id = c.id WHERE c.user_id = u.id)::int AS total_visitors,
        (SELECT COUNT(*) FROM campaigns c JOIN visitors v ON v.campaign_id = c.id
          WHERE c.user_id = u.id AND v.first_seen > (NOW() - INTERVAL '7 days')::text)::int AS visitors_last_7d,
        EXISTS(SELECT 1 FROM campaigns c
                 JOIN visitors v ON v.campaign_id = c.id
                 JOIN revenue_events re ON re.visitor_id = v.id
                WHERE c.user_id = u.id) AS has_revenue_event
      FROM users u
      WHERE u.account_status = 'active'
        -- Skip internal/test accounts so they don't pollute lifecycle metrics
        AND u.email NOT LIKE '%@test.com'
        AND u.email NOT LIKE 'stephenson%'
    )
    SELECT * FROM user_stats
  `);

  return rows.map((r: any) => {
    const c = {
      userId: r.user_id,
      campaignCount: r.campaign_count,
      activeSectionsCount: r.active_sections_count,
      variantsCount: r.variants_count,
      totalVisitors: r.total_visitors,
      visitorsLast7d: r.visitors_last_7d,
      hasRevenueEvent: r.has_revenue_event,
      stage: stageFromStats(r) as LifecycleStage,
    };
    return c;
  });
}

function stageFromStats(s: {
  campaign_count: number;
  sections_count: number;
  variants_count: number;
  total_visitors: number;
  has_revenue_event: boolean;
}): LifecycleStage {
  if (s.campaign_count === 0)               return "01_signed_up_no_campaign";
  if (s.sections_count === 0)               return "02_campaign_no_sections";
  if (s.variants_count === 0)               return "03_sections_no_variants";
  if (s.total_visitors === 0)               return "04_variants_no_pixel_or_traffic";
  if (s.total_visitors < 100)               return "05_traffic_below_100";
  if (!s.has_revenue_event)                 return "06_traffic_no_revenue";
  return "07_got_results";
}

/**
 * Persist all classifications. Updates user_lifecycle_stage. Sets entered_stage_at
 * to NOW() only when the user's stage actually changed since last classification —
 * preserves the original entry timestamp so the email gate ("48 hours at this stage")
 * works correctly.
 */
export async function persistClassifications(
  pool: Pool,
  classifications: UserLifecycleClassification[]
): Promise<{ inserted: number; transitioned: number; unchanged: number }> {
  let inserted = 0, transitioned = 0, unchanged = 0;
  const nowIso = new Date().toISOString();

  for (const c of classifications) {
    const existing = await pool.query(
      `SELECT stage FROM user_lifecycle_stage WHERE user_id = $1`,
      [c.userId]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO user_lifecycle_stage (
           user_id, stage, entered_stage_at, last_classified_at,
           campaign_count, total_visitors, visitors_last_7d, variants_count,
           active_sections_count, has_revenue_event
         ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
        [c.userId, c.stage, nowIso, c.campaignCount, c.totalVisitors,
         c.visitorsLast7d, c.variantsCount, c.activeSectionsCount, c.hasRevenueEvent]
      );
      inserted++;
    } else if (existing.rows[0].stage !== c.stage) {
      await pool.query(
        `UPDATE user_lifecycle_stage
            SET stage = $2, entered_stage_at = $3, last_classified_at = $3,
                campaign_count = $4, total_visitors = $5, visitors_last_7d = $6,
                variants_count = $7, active_sections_count = $8, has_revenue_event = $9
          WHERE user_id = $1`,
        [c.userId, c.stage, nowIso, c.campaignCount, c.totalVisitors,
         c.visitorsLast7d, c.variantsCount, c.activeSectionsCount, c.hasRevenueEvent]
      );
      transitioned++;
    } else {
      // Stage unchanged — just refresh the diagnostic numbers and timestamp.
      await pool.query(
        `UPDATE user_lifecycle_stage
            SET last_classified_at = $2,
                campaign_count = $3, total_visitors = $4, visitors_last_7d = $5,
                variants_count = $6, active_sections_count = $7, has_revenue_event = $8
          WHERE user_id = $1`,
        [c.userId, nowIso, c.campaignCount, c.totalVisitors, c.visitorsLast7d,
         c.variantsCount, c.activeSectionsCount, c.hasRevenueEvent]
      );
      unchanged++;
    }
  }

  return { inserted, transitioned, unchanged };
}

/**
 * Returns users who are eligible for an email at their current stage.
 * Eligibility:
 *   - In their current stage for >= 48 hours
 *   - Have NOT received an email for (current stage, current template_version)
 *   - Have a real email address (not internal/test)
 *
 * Does NOT actually send anything — just classifies who should be in the queue.
 */
export async function getUsersEligibleForLifecycleEmail(
  pool: Pool,
  templateVersionByStage: Record<string, number>
): Promise<Array<{ user_id: number; email: string; name: string; stage: LifecycleStage; entered_stage_at: string; template_version: number }>> {
  const versionCases = Object.entries(templateVersionByStage)
    .map(([stage, v]) => `WHEN '${stage}' THEN ${v}`)
    .join("\n");

  const { rows } = await pool.query(`
    SELECT
      uls.user_id,
      u.email,
      u.name,
      uls.stage,
      uls.entered_stage_at,
      CASE uls.stage ${versionCases} END AS template_version
    FROM user_lifecycle_stage uls
    JOIN users u ON u.id = uls.user_id
    WHERE u.account_status = 'active'
      AND uls.entered_stage_at < (NOW() - INTERVAL '48 hours')::text
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_emails_sent les
         WHERE les.user_id = uls.user_id
           AND les.stage = uls.stage
           AND les.template_version = (CASE uls.stage ${versionCases} END)
      )
    ORDER BY uls.entered_stage_at ASC
  `);

  return rows;
}
