/**
 * Network Intelligence Engine
 * 
 * Aggregates real test results, conversion patterns, and behavioral data
 * from ALL campaigns into a dynamic knowledge block that feeds the Brain.
 * 
 * This is the data moat — every visitor, every conversion, every test
 * makes the Brain smarter for ALL users.
 * 
 * Refreshed on:
 *   - Every winner declaration
 *   - Every 100 new conversions (tracked via counter)
 *   - Manual trigger via admin endpoint
 */

import { pool } from "./storage";

export interface NetworkIntelligence {
  id?: number;
  knowledgeText: string;
  stats: {
    totalTests: number;
    totalVisitorSessions: number;
    totalConversions: number;
    totalRevenueEvents: number;
    generatedAt: string;
  };
  generatedAt: Date;
}

/**
 * Query all real data and compile into a structured knowledge block.
 * This is what gets injected into every Brain prompt.
 */
export async function generateNetworkIntelligence(): Promise<NetworkIntelligence> {
  const now = new Date();

  // === 1. Strategy Performance (A/B Test Winners & Losers) ===
  const strategyWins = await pool.query(`
    SELECT winner_strategy, COUNT(*) as wins, 
      ROUND(AVG(lift_percent)::numeric, 1) as avg_lift,
      ROUND(AVG(sample_size)::numeric, 0) as avg_sample,
      ROUND(AVG(confidence)::numeric, 0) as avg_confidence
    FROM test_lessons WHERE lift_percent > 0 AND winner_strategy IS NOT NULL
    GROUP BY winner_strategy ORDER BY COUNT(*) DESC
  `);

  const strategyLosses = await pool.query(`
    SELECT loser_strategy, COUNT(*) as losses,
      ROUND(AVG(lift_percent)::numeric, 1) as avg_lift_by_winner
    FROM test_lessons WHERE lift_percent > 0 AND loser_strategy IS NOT NULL
    GROUP BY loser_strategy ORDER BY COUNT(*) DESC
  `);

  // === 2. Section-Level Test Patterns ===
  const sectionPerformance = await pool.query(`
    SELECT section_type, 
      COUNT(*) as total_tests,
      COUNT(*) FILTER (WHERE lift_percent > 0) as positive_tests,
      ROUND(AVG(lift_percent) FILTER (WHERE lift_percent > 0)::numeric, 1) as avg_positive_lift,
      ROUND(AVG(lift_percent)::numeric, 1) as avg_lift_all
    FROM test_lessons 
    GROUP BY section_type ORDER BY total_tests DESC
  `);

  // === 3. Converter vs Non-Converter Behavioral Patterns ===
  const behaviorPatterns = await pool.query(`
    SELECT 
      v.converted,
      COUNT(*) as visitors,
      ROUND(AVG(vs.max_scroll_depth)::numeric, 1) as avg_scroll_depth,
      ROUND(AVG(vs.time_on_page)::numeric, 0) as avg_time_sec,
      ROUND(AVG(vs.click_count)::numeric, 1) as avg_clicks
    FROM visitors v
    JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = v.campaign_id
    WHERE vs.max_scroll_depth > 0
    GROUP BY v.converted
  `);

  // === 4. Conversion Rate by Scroll Depth ===
  const scrollConversion = await pool.query(`
    SELECT 
      CASE 
        WHEN vs.max_scroll_depth < 25 THEN '0-25%'
        WHEN vs.max_scroll_depth < 50 THEN '25-50%'
        WHEN vs.max_scroll_depth < 75 THEN '50-75%'
        ELSE '75-100%'
      END as scroll_bucket,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE v.converted = true) as converted,
      ROUND((COUNT(*) FILTER (WHERE v.converted = true))::numeric / NULLIF(COUNT(*), 0) * 100, 2) as cvr_pct
    FROM visitors v
    JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = v.campaign_id
    WHERE vs.max_scroll_depth > 0
    GROUP BY 1 ORDER BY 1
  `);

  // === 5. Device-Level Conversion Patterns ===
  const devicePatterns = await pool.query(`
    SELECT 
      vs.device_type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE v.converted = true) as converted,
      ROUND((COUNT(*) FILTER (WHERE v.converted = true))::numeric / NULLIF(COUNT(*), 0) * 100, 2) as cvr_pct,
      ROUND(AVG(vs.max_scroll_depth)::numeric, 1) as avg_scroll,
      ROUND(AVG(vs.time_on_page)::numeric, 0) as avg_time_sec
    FROM visitors v
    JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = v.campaign_id
    WHERE vs.max_scroll_depth > 0
    GROUP BY vs.device_type
    HAVING COUNT(*) >= 10
    ORDER BY COUNT(*) DESC
  `);

  // === 6. Specific Test Matchups (what beats what) ===
  const matchups = await pool.query(`
    SELECT winner_strategy, loser_strategy, 
      section_type,
      ROUND(lift_percent::numeric, 1) as lift,
      sample_size,
      ROUND(confidence::numeric, 0) as conf,
      LEFT(winner_text, 80) as winner_preview,
      LEFT(loser_text, 80) as loser_preview
    FROM test_lessons 
    WHERE lift_percent > 0 AND winner_strategy IS NOT NULL AND loser_strategy IS NOT NULL
    ORDER BY lift_percent DESC
    LIMIT 20
  `);

  // === 7. Page-Type Performance ===
  const pageTypePerf = await pool.query(`
    SELECT c.page_type,
      COUNT(DISTINCT c.id) as campaigns,
      COUNT(DISTINCT v.id) as total_visitors,
      COUNT(DISTINCT v.id) FILTER (WHERE v.converted = true) as converted,
      ROUND((COUNT(DISTINCT v.id) FILTER (WHERE v.converted = true))::numeric / NULLIF(COUNT(DISTINCT v.id), 0) * 100, 2) as cvr_pct
    FROM campaigns c
    LEFT JOIN visitors v ON v.campaign_id = c.id
    WHERE c.page_type IS NOT NULL
    GROUP BY c.page_type
    HAVING COUNT(DISTINCT v.id) >= 50
    ORDER BY COUNT(DISTINCT v.id) DESC
  `);

  // === 8. Page Structure → Conversion Correlation ===
  // What page characteristics correlate with higher conversion rates?
  const pageStructureCorr = await pool.query(`
    SELECT 
      c.id, c.name, c.page_type, c.niche,
      c.page_word_count, c.page_heading_count, c.page_cta_count,
      c.page_image_count, c.page_video_count, c.page_section_count,
      COUNT(DISTINCT v.id) as visitors,
      COUNT(DISTINCT v.id) FILTER (WHERE v.converted = true) as conversions,
      ROUND((COUNT(DISTINCT v.id) FILTER (WHERE v.converted = true))::numeric / NULLIF(COUNT(DISTINCT v.id), 0) * 100, 2) as cvr_pct
    FROM campaigns c
    JOIN visitors v ON v.campaign_id = c.id
    WHERE c.page_word_count > 0
    GROUP BY c.id, c.name, c.page_type, c.niche,
      c.page_word_count, c.page_heading_count, c.page_cta_count,
      c.page_image_count, c.page_video_count, c.page_section_count
    HAVING COUNT(DISTINCT v.id) >= 50
    ORDER BY cvr_pct DESC
  `);

  // === 9. Word Count Buckets → CVR ===
  const wordCountCvr = await pool.query(`
    SELECT 
      CASE 
        WHEN c.page_word_count < 500 THEN 'Short (<500 words)'
        WHEN c.page_word_count < 1500 THEN 'Medium (500-1500 words)'
        WHEN c.page_word_count < 3000 THEN 'Long (1500-3000 words)'
        ELSE 'Very Long (3000+ words)'
      END as length_bucket,
      COUNT(DISTINCT c.id) as campaigns,
      SUM(stats.visitors)::int as total_visitors,
      SUM(stats.conversions)::int as total_conversions,
      ROUND(SUM(stats.conversions)::numeric / NULLIF(SUM(stats.visitors), 0) * 100, 2) as cvr_pct
    FROM campaigns c
    JOIN (
      SELECT campaign_id, 
        COUNT(*) as visitors,
        COUNT(*) FILTER (WHERE converted = true) as conversions
      FROM visitors GROUP BY campaign_id
    ) stats ON stats.campaign_id = c.id
    WHERE c.page_word_count > 0 AND stats.visitors >= 50
    GROUP BY 1
    ORDER BY cvr_pct DESC
  `);

  // === 10. CTA Count → CVR ===
  const ctaCountCvr = await pool.query(`
    SELECT 
      CASE 
        WHEN c.page_cta_count <= 2 THEN '1-2 CTAs'
        WHEN c.page_cta_count <= 5 THEN '3-5 CTAs'
        WHEN c.page_cta_count <= 10 THEN '6-10 CTAs'
        ELSE '10+ CTAs'
      END as cta_bucket,
      COUNT(DISTINCT c.id) as campaigns,
      SUM(stats.visitors)::int as total_visitors,
      SUM(stats.conversions)::int as total_conversions,
      ROUND(SUM(stats.conversions)::numeric / NULLIF(SUM(stats.visitors), 0) * 100, 2) as cvr_pct
    FROM campaigns c
    JOIN (
      SELECT campaign_id, 
        COUNT(*) as visitors,
        COUNT(*) FILTER (WHERE converted = true) as conversions
      FROM visitors GROUP BY campaign_id
    ) stats ON stats.campaign_id = c.id
    WHERE c.page_cta_count > 0 AND stats.visitors >= 50
    GROUP BY 1
    ORDER BY cvr_pct DESC
  `);

  // === 11. Video Presence → CVR ===
  const videoCvr = await pool.query(`
    SELECT 
      CASE WHEN c.page_video_count > 0 THEN 'Has Video' ELSE 'No Video' END as has_video,
      COUNT(DISTINCT c.id) as campaigns,
      SUM(stats.visitors)::int as total_visitors,
      SUM(stats.conversions)::int as total_conversions,
      ROUND(SUM(stats.conversions)::numeric / NULLIF(SUM(stats.visitors), 0) * 100, 2) as cvr_pct
    FROM campaigns c
    JOIN (
      SELECT campaign_id, 
        COUNT(*) as visitors,
        COUNT(*) FILTER (WHERE converted = true) as conversions
      FROM visitors GROUP BY campaign_id
    ) stats ON stats.campaign_id = c.id
    WHERE c.page_word_count > 0 AND stats.visitors >= 50
    GROUP BY 1
    ORDER BY cvr_pct DESC
  `);

  // === 12. Volume stats ===
  const volumeStats = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM test_lessons) as total_tests,
      (SELECT COUNT(*) FROM visitor_sessions WHERE max_scroll_depth > 0) as total_sessions,
      (SELECT COUNT(*) FROM visitors WHERE converted = true) as total_conversions,
      (SELECT COUNT(*) FROM revenue_events) as total_revenue_events,
      (SELECT COUNT(DISTINCT campaign_id) FROM visitors) as campaigns_with_data
  `);
  const vol = volumeStats.rows[0];

  // ============================================
  // BUILD THE KNOWLEDGE TEXT
  // ============================================
  const sections: string[] = [];

  sections.push(`
