import { BRAIN_KNOWLEDGE_BASE } from "./brain-knowledge";
import { Pool } from "pg";

// Lazy pool for test lesson queries
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });
  }
  return _pool;
}

// Section-to-knowledge mapping: which parts of the knowledge base are relevant for each section type
// FATE removed as a default mapping. It caused the AI to audit pages against
// a structural sequence rather than diagnosing the actual problem. Framework
// knowledge is still available but only loaded when specifically relevant.
const SECTION_KNOWLEDGE_MAP: Record<string, string[]> = {
  headline: [
    "1.2 THE WALLPAPER FILTER", // Pattern interrupt
    "7. HEADLINE FORMULAS", // All headline formulas
    "10. WEAK VS STRONG EXAMPLES", // Before/after examples
    "8. COGNITIVE BIAS MASTER", // Specificity, curiosity
  ],
  subheadline: [
    "10. WEAK VS STRONG EXAMPLES",
    "8. COGNITIVE BIAS MASTER",
    "1.7 THE NEW BAD GUY", // Objection removal
  ],
  cta: [
    "1.6 COMMITMENT AND CONSISTENCY", // Micro-commitments
    "10. WEAK VS STRONG EXAMPLES",
    "8. COGNITIVE BIAS MASTER", // Loss aversion, urgency
  ],
  guarantee: [
    "2. OFFER ARCHITECTURE", // Risk reversal
    "8. COGNITIVE BIAS MASTER",
    "10. WEAK VS STRONG EXAMPLES",
  ],
  social_proof: [
    "8. COGNITIVE BIAS MASTER", // Social proof bias — quantity, specificity
    "10. WEAK VS STRONG EXAMPLES",
  ],
  product_stack: [
    "2. OFFER ARCHITECTURE", // Value stacking
    "3. UNIQUE MECHANISM", // Mechanism naming
  ],
  bonus: [
    "2. OFFER ARCHITECTURE", // Bonus structuring
    "8. COGNITIVE BIAS MASTER", // Anchoring
    "10. WEAK VS STRONG EXAMPLES",
  ],
  pricing: [
    "2. OFFER ARCHITECTURE", // Price anchoring
    "8. COGNITIVE BIAS MASTER", // Loss aversion, anchoring
    "10. WEAK VS STRONG EXAMPLES",
  ],
  body_copy: [
    "1.4 THE LEGO METHOD",
    "1.5 PRE-SUASION AND PRIMING",
    "1.7 THE NEW BAD GUY",
    "10. WEAK VS STRONG EXAMPLES",
  ],
  hero_journey: [
    "1.7 THE NEW BAD GUY",
    "3. UNIQUE MECHANISM",
    "1.8 THE R.I.C.E. FRAMEWORK",
  ],
  faq: [
    "6. AUDIT CHECKLIST",
    "8. COGNITIVE BIAS MASTER",
  ],
  testimonials: [
    "1.1 THE F.A.T.E. MODEL", // Tribe
    "6. AUDIT CHECKLIST",
  ],
};

