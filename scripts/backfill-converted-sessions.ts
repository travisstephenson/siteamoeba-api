/**
 * One-time backfill: visitor_sessions.converted = true (and visitors.converted)
 * for every revenue_event that's already on file.
 *
 * Mirrors the logic in storage.ts → markSessionsConvertedForRevenueEvent so
 * historical analytics catch up to the live behavior we just shipped.
 *
 * Run:
 *   DATABASE_URL=... npx tsx scripts/backfill-converted-sessions.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-converted-sessions.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/backfill-converted-sessions.ts --campaign-id=116
 */
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const campaignFilter = args.find(a => a.startsWith('--campaign-id='))?.split('=')[1];
const campaignId = campaignFilter ? parseInt(campaignFilter, 10) : null;

const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const where = campaignId ? `WHERE re.campaign_id = ${campaignId}` : '';
  console.log(`[backfill] mode=${isDryRun ? 'DRY RUN' : 'LIVE'}, scope=${campaignId ? 'campaign ' + campaignId : 'all campaigns'}`);

  // Fetch all unique (campaign, visitor_id, customer_email) tuples from purchases
  const events = await pool.query(`
    SELECT DISTINCT campaign_id, visitor_id, customer_email
    FROM revenue_events re
    ${where}
    ${where ? 'AND' : 'WHERE'} event_type = 'purchase'
    ORDER BY campaign_id, visitor_id NULLS LAST
  `);
  console.log(`[backfill] ${events.rowCount} unique (campaign,visitor,email) tuples to process`);

  let totalSessionsFlipped = 0;
  let totalVisitorsFlipped = 0;
  let processed = 0;

  for (const ev of events.rows) {
    processed++;

    const visitorIds = new Set<string>();
    if (ev.visitor_id) visitorIds.add(ev.visitor_id);
    if (ev.customer_email) {
      const r = await pool.query(
        `SELECT DISTINCT id FROM visitors
           WHERE campaign_id = $1
             AND customer_email IS NOT NULL
             AND LOWER(customer_email) = LOWER($2)`,
        [ev.campaign_id, ev.customer_email]
      );
      for (const row of r.rows) visitorIds.add(row.id);
    }
    if (visitorIds.size === 0) continue;
    const ids = Array.from(visitorIds);

    if (isDryRun) {
      const sessCount = await pool.query(
        `SELECT COUNT(*)::int AS n FROM visitor_sessions
          WHERE visitor_id = ANY($1::text[]) AND campaign_id = $2 AND converted = false`,
        [ids, ev.campaign_id]
      );
      const visCount = await pool.query(
        `SELECT COUNT(*)::int AS n FROM visitors
          WHERE id = ANY($1::text[]) AND campaign_id = $2 AND converted = false`,
        [ids, ev.campaign_id]
      );
      totalSessionsFlipped += sessCount.rows[0].n;
      totalVisitorsFlipped += visCount.rows[0].n;
    } else {
      const sessRes = await pool.query(
        `UPDATE visitor_sessions
           SET converted = true, updated_at = NOW()::text
         WHERE visitor_id = ANY($1::text[])
           AND campaign_id = $2
           AND converted = false`,
        [ids, ev.campaign_id]
      );
      const visRes = await pool.query(
        `UPDATE visitors
           SET converted = true,
               converted_at = COALESCE(converted_at, NOW()::text),
               customer_email = COALESCE(customer_email, $3)
         WHERE id = ANY($1::text[])
           AND campaign_id = $2
           AND converted = false`,
        [ids, ev.campaign_id, ev.customer_email || null]
      );
      totalSessionsFlipped += sessRes.rowCount || 0;
      totalVisitorsFlipped += visRes.rowCount || 0;
    }

    if (processed % 100 === 0) {
      console.log(`[backfill] progress: ${processed}/${events.rowCount} tuples`);
    }
  }

  console.log(`\n[backfill] DONE`);
  console.log(`  tuples processed:        ${processed}`);
  console.log(`  visitor_sessions flipped: ${totalSessionsFlipped}`);
  console.log(`  visitors flipped:        ${totalVisitorsFlipped}`);
  console.log(`  mode:                    ${isDryRun ? 'DRY RUN (no changes written)' : 'LIVE'}`);
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[backfill] FATAL:', err);
    await pool.end();
    process.exit(1);
  });