=========================================================================
NETWORK INTELLIGENCE — LEARNED FROM REAL DATA
Generated: ${now.toISOString().slice(0, 16)} UTC
Data: ${vol.total_tests} A/B tests | ${parseInt(vol.total_sessions).toLocaleString()} visitor sessions | ${parseInt(vol.total_conversions).toLocaleString()} conversions | ${vol.campaigns_with_data} campaigns
=========================================================================
This is NOT theory — these are measured outcomes from real A/B tests and visitor behavior.
Use this data to inform all recommendations. When this data contradicts a framework
or assumption, the DATA wins.
`);

  // Strategy performance
  if (strategyWins.rows.length > 0) {
    sections.push(`
## STRATEGY PERFORMANCE (Proven by A/B Tests)

### Winning Strategies (ordered by frequency):
${strategyWins.rows.map((r: any) => 
  `- **${r.winner_strategy}**: Won ${r.wins} test(s), avg +${r.avg_lift}% lift, avg ${r.avg_sample} visitors, ${r.avg_confidence}% avg confidence`
).join("\n")}

### Strategies That Lost When Tested:
${strategyLosses.rows.map((r: any) => 
  `- **${r.loser_strategy}**: Lost ${r.losses} time(s), winner averaged +${r.avg_lift_by_winner}% lift over it`
).join("\n")}

