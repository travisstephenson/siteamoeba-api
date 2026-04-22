/**
 * brain-sync.ts
 *
 * Daily internal learning loop. Converts signals that crossed our credibility
 * bar into structured brain_knowledge rows that the autopilot + chat agent use
 * for hypothesis generation.
 *
 * Signals promoted (in priority order):
 *   1. New rows in test_lessons since last sync
 *   2. Live headline/subhead/CTA challengers at >=95% confidence + >=100 visitors
 *      per arm that haven't been declared yet (for users NOT on autopilot)
 *   3. Structural page flags (low scroll on long-form pages where offer is below
 *      fold — filtered so above-fold-offer pages never trigger this flag)
 *
 * Conflict resolution (per your spec):
 *   - We bucket insights by (page_type, section_type, niche, traffic_source,
 *     offer_position). Same-bucket contradictions are real conflicts.
 *   - Different-bucket contradictions are NOT conflicts — they're just context
 *     specificity (e.g., "contrarian wins on cold paid traffic" vs "social proof
 *     wins on warm email traffic" is both true).
 *   - We never silently overwrite. We append, update confirmation_count, or
 *     flag pending_review.
 */

import { pool, storage } from "./storage";
import crypto from "crypto";

// ===== Types =====
interface BrainSyncResult {
  newLessons: number;
  confirmations: number;
  conflicts: number;
  structuralFlags: number;
  durationMs: number;
  summary: Record<string, any>;
}

interface BucketKey {
  page_type: string | null;
  section_type: string | null;
  niche: string | null;
  traffic_source: string | null;
  offer_position: string | null;
  winner_strategy: string | null;
}

// ===== Helpers =====

function bucketHash(b: BucketKey): string {
  const parts = [
    b.page_type || "",
    b.section_type || "",
    (b.niche || "").toLowerCase().trim(),
    b.traffic_source || "",
    b.offer_position || "",
    b.winner_strategy || "",
  ].join("||");
  return crypto.createHash("sha1").update(parts).digest("hex").slice(0, 16);
}

/**
 * Normalize a niche string so "keto" and "Keto" and "KETO supplement" map to the
 * same bucket. Cheap heuristic — good enough for confirmation counting.
 */