// Extract a section from the knowledge base by its header marker
function extractSection(header: string): string {
  const lines = BRAIN_KNOWLEDGE_BASE.split("\n");
  const results: string[] = [];
  let capturing = false;
  let depth = 0;

  for (const line of lines) {
    // Check if this line contains the header we're looking for
    if (line.includes(header)) {
      capturing = true;
      depth = (line.match(/^#+/) || [""])[0].length || 0;
      results.push(line);
      continue;
    }

    if (capturing) {
      // Stop capturing when we hit another section at the same or higher level
      const lineDepth = (line.match(/^#+/) || [""])[0].length;
      if (lineDepth > 0 && lineDepth <= depth && !line.includes(header)) {
        // Check if this is a new top-level section (not a subsection)
        if (lineDepth <= 2 && results.length > 5) {
          break;
        }
      }
      results.push(line);
    }
  }

  return results.join("\n").trim();
}

// Get relevant Brain knowledge for a specific section type
export function getBrainKnowledgeForSection(sectionType: string): string {
  const headers = SECTION_KNOWLEDGE_MAP[sectionType] || SECTION_KNOWLEDGE_MAP.body_copy;
  
  const sections: string[] = [];
  for (const header of headers) {
    const extracted = extractSection(header);
    if (extracted.length > 50) {
      sections.push(extracted);
    }
  }

  const combined = sections.join("\n\n---\n\n");
  
  // Truncate to ~6000 chars to stay within context limits
  if (combined.length > 6000) {
    return combined.substring(0, 6000) + "\n\n[Knowledge base truncated for context limits]";
  }
  
  return combined;
}

// Get the full audit checklist for page analysis
export function getBrainAuditChecklist(): string {
  const auditSection = extractSection("6. AUDIT CHECKLIST");
  const fateSection = extractSection("1.1 THE F.A.T.E. MODEL");
  const offerSection = extractSection("2. OFFER ARCHITECTURE");
  
  return [fateSection, offerSection, auditSection].join("\n\n---\n\n").substring(0, 8000);
}

// Get knowledge for page audit (what's missing)
export function getBrainPageAuditKnowledge(): string {
  const sections = [
    extractSection("1.1 THE F.A.T.E. MODEL"),
    extractSection("1.4 THE LEGO METHOD"),
    extractSection("1.5 PRE-SUASION AND PRIMING"),
    extractSection("1.7 THE NEW BAD GUY"),
    extractSection("6. AUDIT CHECKLIST"),
    extractSection("4. SALES PAGE STRUCTURE"),
  ];
  
  return sections.filter(s => s.length > 50).join("\n\n---\n\n").substring(0, 10000);
}

/**
 * Query the test_lessons table for relevant past A/B test results and format
 * them as a context block for Brain prompts.
 *
 * Tries to find lessons matching both sectionType + pageType first,
 * then falls back to sectionType only, then to any available lessons.
 */
export async function getRelevantTestLessons(
  pageType: string,
  sectionType: string,
  niche?: string
): Promise<string> {
  try {
    const pool = getPool();

    // Try: sectionType + pageType match first
    let result = await pool.query(
      `SELECT * FROM test_lessons
       WHERE section_type = $1 AND page_type = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [sectionType, pageType]
    );

    // Fall back: sectionType only
    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT * FROM test_lessons
         WHERE section_type = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [sectionType]
      );
    }

    // Fall back: any lessons at all
    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT * FROM test_lessons
         ORDER BY created_at DESC
         LIMIT 10`
      );
    }

    if (result.rows.length === 0) {
      return "";
    }

    // Format lessons for the Brain prompt
    const totalCount = await pool.query("SELECT COUNT(*) as count FROM test_lessons");
    const total = parseInt(totalCount.rows[0]?.count) || 0;

    const lines: string[] = [
      `Based on ${total} completed A/B test${total !== 1 ? "s" : ""} in this system:`,
      "",
    ];

    for (const row of result.rows) {
      const winnerCvr = ((row.winner_conversion_rate || 0) * 100).toFixed(2);
      const loserCvr = ((row.loser_conversion_rate || 0) * 100).toFixed(2);
      const lift = (row.lift_percent || 0).toFixed(1);
      const pageCtx = row.page_type ? `${row.page_type}` : "sales page";
      const nicheCtx = row.niche ? ` (${row.niche})` : "";
      const priceCtx = row.price_point ? `, price: ${row.price_point}` : "";
      const sectionCtx = row.section_type || "unknown section";

      if (row.lesson) {
        // Use the LLM-generated lesson if available
        lines.push(`**${sectionCtx} on ${pageCtx}${nicheCtx}${priceCtx} (+${lift}% lift, ${winnerCvr}% vs ${loserCvr}% CVR):**`);
        lines.push(row.lesson);
      } else {
        // Fall back to raw data summary
        const winnerSnippet = (row.winner_text || "").replace(/<[^>]*>/g, "").slice(0, 80);
        const loserSnippet = (row.loser_text || "").replace(/<[^>]*>/g, "").slice(0, 80);
        const stratInfo = row.winner_strategy ? ` [${row.winner_strategy}]` : "";
        lines.push(`**${sectionCtx} on ${pageCtx}${nicheCtx}:** Winner${stratInfo} (+${lift}%): "${winnerSnippet}" vs Loser: "${loserSnippet}" — ${winnerCvr}% vs ${loserCvr}% CVR`);
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  } catch (err) {
    // Non-fatal — Brain chat works without lessons
    console.warn("getRelevantTestLessons error:", err);
    return "";
  }
}