KEY INSIGHT: When recommending copy strategies, prioritize strategies with proven wins.
Avoid defaulting to strategies that have been beaten in real tests.`);
  }

  // Specific matchups
  if (matchups.rows.length > 0) {
    sections.push(`
## HEAD-TO-HEAD TEST RESULTS
${matchups.rows.map((r: any) => {
    const winPreview = (r.winner_preview || "").replace(/<[^>]*>/g, "").trim();
    const losePreview = (r.loser_preview || "").replace(/<[^>]*>/g, "").trim();
    return `- [${r.section_type}] ${r.winner_strategy} beat ${r.loser_strategy} by +${r.lift}% (${r.sample_size} visitors, ${r.conf}% conf)
    Winner: "${winPreview.slice(0, 70)}"
    Loser: "${losePreview.slice(0, 70)}"`;
  }).join("\n")}`);
  }

  // Behavioral patterns
  const converterRow = behaviorPatterns.rows.find((r: any) => r.converted === true);
  const nonConverterRow = behaviorPatterns.rows.find((r: any) => r.converted === false);
  if (converterRow && nonConverterRow) {
    sections.push(`
## CONVERTER vs NON-CONVERTER BEHAVIOR (${parseInt(converterRow.visitors) + parseInt(nonConverterRow.visitors)} visitors analyzed)