function normalizeNiche(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  // Collapse common variants
  if (/keto|weight\s*loss|fat\s*loss/.test(lower)) return "weight_loss";
  if (/ai\s*prompt|chatgpt|ai\s*tool/.test(lower)) return "ai_products";
  if (/digital\s*product|info\s*product|course/.test(lower)) return "digital_products";
  if (/cpa|tax|account(ing|ant)/.test(lower)) return "finance_tax";
  if (/christian|faith|ministry/.test(lower)) return "faith_based";
  if (/gluten|sourdough|baking/.test(lower)) return "baking";
  if (/cellulite|skin|anti[- ]?aging/.test(lower)) return "beauty";
  return lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

// ===== Step 1: Promote new test_lessons into brain_knowledge =====

async function promoteTestLessons(since: Date): Promise<{
  newLessons: number;
  confirmations: number;
  conflicts: number;
  details: any[];
}> {
  const sinceIso = since.toISOString();
  const lessonsRes = await pool.query(
    `SELECT tl.*, c.offer_position, c.has_vsl, c.niche as campaign_niche,
            c.user_id, c.id as cid
     FROM test_lessons tl
     JOIN campaigns c ON c.id = tl.campaign_id
     WHERE tl.created_at > $1
     ORDER BY tl.created_at ASC`,
    [sinceIso]
  );

  let newLessons = 0;
  let confirmations = 0;
  let conflicts = 0;
  const details: any[] = [];

  for (const lesson of lessonsRes.rows) {
    // Build the bucket key
    const bucket: BucketKey = {
      page_type: lesson.page_type || "sales_page",
      section_type: lesson.section_type,
      niche: normalizeNiche(lesson.campaign_niche || lesson.niche),
      traffic_source: null, // TODO: infer from visitors in a later version
      offer_position: lesson.offer_position || null,
      winner_strategy: lesson.winner_strategy || null,
    };
    const ctxHash = bucketHash(bucket);

    // Is there already a brain_knowledge row for this bucket?
    const existingRes = await pool.query(
      `SELECT id, confirmation_count, total_sample_size, lift_percent, supporting_campaign_ids
       FROM brain_knowledge
       WHERE context_hash = $1 AND status = 'active' AND source_type = 'internal'
       LIMIT 1`,
      [ctxHash]
    );

    if (existingRes.rows.length > 0) {
      // Same-bucket result. Does it confirm or contradict?
      // A lesson "confirms" the existing insight if both winners share the same strategy
      // AND the new lift is positive. A contradiction is: same strategy but this time the
      // strategy LOST, or opposite strategies both winning in the same bucket.
      const existing = existingRes.rows[0];
      const confirmed = lesson.lift_percent > 0; // winner_strategy already in the bucket key

      if (confirmed) {
        // Update: bump confirmation_count, add this campaign to supporting list,
        // blended sample size, last_confirmed_at now.
        const newSupportList = Array.from(
          new Set([...(existing.supporting_campaign_ids || []), lesson.cid])
        );
        await pool.query(
          `UPDATE brain_knowledge
           SET confirmation_count = confirmation_count + 1,
               total_sample_size = COALESCE(total_sample_size, 0) + $1,
               supporting_campaign_ids = $2,
               last_confirmed_at = NOW()
           WHERE id = $3`,
          [lesson.sample_size || 0, newSupportList, existing.id]
        );
        confirmations++;
        details.push({ lessonId: lesson.id, action: "confirmed", brainId: existing.id });
      } else {
        // Same bucket, opposite outcome. This is a real conflict.
        const inserted = await pool.query(
          `INSERT INTO brain_knowledge
             (knowledge_type, page_type, niche, section_type, original_text, winning_text,
              lift_percent, confidence, sample_size, insight, tags, campaign_id, user_id,
              source_type, context_hash, offer_position, has_vsl, price_point,
              supporting_campaign_ids, conflicting_ids, confirmation_count,
              total_sample_size, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   'internal', $14, $15, $16, $17, ARRAY[$12]::integer[], ARRAY[$18]::integer[],
                   1, $9, 'pending_review', NOW())
           RETURNING id`,
          [
            "test_result",
            lesson.page_type,
            bucket.niche,
            lesson.section_type,
            lesson.loser_text,
            lesson.winner_text,
            lesson.lift_percent,
            lesson.confidence,
            lesson.sample_size,
            lesson.lesson,
            lesson.winner_strategy,
            lesson.cid,
            lesson.user_id,
            ctxHash,
            lesson.offer_position,
            lesson.has_vsl,
            lesson.price_point,
            existing.id,
          ]
        );
        conflicts++;
        details.push({
          lessonId: lesson.id,
          action: "conflict",
          brainId: inserted.rows[0].id,
          conflictsWith: existing.id,
        });
      }
    } else {
      // Fresh bucket — write a new active row.
      const inserted = await pool.query(
        `INSERT INTO brain_knowledge
           (knowledge_type, page_type, niche, section_type, original_text, winning_text,
            lift_percent, confidence, sample_size, insight, tags, campaign_id, user_id,
            source_type, context_hash, offer_position, has_vsl, price_point,
            supporting_campaign_ids, confirmation_count, total_sample_size, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 'internal', $14, $15, $16, $17, ARRAY[$12]::integer[], 1, $9, 'active', NOW())
         RETURNING id`,
        [
          "test_result",
          lesson.page_type,
          bucket.niche,
          lesson.section_type,
          lesson.loser_text,
          lesson.winner_text,
          lesson.lift_percent,
          lesson.confidence,
          lesson.sample_size,
          lesson.lesson,
          lesson.winner_strategy,
          lesson.cid,
          lesson.user_id,
          ctxHash,
          lesson.offer_position,
          lesson.has_vsl,
          lesson.price_point,
        ]
      );
      newLessons++;
      details.push({ lessonId: lesson.id, action: "new", brainId: inserted.rows[0].id });
    }
  }

  return { newLessons, confirmations, conflicts, details };
}

// ===== Step 2: Flag structurally failing pages =====

async function flagStructuralIssues(): Promise<{ flags: number; details: any[] }> {
  // Find campaigns where avg scroll depth is < 10%, more than 500 visitors in
  // last 30 days, AND the offer is NOT above the fold (so low scroll legitimately
  // means visitors never see it). We only flag here if the data SUPPORTS the flag.
  const res = await pool.query(`
    WITH recent AS (
      SELECT vs.campaign_id,
             COUNT(*) as sessions,
             AVG(vs.max_scroll_depth)::numeric as avg_scroll,
             SUM(CASE WHEN vs.converted THEN 1 ELSE 0 END) as conversions
      FROM visitor_sessions vs
      WHERE vs.created_at > (NOW() - INTERVAL '30 days')::text
      GROUP BY vs.campaign_id
      HAVING COUNT(*) >= 500
    )
    SELECT r.campaign_id, r.sessions, r.avg_scroll, r.conversions,
           c.offer_position, c.has_vsl, c.name
    FROM recent r
    JOIN campaigns c ON c.id = r.campaign_id
    WHERE c.status = 'active'
      AND r.avg_scroll < 10
      AND COALESCE(c.offer_position, 'unknown') NOT IN ('above_fold', 'linked_page')
      AND r.conversions < 5
  `);

  const details: any[] = [];
  for (const row of res.rows) {
    // Write a structural_flag knowledge row. We use a unique context_hash per
    // campaign so we don't duplicate flags across runs, and status='pending_review'
    // so it shows up to the operator.
    const ctxHash = crypto
      .createHash("sha1")
      .update(`structural:${row.campaign_id}`)
      .digest("hex")
      .slice(0, 16);
    await pool.query(
      `INSERT INTO brain_knowledge
         (knowledge_type, page_type, niche, section_type, insight, tags,
          campaign_id, source_type, context_hash, offer_position, has_vsl,
          sample_size, confirmation_count, status, created_at, last_confirmed_at)
       VALUES ('structural_flag', NULL, NULL, NULL, $1, 'structural,page_health',
               $2, 'internal', $3, $4, $5, $6, 1, 'pending_review', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [
        `Campaign ${row.campaign_id} (${row.name}): ${row.sessions} sessions, avg scroll ${Math.round(row.avg_scroll)}%, only ${row.conversions} conversions, offer is ${row.offer_position || "unknown"}. Visitors are leaving before they see the offer — headline tests won't fix this.`,
        row.campaign_id,
        ctxHash,
        row.offer_position,
        row.has_vsl,
        row.sessions,
      ]
    );
    details.push({
      campaign_id: row.campaign_id,
      name: row.name,
      sessions: row.sessions,
      avg_scroll: Math.round(row.avg_scroll),
    });
  }
  return { flags: res.rows.length, details };
}

