import { storage, pool } from "./storage";
import { callLLM, type LLMConfig } from "./llm";
import { getBrainPageAuditKnowledge } from "./brain-selector";
import { getNetworkIntelligence } from "./network-intelligence";
import type { LLMMessage } from "./llm";

// Valid observation categories — rotated to avoid repetition
export const OBSERVATION_CATEGORIES = [
  "scroll_behavior",
  "conversion_pattern",
  "section_engagement",
  "traffic_quality",
  "test_performance",
] as const;

export type ObservationCategory = typeof OBSERVATION_CATEGORIES[number];

// Human-readable labels for categories
export const CATEGORY_LABELS: Record<ObservationCategory, string> = {
  scroll_behavior: "Scroll Behavior",
  conversion_pattern: "Conversion Pattern",
  section_engagement: "Section Engagement",
  traffic_quality: "Traffic Quality",
  test_performance: "Test Performance",
};

/**
 * Pick the next category to observe, rotating so we never repeat
 * the same category two days in a row.
 */
function pickNextCategory(recentObservations: { category: string }[]): ObservationCategory {
  const lastCategory = recentObservations[0]?.category as ObservationCategory | undefined;

  // Shuffle categories but exclude the one used last time
  const available = OBSERVATION_CATEGORIES.filter(c => c !== lastCategory);
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Build the LLM prompt for generating a daily observation.
 */
function buildObservationPrompt(params: {
  campaignName: string;
  campaignUrl: string;
  niche?: string | null;
  pageType?: string | null;
  pricePoint?: string | null;
  networkIntelligence?: string;
  sessionStats: {
    avgScrollDepth: number;
    avgTimeOnPage: number;
    videoPlayRate: number;
    convertedAvgScroll: number;
    nonConvertedAvgScroll: number;
  };
  variantStats: {
    variantId: number;
    type: string;
    text: string;
    isControl: boolean;
    impressions: number;
    conversions: number;
    conversionRate: number;
    confidence: number;
  }[];
  totalVisitors: number;
  totalConversions: number;
  conversionRate: number;
  category: ObservationCategory;
  brainKnowledge: string;
  recentObservationTexts: string[];
}): LLMMessage[] {
  const {
    campaignName, campaignUrl, niche, pageType, pricePoint,
    sessionStats, variantStats, totalVisitors, totalConversions,
    conversionRate, category, brainKnowledge, recentObservationTexts,
  } = params;

  const scrollDiff = sessionStats.convertedAvgScroll - sessionStats.nonConvertedAvgScroll;
  const videoRatePct = (sessionStats.videoPlayRate * 100).toFixed(1);
  const avgScrollPct = sessionStats.avgScrollDepth.toFixed(0);
  const avgTimeSec = sessionStats.avgTimeOnPage.toFixed(0);
  const convertedScrollPct = sessionStats.convertedAvgScroll.toFixed(0);
  const nonConvertedScrollPct = sessionStats.nonConvertedAvgScroll.toFixed(0);

  // Top variant performance summary
  const activeVariants = variantStats.filter(v => v.impressions > 0);
  const variantSummary = activeVariants.length > 0
    ? activeVariants.slice(0, 6).map(v => {
        const cr = (v.conversionRate * 100).toFixed(2);
        const conf = v.confidence.toFixed(0);
        const label = v.isControl ? " [CONTROL]" : "";
        return `  - ${v.type}${label}: "${v.text.replace(/<[^>]*>/g, "").slice(0, 60)}" | ${v.impressions} visitors | ${cr}% CVR | ${conf}% confidence`;
      }).join("\n")
    : "  No variant data yet.";

  const recentInsightsBlock = recentObservationTexts.length > 0
    ? `\n\nRECENT OBSERVATIONS (do NOT repeat these insights):\n${recentObservationTexts.map((t, i) => `  ${i + 1}. ${t.slice(0, 150)}...`).join("\n")}`
    : "";

  const nicheInfo = niche ? `\nNiche: ${niche}` : "";
  const pageTypeInfo = pageType ? `\nPage type: ${pageType}` : "";
  const priceInfo = pricePoint ? `\nPrice point: ${pricePoint}` : "";

  const categoryFocus: Record<ObservationCategory, string> = {
    scroll_behavior: `Focus on SCROLL BEHAVIOR data:
- Average scroll depth: ${avgScrollPct}% (how far visitors scroll on average)
- Converters scroll to: ${convertedScrollPct}% vs non-converters: ${nonConvertedScrollPct}%
- Scroll depth gap (converters vs non-converters): ${scrollDiff > 0 ? "+" : ""}${scrollDiff.toFixed(0)}%
- Average time on page: ${avgTimeSec} seconds
Generate an insight about what the scroll data reveals — e.g. where visitors drop off, whether key content is being seen, whether the guarantee/CTA is being reached.`,

    conversion_pattern: `Focus on CONVERSION PATTERN data:
- Overall conversion rate: ${conversionRate.toFixed(2)}% (visitor-based — conversions divided by total visitors across all variants)
- Total visitors: ${totalVisitors.toLocaleString()}
- Total conversions: ${totalConversions.toLocaleString()}
- Converters avg scroll: ${convertedScrollPct}% | Non-converters avg scroll: ${nonConvertedScrollPct}%
- Time on page: ${avgTimeSec}s average
IMPORTANT: Every conversion is attributed to exactly one variant. The overall CVR is the weighted average of variant-level CVRs. Do NOT suggest conversions are coming from outside the variant tracking system.
Generate an insight about conversion patterns — what behaviors correlate with conversion, what the rate suggests about the offer/page, or what the data implies about optimization priority.`,

    section_engagement: `Focus on SECTION ENGAGEMENT data:
- Average scroll depth: ${avgScrollPct}% (sections below this depth are unseen by most visitors)
- Converters reach: ${convertedScrollPct}% vs non-converters: ${nonConvertedScrollPct}%
- Time on page: ${avgTimeSec}s
- Video play rate: ${videoRatePct}% of visitors play video (if present)
Generate an insight about which page sections are being seen vs. missed, and what this means for the page structure.`,

    traffic_quality: `Focus on TRAFFIC QUALITY data:
- Average scroll depth: ${avgScrollPct}% (high depth = engaged traffic)
- Average time on page: ${avgTimeSec}s
- Video play rate: ${videoRatePct}%
- Conversion rate: ${conversionRate.toFixed(2)}%
Generate an insight about traffic quality and engagement — whether visitors are engaged or bouncing, what the time-on-page and scroll data suggest about traffic source quality.`,

    test_performance: `Focus on TEST PERFORMANCE data:
${variantSummary}
- Overall conversion rate: ${conversionRate.toFixed(2)}% (this is the weighted average of ALL variants above — every conversion is attributed to exactly one variant)
IMPORTANT: The overall CVR is the sum of all variant conversions divided by total visitors. Do NOT claim that "something else" is driving conversions outside the variants — every sale is tracked to a specific variant. If the overall CVR differs from a single variant's CVR, it's because other variants are performing differently, not because of an unexplained source.
Generate an insight about the A/B test results — which variant angle is winning or losing, what this tells you about what the audience responds to, and what to test next.`,
  };

  const systemPrompt = `You are a conversion rate optimization expert embedded in SiteAmoeba, an A/B testing platform. You analyze behavioral data and test results to generate actionable insights for marketers.
${params.networkIntelligence ? `
You have access to REAL DATA from across the SiteAmoeba network:
${params.networkIntelligence}
Use these real-world patterns to make your insights more specific and data-backed.
` : ""}

Your task is to generate ONE specific, data-backed, actionable observation about a user's campaign.

## FORMAT RULES
- Start with the specific data point (a real number from the data)
- Then explain what it means for this page/audience
- Then suggest ONE specific action
- Length: 2-3 sentences maximum. Tight and punchy.
- Use exact numbers. Never say "many" or "most" — say "73%" or "58%"
- Write in second person ("your visitors", "your page")
- Do NOT start with "I" or "The data shows" — start with the data point itself
- Do NOT use headers, bullets, or markdown formatting — plain prose only
- Be specific about WHERE on the page to make changes

## EXAMPLE OUTPUTS
"73% of your visitors stop scrolling before reaching your guarantee section (average scroll depth: 58%). Converters scroll 31% deeper than non-converters, suggesting your guarantee is doing its job — but only 27% of visitors see it. Consider moving your guarantee above the pricing section to expose it to more traffic."

"Your A/B test shows the curiosity-gap headline generating 4.2% CVR vs. 2.8% for the direct approach — a 50% lift at 89% confidence. This suggests your audience responds to open loops and mystery rather than plain benefit statements. Test a curiosity-gap CTA button next: 'See Why 3,400 Marketers Switched' instead of 'Get Started'."

## BRAIN KNOWLEDGE (apply these frameworks):
${brainKnowledge}${recentInsightsBlock}`;

  const userMessage = `Campaign: "${campaignName}"
URL: ${campaignUrl}${nicheInfo}${pageTypeInfo}${priceInfo}

BEHAVIORAL DATA:
- Total visitors: ${totalVisitors.toLocaleString()}
- Total conversions: ${totalConversions.toLocaleString()}
- Conversion rate: ${conversionRate.toFixed(2)}%
- Average scroll depth: ${avgScrollPct}%
- Average time on page: ${avgTimeSec}s
- Video play rate: ${videoRatePct}%
- Converters avg scroll: ${convertedScrollPct}%
- Non-converters avg scroll: ${nonConvertedScrollPct}%

VARIANT PERFORMANCE:
${variantSummary}

CATEGORY TO FOCUS ON: ${CATEGORY_LABELS[category]}

${categoryFocus[category]}

Generate exactly ONE 2-3 sentence observation. Start with the specific data point. Plain prose, no markdown, no bullets.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
}

/**
 * Generate a daily observation for a campaign.
 * Requires the user to have LLM configured.
 * Returns { observation, category, dataPoints }
 */
export async function generateDailyObservation(
  campaignId: number,
  userId: number,
  llmConfig: LLMConfig
): Promise<{ observation: string; category: ObservationCategory; dataPoints: string }> {
  // 1. Load campaign
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  // 2. Get behavioral stats
  const sessionStats = await storage.getSessionStats(campaignId);

  // 3. Get variant stats (for test performance)
  const variantStats = await storage.getVariantStats(campaignId);

  // 4. Get overall campaign stats — use VISITOR-BASED counts only.
  // getCampaignsWithStats adds orphaned revenue_events (Stripe charges with no visitor),
  // which inflates the conversion rate above what any individual variant can explain.
  // For insight generation, we need the conversion rate to be consistent with variant stats
  // (both derived from the visitors table) so the LLM doesn't hallucinate phantom attribution.
  const visitorCountResult = await pool.query(
    "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE converted = true) as converted FROM visitors WHERE campaign_id = $1",
    [campaignId]
  );
  const totalVisitors = parseInt(visitorCountResult.rows[0]?.total) || 0;
  const totalConversions = parseInt(visitorCountResult.rows[0]?.converted) || 0;
  const conversionRate = totalVisitors > 0 ? (totalConversions / totalVisitors) * 100 : 0;

  // 5. Get recent observations to avoid repetition
  const recentObs = await storage.getObservationsByCampaign(campaignId, 7);

  // 6. Pick category (rotate, never repeat last)
  const category = pickNextCategory(recentObs);

  // 7. Get Brain knowledge context
  const brainKnowledge = getBrainPageAuditKnowledge();

  // 8. Get network intelligence
  let networkIntel = "";
  try {
    networkIntel = await getNetworkIntelligence();
  } catch { /* non-fatal */ }

  // 9. Build prompt
  const messages = buildObservationPrompt({
    campaignName: campaign.name,
    campaignUrl: campaign.url,
    niche: campaign.niche,
    pageType: campaign.pageType,
    pricePoint: campaign.pricePoint,
    networkIntelligence: networkIntel ? networkIntel.slice(0, 2000) : undefined,
    sessionStats,
    variantStats,
    totalVisitors,
    totalConversions,
    conversionRate,
    category,
    brainKnowledge: brainKnowledge.substring(0, 4000), // keep prompt lean
    recentObservationTexts: recentObs.slice(0, 3).map(o => o.observation),
  });

  // 9. Call LLM
  const observation = await callLLM(llmConfig, messages);

  // 10. Bundle data points as JSON for display
  const dataPoints = JSON.stringify({
    totalVisitors,
    totalConversions,
    conversionRate: parseFloat(conversionRate.toFixed(2)),
    avgScrollDepth: parseFloat(sessionStats.avgScrollDepth.toFixed(1)),
    avgTimeOnPage: parseFloat(sessionStats.avgTimeOnPage.toFixed(0)),
    videoPlayRate: parseFloat((sessionStats.videoPlayRate * 100).toFixed(1)),
    convertedAvgScroll: parseFloat(sessionStats.convertedAvgScroll.toFixed(1)),
    nonConvertedAvgScroll: parseFloat(sessionStats.nonConvertedAvgScroll.toFixed(1)),
    activeVariants: variantStats.filter(v => v.impressions > 0).length,
  });

  return { observation: observation.trim(), category, dataPoints };
}