| Metric | Converters (${converterRow.visitors}) | Non-Converters (${nonConverterRow.visitors}) | Difference |
|--------|-----------|----------------|------------|
| Avg Scroll Depth | ${converterRow.avg_scroll_depth}% | ${nonConverterRow.avg_scroll_depth}% | +${(converterRow.avg_scroll_depth - nonConverterRow.avg_scroll_depth).toFixed(1)}% deeper |
| Avg Time on Page | ${converterRow.avg_time_sec}s | ${nonConverterRow.avg_time_sec}s | ${(converterRow.avg_time_sec / nonConverterRow.avg_time_sec).toFixed(1)}x longer |
| Avg Clicks | ${converterRow.avg_clicks} | ${nonConverterRow.avg_clicks} | ${(converterRow.avg_clicks / Math.max(nonConverterRow.avg_clicks, 0.1)).toFixed(1)}x more |

KEY INSIGHT: Converters engage significantly deeper. Pages that fail to engage visitors
past the ${nonConverterRow.avg_scroll_depth}% scroll mark are losing potential buyers.
Content at ${converterRow.avg_scroll_depth}%+ scroll depth is where buying decisions happen.`);
  }

  // Scroll-to-conversion correlation
  if (scrollConversion.rows.length > 0) {
    sections.push(`
## SCROLL DEPTH → CONVERSION CORRELATION
${scrollConversion.rows.map((r: any) => 
  `- ${r.scroll_bucket} scroll: ${r.cvr_pct}% CVR (${r.converted}/${r.total} visitors)`
).join("\n")}

KEY INSIGHT: Visitors who scroll deeper convert at significantly higher rates.
This means page content BELOW the fold matters enormously. Sections that appear
at 50%+ scroll depth need to be compelling enough to push visitors to commit.
If your page has a high drop-off before 50%, the problem is likely in the first
half of the page — not the offer itself.`);
  }

  // Device patterns
  if (devicePatterns.rows.length > 0) {
    sections.push(`
## DEVICE-SPECIFIC PATTERNS
${devicePatterns.rows.map((r: any) => 
  `- **${r.device_type}**: ${r.cvr_pct}% CVR, ${r.avg_scroll}% avg scroll, ${r.avg_time_sec}s avg time (${r.total} visitors)`
).join("\n")}

KEY INSIGHT: Use these patterns to tailor recommendations. If mobile CVR is lower,
focus on mobile-first optimizations (shorter above-fold content, larger CTAs, 
fewer form fields). If desktop converts better, the page may need simplification for mobile.`);
  }

  // Page type performance
  if (pageTypePerf.rows.length > 0) {
    sections.push(`
## PAGE TYPE BENCHMARKS
${pageTypePerf.rows.map((r: any) => 
  `- **${r.page_type}**: ${r.cvr_pct}% CVR across ${r.campaigns} campaigns (${parseInt(r.total_visitors).toLocaleString()} visitors)`
).join("\n")}`);
  }

  // Page structure correlations
  if (pageStructureCorr.rows.length > 0) {
    sections.push(`
## PAGE STRUCTURE → CONVERSION CORRELATION (Per-Page Analysis)
Each row is a real page with measured conversion data:
${pageStructureCorr.rows.map((r: any) => 
  `- "${r.name}" (${r.page_type || 'unknown'}): ${r.cvr_pct}% CVR | ${parseInt(r.page_word_count).toLocaleString()} words, ${r.page_heading_count} headings, ${r.page_cta_count} CTAs, ${r.page_image_count} images, ${r.page_video_count} videos | ${parseInt(r.visitors).toLocaleString()} visitors`
).join("\n")}`);
  }

  // Word count buckets
  if (wordCountCvr.rows.length > 0) {
    sections.push(`