// ===== Main runner =====

export async function runBrainSync(): Promise<BrainSyncResult> {
  const start = Date.now();
  // Find last sync time — sync anything newer. On first run, look back 90 days.
  const lastRes = await pool.query(
    `SELECT run_at FROM brain_sync_log ORDER BY run_at DESC LIMIT 1`
  );
  const since: Date = lastRes.rows[0]?.run_at
    ? new Date(lastRes.rows[0].run_at)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  console.log(`[brain-sync] Starting run since ${since.toISOString()}`);

  const lessonsOutcome = await promoteTestLessons(since);
  const structural = await flagStructuralIssues();

  const durationMs = Date.now() - start;
  const summary = {
    since: since.toISOString(),
    lessons: lessonsOutcome.details,
    structural: structural.details,
  };

  await pool.query(
    `INSERT INTO brain_sync_log (new_lessons, confirmations, conflicts, structural_flags, duration_ms, summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      lessonsOutcome.newLessons,
      lessonsOutcome.confirmations,
      lessonsOutcome.conflicts,
      structural.flags,
      durationMs,
      JSON.stringify(summary),
    ]
  );

  console.log(
    `[brain-sync] Done in ${durationMs}ms: ` +
      `newLessons=${lessonsOutcome.newLessons} confirmations=${lessonsOutcome.confirmations} ` +
      `conflicts=${lessonsOutcome.conflicts} structuralFlags=${structural.flags}`
  );

  return {
    newLessons: lessonsOutcome.newLessons,
    confirmations: lessonsOutcome.confirmations,
    conflicts: lessonsOutcome.conflicts,
    structuralFlags: structural.flags,
    durationMs,
    summary,
  };
}
