/**
 * Activation suggestions
 *
 * For a given user, returns the list of their campaigns that are GETTING TRAFFIC
 * but have NO TEST RUNNING. For each one, generates a personalized "you could lift
 * conversions by X% by testing Y" suggestion based on what the brain has already
 * learned from other users in similar niches.
 *
 * Surfaced via a dashboard banner so when users log in they see exactly which
 * campaigns are dormant and what the highest-leverage move would be \u2014 not generic
 * "create a campaign" copy, but specific "your headline test would lift you ~22%"
 * pointed at the right page.
 *
 * Built Apr 30 2026 in response to Travis's feedback that we have ~12 paying
 * users with traffic flowing but no live test. Generic re-engagement emails won't
 * fix it; surgical in-app suggestions might.
 */

import { Pool } from "pg";

export interface ActivationSuggestion {
  campaignId: number;
  campaignName: string;
  campaignUrl: string;
  visitors7d: number;
  conversions7d: number;
  problem: "no_test_sections_picked" | "sections_picked_no_variants" | "variants_unattached";
  problemLabel: string;
  // The actual recommendation \u2014 always a section + a strategy, optionally a lift estimate
  suggestedSection: string; // e.g. "headline", "cta"
  suggestedSectionLabel: string; // friendly name for the UI
  estimatedLiftPct: number | null; // from brain; null = insufficient data
  estimatedLiftBasis: string; // e.g. "Based on 12 similar tests in the brain"
  // The CTA the banner click should navigate to
  ctaPath: string; // e.g. "/campaigns/93?tab=sections"
  ctaLabel: string;
}

/**
 * Returns suggestions for the given user. Filters out campaigns that:
 *  - are archived/paused
 *  - have <50 visitors in the last 7 days (not enough traffic to matter yet)
 *  - already have at least one section actively serving variants
 */
export async function getActivationSuggestions(
  pool: Pool,
  userId: number
): Promise<ActivationSuggestion[]> {
  const { rows: campaigns } = await pool.query(
    `WITH stats AS (
       SELECT
         c.id, c.name, c.url,
         (SELECT COUNT(*) FROM visitors v
            WHERE v.campaign_id = c.id
              AND v.first_seen > (NOW() - INTERVAL '7 days')::text)::int AS visitors_7d,
         (SELECT COUNT(*) FROM visitors v
            JOIN revenue_events re ON re.visitor_id = v.id
            WHERE v.campaign_id = c.id
              AND v.first_seen > (NOW() - INTERVAL '7 days')::text)::int AS conversions_7d,
         (SELECT COUNT(*) FROM test_sections WHERE campaign_id = c.id)::int AS total_sections,
         (SELECT COUNT(*) FROM test_sections WHERE campaign_id = c.id AND is_active = true)::int AS active_sections,
         (SELECT COUNT(*) FROM variants WHERE campaign_id = c.id AND is_active = true AND is_control = false)::int AS active_challengers,
         (SELECT COUNT(*) FROM variants WHERE campaign_id = c.id AND is_active = true AND is_control = false AND test_section_id IS NULL)::int AS unattached_variants,
         c.section_map IS NOT NULL AS has_section_map,
         c.page_type
       FROM campaigns c
       WHERE c.user_id = $1 AND c.status = 'active'
     )
     SELECT * FROM stats
     WHERE visitors_7d >= 50
       AND active_challengers = 0
     ORDER BY visitors_7d DESC`,
    [userId]
  );

  const suggestions: ActivationSuggestion[] = [];
  for (const c of campaigns) {
    const problem =
      c.unattached_variants > 0 ? "variants_unattached" :
      c.total_sections === 0    ? "no_test_sections_picked" :
                                  "sections_picked_no_variants";

    const { suggestedSection, suggestedSectionLabel, estimatedLiftPct, estimatedLiftBasis } =
      await pickHighestLeverageSection(pool, c.page_type);

    let problemLabel: string;
    let ctaPath: string;
    let ctaLabel: string;
    switch (problem) {
      case "no_test_sections_picked":
        problemLabel = "Scan finished but no sections are being tested yet";
        ctaPath = `/campaigns/${c.id}?tab=sections`;
        ctaLabel = "Pick sections to test";
        break;
      case "sections_picked_no_variants":
        problemLabel = "Sections are picked but no variants exist yet";
        ctaPath = `/campaigns/${c.id}/visual-editor`;
        ctaLabel = "Generate variants";
        break;
      case "variants_unattached":
        problemLabel = "You have draft variants that aren't attached to a section";
        ctaPath = `/campaigns/${c.id}/visual-editor`;
        ctaLabel = "Link variants to sections";
        break;
    }

    suggestions.push({
      campaignId: c.id,
      campaignName: c.name,
      campaignUrl: c.url,
      visitors7d: c.visitors_7d,
      conversions7d: c.conversions_7d,
      problem,
      problemLabel,
      suggestedSection,
      suggestedSectionLabel,
      estimatedLiftPct,
      estimatedLiftBasis,
      ctaPath,
      ctaLabel,
    });
  }

  return suggestions;
}

/**
 * Asks the brain: "For this page type, which section type historically has the
 * biggest lift, and what's the average lift number we can quote?"
 *
 * Falls back to generic CRO best-practice (headline) when brain is empty for the
 * page type, with no estimated lift number.
 */
async function pickHighestLeverageSection(
  pool: Pool,
  pageType: string | null
): Promise<{ suggestedSection: string; suggestedSectionLabel: string; estimatedLiftPct: number | null; estimatedLiftBasis: string; }> {
  // Brain query: which section_type has the biggest avg lift for this page_type?
  const { rows } = await pool.query(
    `SELECT section_type, COUNT(*) AS sample, AVG(lift_percent)::numeric(10,1) AS avg_lift
       FROM brain_knowledge
      WHERE status = 'active'
        AND source_type = 'internal'
        AND lift_percent > 0
        AND ($1::text IS NULL OR page_type = $1 OR page_type IS NULL)
      GROUP BY section_type
     HAVING COUNT(*) >= 2
      ORDER BY avg_lift DESC
      LIMIT 1`,
    [pageType]
  );

  if (rows.length > 0) {
    const r = rows[0];
    return {
      suggestedSection: r.section_type,
      suggestedSectionLabel: prettyLabel(r.section_type),
      estimatedLiftPct: Math.round(parseFloat(r.avg_lift)),
      estimatedLiftBasis: `Based on ${r.sample} similar test${r.sample > 1 ? "s" : ""} the SiteAmoeba brain has run`,
    };
  }

  // Fallback: just recommend the headline since it's universally the highest
  // leverage element (Bly, Schwartz, Halbert all agree).
  return {
    suggestedSection: "headline",
    suggestedSectionLabel: "Hero Headline",
    estimatedLiftPct: null,
    estimatedLiftBasis: "Headlines are the highest-leverage element on any page",
  };
}

function prettyLabel(sectionType: string): string {
  const map: Record<string, string> = {
    headline: "Hero Headline",
    subheadline: "Subheadline",
    cta: "Call-to-Action Button",
    body_copy: "Body Copy",
    hero_journey: "Story / Hero Journey",
    pricing: "Pricing Block",
    guarantee: "Guarantee",
    social_proof: "Social Proof",
    bonus: "Bonus Stack",
    testimonials: "Testimonials",
    faq: "FAQ Section",
    hero_image: "Hero Image",
    product_image: "Product Image",
  };
  return map[sectionType] || sectionType.replace(/_/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}