## PAGE LENGTH → CONVERSION RATE
${wordCountCvr.rows.map((r: any) => 
  `- **${r.length_bucket}**: ${r.cvr_pct}% CVR (${r.campaigns} pages, ${parseInt(r.total_visitors).toLocaleString()} visitors)`
).join("\n")}

KEY INSIGHT: Use this to recommend optimal page length. If longer pages convert better,
advise against cutting content. If shorter pages win, recommend tightening copy.`);
  }

  // CTA count
  if (ctaCountCvr.rows.length > 0) {
    sections.push(`
## CTA FREQUENCY → CONVERSION RATE
${ctaCountCvr.rows.map((r: any) => 
  `- **${r.cta_bucket}**: ${r.cvr_pct}% CVR (${r.campaigns} pages, ${parseInt(r.total_visitors).toLocaleString()} visitors)`
).join("\n")}`);
  }

  // Video presence
  if (videoCvr.rows.length > 0) {
    sections.push(`
## VIDEO PRESENCE → CONVERSION RATE
${videoCvr.rows.map((r: any) => 
  `- **${r.has_video}**: ${r.cvr_pct}% CVR (${r.campaigns} pages, ${parseInt(r.total_visitors).toLocaleString()} visitors)`
).join("\n")}`);
  }

  const knowledgeText = sections.join("\n");

  return {
    knowledgeText,
    stats: {
      totalTests: parseInt(vol.total_tests),
      totalVisitorSessions: parseInt(vol.total_sessions),
      totalConversions: parseInt(vol.total_conversions),
      totalRevenueEvents: parseInt(vol.total_revenue_events),
      generatedAt: now.toISOString(),
    },
    generatedAt: now,
  };
}

/**
 * Store the generated intelligence in the database.
 */
export async function storeNetworkIntelligence(intel: NetworkIntelligence): Promise<void> {
  await pool.query(`
    INSERT INTO network_intelligence (knowledge_text, stats, generated_at)
    VALUES ($1, $2, $3)
  `, [intel.knowledgeText, JSON.stringify(intel.stats), intel.generatedAt]);
  
  // Keep only the last 10 snapshots
  await pool.query(`
    DELETE FROM network_intelligence 
    WHERE id NOT IN (
      SELECT id FROM network_intelligence ORDER BY generated_at DESC LIMIT 10
    )
  `);
}

/**
 * Get the latest network intelligence, or generate fresh if stale/missing.
 * Cached for up to 1 hour in memory.
 */
let cachedIntel: { text: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getNetworkIntelligence(): Promise<string> {
  // Check memory cache first
  if (cachedIntel && (Date.now() - cachedIntel.fetchedAt) < CACHE_TTL_MS) {
    return cachedIntel.text;
  }

  // Try DB
  try {
    const result = await pool.query(
      "SELECT knowledge_text, generated_at FROM network_intelligence ORDER BY generated_at DESC LIMIT 1"
    );
    if (result.rows.length > 0) {
      const age = Date.now() - new Date(result.rows[0].generated_at).getTime();
      if (age < CACHE_TTL_MS * 6) { // Use DB cache if less than 6 hours old
        cachedIntel = { text: result.rows[0].knowledge_text, fetchedAt: Date.now() };
        return cachedIntel.text;
      }
    }
  } catch (e) {
    // Table might not exist yet — that's fine
  }

  // Generate fresh
  try {
    const intel = await generateNetworkIntelligence();
    cachedIntel = { text: intel.knowledgeText, fetchedAt: Date.now() };
    // Store async (don't block the request)
    storeNetworkIntelligence(intel).catch(err => 
      console.warn("[network-intelligence] Failed to store:", err.message)
    );
    return intel.knowledgeText;
  } catch (err) {
    console.error("[network-intelligence] Failed to generate:", err);
    return ""; // Non-fatal — Brain still works with static knowledge
  }
}

/**
 * Force a refresh of the network intelligence cache.
 * Call this after winner declarations, bulk syncs, etc.
 */
export async function refreshNetworkIntelligence(): Promise<void> {
  cachedIntel = null; // Clear memory cache
  const intel = await generateNetworkIntelligence();
  await storeNetworkIntelligence(intel);
  cachedIntel = { text: intel.knowledgeText, fetchedAt: Date.now() };
  console.log(`[network-intelligence] Refreshed: ${intel.stats.totalTests} tests, ${intel.stats.totalConversions} conversions`);
}
