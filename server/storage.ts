import { eq, and, sql, count, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  users, campaigns, variants, visitors, impressions, testSections, testLessons, feedback,
  behavioralEvents, visitorSessions, dailyObservations, referrals,
  type User, type InsertUser,
  type Campaign, type InsertCampaign,
  type Variant, type InsertVariant,
  type Visitor, type InsertVisitor,
  type Impression, type InsertImpression,
  type TestSection, type InsertTestSection,
  type TestLesson, type InsertTestLesson,
  type Feedback, type InsertFeedback,
  type BehavioralEvent, type InsertBehavioralEvent,
  type VisitorSession,
  type DailyObservation, type InsertDailyObservation,
  type Referral, type InsertReferral,
} from "@shared/schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,                      // maximum connections in pool
  idleTimeoutMillis: 30000,     // close idle connections after 30s
  connectionTimeoutMillis: 5000, // throw if connection not acquired in 5s
  // Long-running TCP connections die silently on Railway/Cloudflare-fronted
  // proxies after ~10 minutes; refresh them periodically so a stale-keepalive
  // connection doesn't get handed out to a request and then ECONNRESET mid-query.
  // 5 min is well under both the proxy idle timeout and our 30s idle eviction.
  maxLifetimeSeconds: 300,
});

// CRITICAL: pg Pool's idle clients can emit 'error' events when the underlying
// TCP connection drops (Railway internal restart, network blip, Postgres SIGHUP).
// Without a listener, Node's default behavior is to throw — which on May 2 2026
// crashed the entire siteamoeba-api process and took every site down for ~36h.
// This handler logs and lets the pool reclaim/retry the affected client.
pool.on("error", (err) => {
  console.error("[pg pool] idle client error (recovered):", err?.message || err);
});

const db = drizzle(pool);

export interface VariantStats {
  variantId: number;
  type: string;
  text: string;
  isControl: boolean;
  isActive: boolean;
  testSectionId: number | null;
  createdAt: string | null;
  impressions: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  revenuePerVisitor: number;
  confidence: number;
  persuasionTags: string[] | null;
}

export interface DailyStats {
  date: string;
  impressions: number;
  conversions: number;
  revenue: number;
}

export interface CampaignWithStats {
  campaign: Campaign;
  totalVisitors: number;
  totalConversions: number;
  totalRevenue: number;
  conversionRate: number;
  variantCount: number;
}

export interface DashboardStats {
  activeCampaigns: number;
  archivedCampaigns: number;
  testsCompleted: number;
  testsWon: number;
  testsLost: number;
  winRate: number;
  totalVisitors: number;
  totalConversions: number;
  totalRevenue: number;
  projectedMonthlyGain: number;
  recentWins: Array<{ campaignName: string; section: string; lift: number; date: string }>;
  recentLosses: Array<{ campaignName: string; section: string; lift: number; date: string }>;
}

export interface ReferralStats {
  totalReferred: number;
  activeReferrals: number;
  totalEarned: number;
  pendingEarnings: number;
}

export interface IStorage {
  // Users
  getUserById(id: number): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  createUser(data: InsertUser & { passwordHash: string }): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User | undefined>;

  // Campaigns
  getCampaignsByUser(userId: number, status?: string): Promise<Campaign[]>;
  getCampaign(id: number): Promise<Campaign | undefined>;
  createCampaign(data: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: number, data: Partial<InsertCampaign>): Promise<Campaign | undefined>;
  deleteCampaign(id: number): Promise<void>;
  getCampaignCountByUser(userId: number): Promise<number>;
  getActiveCampaignsByUser(userId: number): Promise<Campaign[]>;
  getArchivedCampaignsByUser(userId: number): Promise<Campaign[]>;
  getCampaignByUrl(userId: number, url: string): Promise<Campaign | undefined>;
  archiveCampaign(id: number): Promise<Campaign | undefined>;
  unarchiveCampaign(id: number): Promise<Campaign | undefined>;

  // Variants
  getVariantsByCampaign(campaignId: number): Promise<Variant[]>;
  getActiveVariantsByCampaign(campaignId: number, type: string): Promise<Variant[]>;
  getVariant(id: number): Promise<Variant | undefined>;
  createVariant(data: InsertVariant): Promise<Variant>;
  updateVariant(id: number, data: Partial<InsertVariant>): Promise<Variant | undefined>;
  deleteVariant(id: number): Promise<void>;

  // Test Sections
  getTestSectionsByCampaign(campaignId: number): Promise<TestSection[]>;
  getTestSectionById(id: number): Promise<TestSection | undefined>;
  createTestSection(data: InsertTestSection): Promise<TestSection>;
  updateTestSection(id: number, data: Partial<InsertTestSection>): Promise<TestSection | undefined>;
  updateTestSectionStyles(id: number, styles: string): Promise<void>;
  getActiveTestCountByUser(userId: number): Promise<number>;

  // Visitors
  getVisitor(id: string): Promise<Visitor | undefined>;
  createVisitor(data: InsertVisitor): Promise<Visitor>;
  markConverted(visitorId: string, stripePaymentId: string, revenue: number): Promise<void>;
  getVisitorCountByCampaign(campaignId: number): Promise<number>;

  // Impressions
  createImpression(data: InsertImpression): Promise<Impression>;

  // Stats
  getVariantStats(campaignId: number): Promise<VariantStats[]>;
  getDailyStats(campaignId: number, days: number): Promise<DailyStats[]>;
  getCampaignsWithStats(userId: number, status?: string): Promise<CampaignWithStats[]>;

  // Test Lessons
  createTestLesson(data: InsertTestLesson): Promise<TestLesson>;
  getTestLessons(filters: { pageType?: string; niche?: string; sectionType?: string }): Promise<TestLesson[]>;
  getTestLessonCount(): Promise<number>;

  // Credits
  incrementCredits(userId: number): Promise<void>;
  incrementCreditsBy(userId: number, amount: number): Promise<void>;
  resetMonthlyCredits(userId: number): Promise<void>;

  // Feedback
  createFeedback(data: InsertFeedback): Promise<Feedback>;
  getFeedbackByUser(userId: number): Promise<Feedback[]>;
  getAllFeedback(): Promise<Feedback[]>;
  updateFeedbackStatus(id: number, status: string, adminNotes?: string): Promise<Feedback>;

  // Behavioral events
  createBehavioralEvent(data: InsertBehavioralEvent): Promise<void>;
  upsertVisitorSession(visitorId: string, campaignId: number, updates: {
    maxScrollDepth?: number;
    timeOnPage?: number;
    sectionsViewed?: string[];
    clickCount?: number;
    videoPlayed?: boolean;
    videoCompleted?: boolean;
    deviceType?: string;
    converted?: boolean;
  }): Promise<void>;
  getSessionsByCampaign(campaignId: number): Promise<VisitorSession[]>;
  getVisitorFeed(campaignId: number, limit?: number): Promise<any[]>;
  getSessionStats(campaignId: number): Promise<{
    avgScrollDepth: number;
    avgTimeOnPage: number;
    videoPlayRate: number;
    convertedAvgScroll: number;
    nonConvertedAvgScroll: number;
  }>;

  // Daily Observations
  createObservation(data: InsertDailyObservation): Promise<DailyObservation>;
  getObservationsByCampaign(campaignId: number, limit?: number): Promise<DailyObservation[]>;
  getLatestObservation(userId: number, campaignId: number): Promise<DailyObservation | undefined>;
  getTodayObservationCount(userId: number): Promise<number>;

  // Dashboard
  getDashboardStats(userId: number): Promise<DashboardStats>;

  // Referrals
  createReferral(data: InsertReferral): Promise<Referral>;
  getReferralsByReferrer(userId: number): Promise<Referral[]>;
  getReferralByReferred(userId: number): Promise<Referral | undefined>;
  getReferralStats(userId: number): Promise<ReferralStats>;
  updateReferralEarnings(referralId: number, amount: number): Promise<void>;

  // Brain Knowledge
  addBrainKnowledge(data: {
    knowledgeType: string;
    pageType?: string;
    niche?: string;
    sectionType?: string;
    originalText?: string;
    winningText?: string;
    liftPercent?: number;
    confidence?: number;
    sampleSize?: number;
    insight?: string;
    tags?: string;
    campaignId?: number;
    userId?: number;
  }): Promise<void>;
  getBrainKnowledge(opts: { pageType?: string; sectionType?: string; limit?: number }): Promise<any[]>;

  // Specialist Knowledge (Counsel system)
  addSpecialistKnowledge(data: {
    specialistRole: string;
    knowledgeType: string;
    pageType?: string;
    niche?: string;
    sectionType?: string;
    insight: string;
    winnerText?: string;
    loserText?: string;
    liftPercent?: number;
    sampleSize?: number;
    confidence?: number;
    campaignId?: number;
    userId?: number;
  }): Promise<void>;
  getSpecialistKnowledge(role: string, opts?: { pageType?: string; sectionType?: string; limit?: number }): Promise<any[]>;

  // Pixel verification
  updatePixelVerification(campaignId: number, field: "pixel" | "conversion_pixel", verified: boolean, url?: string): Promise<void>;

  // BYOK spend tracking (per-user monthly counter, see implementation comments).
  addBYOKSpend(userId: number, provider: string, costUsd: number, tokens: number): Promise<void>;
  getBYOKSpend(userId: number): Promise<{ monthKey: string; costUsd: number; calls: number }>;

  // Revenue events + LTV.
  // Returns true if the event was inserted, false if it was deduped.
  // Callers can ignore the return value safely — dedup logging is internal.
  addRevenueEvent(data: {
    visitorId?: string;
    campaignId: number;
    source: string;
    eventType: string;
    amount: number;
    currency?: string;
    externalId?: string;
    customerEmail?: string;
    metadata?: string;
  }): Promise<boolean>;
  getRevenueEventsByVisitor(visitorId: string): Promise<any[]>;
  getLTVByCampaign(campaignId: number): Promise<{
    totalRevenue: number;
    totalTransactions: number;
    averageLTV: number;
    revenueBySource: Record<string, number>;
    ltv30Day: number;
    ltv90Day: number;
  }>;

  // Traffic Anomalies
  createAnomaly(data: {
    campaignId: number;
    anomalyType: string;
    source: string | null;
    title: string;
    description: string;
    severity: string;
    metricValue: number | null;
    baselineValue: number | null;
  }): Promise<any>;
  getUnreadAnomalies(campaignId: number): Promise<any[]>;
  getAllAnomalies(campaignId: number, limit?: number): Promise<any[]>;
  getUnreadAnomalyCount(campaignId: number): Promise<number>;
  getUnreadAnomalyCountsByUser(userId: number): Promise<Record<number, number>>;
  markAnomalyRead(anomalyId: number): Promise<void>;
  markAllAnomaliesRead(campaignId: number): Promise<void>;
  checkRecentAnomaly(campaignId: number, anomalyType: string, source: string | null, sinceDate: string): Promise<boolean>;

  // Init
  pushSchema(): Promise<void>;
}

class StorageImpl implements IStorage {
  // ===== Schema push =====
  async pushSchema(): Promise<void> {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        plan TEXT NOT NULL DEFAULT 'free',
        credits_used INTEGER NOT NULL DEFAULT 0,
        credits_limit INTEGER NOT NULL DEFAULT 10,
        campaigns_limit INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        headline_selector TEXT,
        subheadline_selector TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS variants (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        is_control BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        headline_variant_id INTEGER NOT NULL,
        subheadline_variant_id INTEGER NOT NULL,
        converted BOOLEAN NOT NULL DEFAULT false,
        converted_at TEXT,
        stripe_payment_id TEXT,
        revenue REAL,
        user_agent TEXT,
        referrer TEXT,
        first_seen TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS impressions (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        campaign_id INTEGER NOT NULL,
        headline_variant_id INTEGER NOT NULL,
        subheadline_variant_id INTEGER NOT NULL,
        user_agent TEXT,
        referrer TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);
    // Create test_sections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_sections (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        section_id TEXT NOT NULL,
        label TEXT NOT NULL,
        purpose TEXT,
        selector TEXT NOT NULL,
        category TEXT NOT NULL,
        current_text TEXT,
        test_priority INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT false,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);
    // Create test_lessons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_lessons (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        section_type TEXT NOT NULL,
        page_type TEXT,
        niche TEXT,
        price_point TEXT,
        winner_text TEXT NOT NULL,
        loser_text TEXT NOT NULL,
        winner_conversion_rate REAL NOT NULL,
        loser_conversion_rate REAL NOT NULL,
        lift_percent REAL NOT NULL,
        winner_strategy TEXT,
        loser_strategy TEXT,
        sample_size INTEGER NOT NULL,
        confidence REAL NOT NULL,
        lesson TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);
    // Create feedback table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        admin_notes TEXT,
        campaign_id INTEGER,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);
    // Create behavioral_events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS behavioral_events (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        campaign_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        timestamp TEXT NOT NULL DEFAULT ''
      );
    `);
    // Create visitor_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitor_sessions (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        campaign_id INTEGER NOT NULL,
        max_scroll_depth INTEGER NOT NULL DEFAULT 0,
        time_on_page INTEGER NOT NULL DEFAULT 0,
        sections_viewed TEXT,
        click_count INTEGER NOT NULL DEFAULT 0,
        video_played BOOLEAN NOT NULL DEFAULT false,
        video_completed BOOLEAN NOT NULL DEFAULT false,
        device_type TEXT,
        converted BOOLEAN NOT NULL DEFAULT false,
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS visitor_sessions_vid_cid ON visitor_sessions (visitor_id, campaign_id);
    `);
    // Add new columns if they don't exist (idempotent migrations)
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_provider TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_model TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS min_visitors_per_variant INTEGER NOT NULL DEFAULT 100;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS win_confidence_threshold INTEGER NOT NULL DEFAULT 95;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_overage BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS overage_credits_used INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS concurrent_test_limit INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE variants ADD COLUMN IF NOT EXISTS persuasion_tags TEXT;
      ALTER TABLE variants ADD COLUMN IF NOT EXISTS test_section_id INTEGER;
      ALTER TABLE test_sections ADD COLUMN IF NOT EXISTS test_method TEXT NOT NULL DEFAULT 'text_swap';
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS page_type TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS page_goal TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS price_point TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS niche TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS autopilot_step INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS autopilot_status TEXT DEFAULT 'idle';
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS archived_at TEXT;
    `);
    // Create daily_observations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_observations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        campaign_id INTEGER NOT NULL,
        observation TEXT NOT NULL,
        data_points TEXT,
        category TEXT NOT NULL,
        credits_used INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS daily_observations_campaign_id ON daily_observations (campaign_id);
      CREATE INDEX IF NOT EXISTS daily_observations_user_id_created ON daily_observations (user_id, created_at);
    `);
    // Add referral columns to users
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER;
      ALTER TABLE test_sections ADD COLUMN IF NOT EXISTS element_styles TEXT;
    `);
    // Create referrals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL,
        referred_id INTEGER NOT NULL,
        referral_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        commission_rate REAL NOT NULL DEFAULT 0.20,
        total_earned REAL NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS referrals_referrer_id ON referrals (referrer_id);
      CREATE INDEX IF NOT EXISTS referrals_referred_id ON referrals (referred_id);
      CREATE UNIQUE INDEX IF NOT EXISTS referrals_referral_code ON users (referral_code) WHERE referral_code IS NOT NULL;

      -- Brain Knowledge: shared intelligence from all users' test results
      CREATE TABLE IF NOT EXISTS brain_knowledge (
        id SERIAL PRIMARY KEY,
        knowledge_type TEXT NOT NULL,       -- 'test_result', 'pattern', 'headline_lesson', 'behavioral'
        page_type TEXT,                      -- e.g. 'sales', 'landing', 'webinar'
        niche TEXT,                           -- e.g. 'digital marketing', 'fitness'
        section_type TEXT,                    -- e.g. 'headline', 'cta', 'social_proof'
        original_text TEXT,                   -- the control/original copy
        winning_text TEXT,                    -- what won (if applicable)
        lift_percent REAL,                    -- conversion lift percentage
        confidence REAL,                      -- statistical confidence
        sample_size INTEGER,                  -- total visitors in the test
        insight TEXT,                          -- AI-generated lesson from this result
        tags TEXT,                             -- JSON array of persuasion tags
        campaign_id INTEGER,                  -- reference (not exposed to other users)
        user_id INTEGER,                      -- who contributed (not exposed to other users)
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_brain_knowledge_type ON brain_knowledge(knowledge_type);
      CREATE INDEX IF NOT EXISTS idx_brain_knowledge_page_type ON brain_knowledge(page_type, section_type);

      -- Campaign pixel verification fields
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pixel_verified BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pixel_verified_at TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS conversion_url TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS conversion_pixel_verified BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS conversion_pixel_verified_at TEXT;
    `);
    // UTM + traffic source columns on visitors
    await pool.query(`
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS utm_source TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS utm_medium TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS utm_content TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS utm_term TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS traffic_source TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS device_category TEXT;
    `);
    // Performance indexes for high-traffic query paths
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_visitors_campaign_id ON visitors(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_visitors_campaign_converted ON visitors(campaign_id, converted);
      CREATE INDEX IF NOT EXISTS idx_visitors_traffic_source ON visitors(campaign_id, traffic_source);
      CREATE INDEX IF NOT EXISTS idx_variants_campaign_id ON variants(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_variants_campaign_type ON variants(campaign_id, type);
      CREATE INDEX IF NOT EXISTS idx_test_sections_campaign_id ON test_sections(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_behavioral_events_visitor ON behavioral_events(visitor_id, campaign_id);
      CREATE INDEX IF NOT EXISTS idx_behavioral_events_campaign ON behavioral_events(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_user_status ON campaigns(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_impressions_campaign_id ON impressions(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_test_lessons_page_type ON test_lessons(page_type, section_type);
      CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
    `);
    // Revenue events table for multi-touch LTV tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS revenue_events (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT,
        campaign_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        external_id TEXT,
        customer_email TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_revenue_events_visitor ON revenue_events(visitor_id);
      CREATE INDEX IF NOT EXISTS idx_revenue_events_campaign ON revenue_events(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_revenue_events_email ON revenue_events(customer_email);
    `);
    // Webhook / integration columns on campaigns
    await pool.query(`
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stripe_connected BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS shopify_connected BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
    `);
    // Campaign type (purchase vs lead_gen)
    await pool.query(`
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'purchase';
    `);
    // Section map for drop-off analysis (populated by widget)
    await pool.query(`
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS section_map JSONB;
    `);
    // Cached AI-generated "carrot" recommendation for the current biggest
    // drop-off section. JSON shape:
    //   { sectionIdx, prevHeading, dropPct, diagnosis, cliffhangers: string[],
    //     lang, generatedAt }
    // We regenerate when the biggest-drop section index changes OR when the
    // drop magnitude shifts by >= 5 percentage points (keeps the advice fresh
    // without spamming the LLM).
    await pool.query(`
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS section_dropoff_recommendation JSONB;
    `);
    // Platform integrations (Teachable, Kajabi, Thinkific, Stan Store webhooks)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_integrations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        events_received INTEGER NOT NULL DEFAULT 0,
        last_event_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, platform)
      );
    `);
    // Network intelligence (Brain learning system)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS network_intelligence (
        id SERIAL PRIMARY KEY,
        knowledge_text TEXT NOT NULL,
        stats JSONB,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Conversion counter for triggering intelligence refresh
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_counters (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
    `);
    await pool.query(`
      INSERT INTO system_counters (key, value) VALUES ('conversions_since_refresh', 0)
      ON CONFLICT (key) DO NOTHING;
    `);
    // Traffic anomalies for lightbulb intelligence alerts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS traffic_anomalies (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        anomaly_type TEXT NOT NULL,
        source TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'info',
        metric_value REAL,
        baseline_value REAL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        detected_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_anomalies_campaign ON traffic_anomalies(campaign_id, is_read);

      -- Specialist Knowledge: each counsel specialist accumulates domain-specific learnings
      CREATE TABLE IF NOT EXISTS specialist_knowledge (
        id SERIAL PRIMARY KEY,
        specialist_role TEXT NOT NULL,     -- 'copywriter', 'psychologist', 'analyst'
        knowledge_type TEXT NOT NULL,      -- 'post_mortem', 'pattern', 'insight'
        page_type TEXT,
        niche TEXT,
        section_type TEXT,
        insight TEXT NOT NULL,              -- the specialist's domain-specific learning
        winner_text TEXT,
        loser_text TEXT,
        lift_percent REAL,
        sample_size INTEGER,
        confidence REAL,
        campaign_id INTEGER,
        user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_specialist_knowledge_role ON specialist_knowledge(specialist_role, section_type);
      CREATE INDEX IF NOT EXISTS idx_specialist_knowledge_page ON specialist_knowledge(specialist_role, page_type);
    `);
    // Stripe account-level connection columns
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_access_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connected_at TEXT;
    `);
    // User-level integration columns
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS shopify_store_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS shopify_connected_at TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS ghl_connected_at TEXT;
    `);
    // Whop integration columns
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_connected_at TEXT;
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS first_test_enabled_at TEXT;
    `);
    await pool.query(`
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS fingerprint TEXT;
      CREATE INDEX IF NOT EXISTS visitors_fingerprint_campaign ON visitors (fingerprint, campaign_id);
    `);
    // Variant display validation — tracks widget-detected rendering failures
    await pool.query(`
      ALTER TABLE variants ADD COLUMN IF NOT EXISTS display_issue BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE variants ADD COLUMN IF NOT EXISTS display_issue_reason TEXT;
      ALTER TABLE variants ADD COLUMN IF NOT EXISTS display_issue_at TEXT;
    `);
    // Customer email on visitors — stored at first purchase for downstream Stripe attribution
    // Lets us attribute $97 OTO + $199 OTO2 purchases back to the original campaign
    // by matching all future Stripe charges from the same email to the original visitor
    await pool.query(`
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_email TEXT;
      CREATE INDEX IF NOT EXISTS idx_visitors_email ON visitors (customer_email);
    `);
    // Visual editor mutations — element targeting and style overrides from visual editor
    await pool.query(`
      ALTER TABLE variants ADD COLUMN IF NOT EXISTS mutations TEXT;
    `);
    // Client error logs — captures React crashes and widget errors for admin visibility
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_errors (
        id SERIAL PRIMARY KEY,
        message TEXT,
        stack TEXT,
        component_stack TEXT,
        error_type TEXT,
        url TEXT,
        user_id INTEGER,
        user_email TEXT,
        created_at TEXT NOT NULL DEFAULT NOW()::text
      );
    `);
  }

  // ===== Users =====
  async getAllUsers(): Promise<User[]> {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      plan: row.plan,
      creditsUsed: row.credits_used,
      creditsLimit: row.credits_limit,
      campaignsLimit: row.campaigns_limit,
      createdAt: row.created_at,
      llmProvider: row.llm_provider,
      llmApiKey: row.llm_api_key,
      llmModel: row.llm_model,
      minVisitorsPerVariant: row.min_visitors_per_variant,
      winConfidenceThreshold: row.win_confidence_threshold,
      allowOverage: row.allow_overage,
      overageCreditsUsed: row.overage_credits_used,
      concurrentTestLimit: row.concurrent_test_limit,
      referralCode: row.referral_code,
      referredBy: row.referred_by,
      isAdmin: row.is_admin,
      trialEndsAt: row.trial_ends_at,
      adminNotes: row.admin_notes_user,
      accountStatus: row.account_status || 'active',
      firstTestEnabledAt: row.first_test_enabled_at || null,
    })) as User[];
  }

  async getUserById(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.email, email));
    return rows[0];
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return rows[0];
  }

  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.referralCode, code));
    return rows[0];
  }

  async createUser(data: InsertUser & { passwordHash: string }): Promise<User> {
    const rows = await db.insert(users).values({
      email: data.email,
      name: data.name,
      passwordHash: data.passwordHash,
    }).returning();
    return rows[0];
  }

  async updateUser(id: number, data: Partial<User>): Promise<User | undefined> {
    const rows = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return rows[0];
  }

  // ===== Campaigns =====
  async getCampaignsByUser(userId: number, status?: string): Promise<Campaign[]> {
    if (status && status !== 'all') {
      return db.select().from(campaigns).where(and(eq(campaigns.userId, userId), eq(campaigns.status, status)));
    }
    return db.select().from(campaigns).where(eq(campaigns.userId, userId));
  }

  async getActiveCampaignsByUser(userId: number): Promise<Campaign[]> {
    return db.select().from(campaigns).where(and(eq(campaigns.userId, userId), eq(campaigns.status, 'active')));
  }

  async getArchivedCampaignsByUser(userId: number): Promise<Campaign[]> {
    return db.select().from(campaigns).where(and(eq(campaigns.userId, userId), eq(campaigns.status, 'archived')));
  }

  async getCampaignByUrl(userId: number, url: string): Promise<Campaign | undefined> {
    const rows = await db.select().from(campaigns).where(
      and(eq(campaigns.userId, userId), eq(campaigns.url, url), eq(campaigns.status, 'active'))
    );
    return rows[0];
  }

  async archiveCampaign(id: number): Promise<Campaign | undefined> {
    const now = new Date().toISOString();
    // Deactivate all test sections
    await db.update(testSections).set({ isActive: false }).where(eq(testSections.campaignId, id));
    // Deactivate all variants
    await db.update(variants).set({ isActive: false }).where(eq(variants.campaignId, id));
    // Archive the campaign + fully reset autopilot so a poll never picks this up again
    const rows = await db.update(campaigns).set({
      status: 'archived',
      archivedAt: now,
      isActive: false,
      autopilotEnabled: false,
      autopilotStatus: 'paused',
    }).where(eq(campaigns.id, id)).returning();
    return rows[0];
  }

  async unarchiveCampaign(id: number): Promise<Campaign | undefined> {
    const rows = await db.update(campaigns).set({
      status: 'active',
      archivedAt: null,
      isActive: true,
    }).where(eq(campaigns.id, id)).returning();
    return rows[0];
  }

  async getCampaign(id: number): Promise<Campaign | undefined> {
    const rows = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return rows[0];
  }

  async createCampaign(data: InsertCampaign): Promise<Campaign> {
    const rows = await db.insert(campaigns).values(data).returning();
    return rows[0];
  }

  async updateCampaign(id: number, data: Partial<InsertCampaign>): Promise<Campaign | undefined> {
    const rows = await db.update(campaigns).set(data).where(eq(campaigns.id, id)).returning();
    return rows[0];
  }

  async deleteCampaign(id: number): Promise<void> {
    await db.delete(impressions).where(eq(impressions.campaignId, id));
    await db.delete(visitors).where(eq(visitors.campaignId, id));
    await db.delete(variants).where(eq(variants.campaignId, id));
    await db.delete(campaigns).where(eq(campaigns.id, id));
  }

  async getCampaignCountByUser(userId: number): Promise<number> {
    const rows = await db.select({ count: count() }).from(campaigns).where(eq(campaigns.userId, userId));
    return rows[0]?.count || 0;
  }

  // ===== Variants =====
  async getVariantsByCampaign(campaignId: number): Promise<Variant[]> {
    // Only return active variants — soft-deleted ones (isActive=false) should never appear in the UI
    return db.select().from(variants).where(
      and(eq(variants.campaignId, campaignId), eq(variants.isActive, true))
    );
  }

  async getActiveVariantsByCampaign(campaignId: number, type: string): Promise<Variant[]> {
    return db.select().from(variants)
      .where(and(eq(variants.campaignId, campaignId), eq(variants.type, type), eq(variants.isActive, true)));
  }

  async getVariant(id: number): Promise<Variant | undefined> {
    const rows = await db.select().from(variants).where(eq(variants.id, id));
    return rows[0];
  }

  async createVariant(data: InsertVariant): Promise<Variant> {
    const rows = await db.insert(variants).values(data).returning();
    return rows[0];
  }

  async updateVariant(id: number, data: Partial<InsertVariant>): Promise<Variant | undefined> {
    const rows = await db.update(variants).set(data).where(eq(variants.id, id)).returning();
    return rows[0];
  }

  async deleteVariant(id: number): Promise<void> {
    // Check if any visitors reference this variant — if so, soft-delete (deactivate) instead of hard delete
    const hasVisitors = await pool.query(
      'SELECT 1 FROM visitors WHERE headline_variant_id = $1 OR subheadline_variant_id = $1 LIMIT 1',
      [id]
    );
    if (hasVisitors.rows.length > 0) {
      // Soft delete: deactivate and mark as not control so it doesn't appear in active tests
      await db.update(variants).set({ isActive: false, isControl: false } as any).where(eq(variants.id, id));
    } else {
      await db.delete(variants).where(eq(variants.id, id));
    }
  }

  // ===== Test Sections =====
  async getTestSectionsByCampaign(campaignId: number): Promise<TestSection[]> {
    return db.select().from(testSections).where(eq(testSections.campaignId, campaignId));
  }

  async getTestSectionById(id: number): Promise<TestSection | undefined> {
    const rows = await db.select().from(testSections).where(eq(testSections.id, id));
    return rows[0];
  }

  async getActiveTestCountByUser(userId: number): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM test_sections ts
       JOIN campaigns c ON ts.campaign_id = c.id
       WHERE c.user_id = $1 AND ts.is_active = true`,
      [userId]
    );
    return parseInt(result.rows[0]?.count) || 0;
  }

  async createTestSection(data: InsertTestSection): Promise<TestSection> {
    const rows = await db.insert(testSections).values(data).returning();
    return rows[0];
  }

  async updateTestSection(id: number, data: Partial<InsertTestSection>): Promise<TestSection | undefined> {
    const rows = await db.update(testSections).set(data).where(eq(testSections.id, id)).returning();
    return rows[0];
  }

  async updateTestSectionStyles(id: number, styles: string): Promise<void> {
    await pool.query(
      `UPDATE test_sections SET element_styles = $1 WHERE id = $2`,
      [styles, id]
    );
  }

  // ===== Visitors =====
  async getVisitor(id: string): Promise<Visitor | undefined> {
    const rows = await db.select().from(visitors).where(eq(visitors.id, id));
    return rows[0];
  }

  async createVisitor(data: InsertVisitor): Promise<Visitor> {
    const rows = await db.insert(visitors).values(data).returning();
    return rows[0];
  }

  async markConverted(visitorId: string, stripePaymentId: string, revenue: number, customerEmail?: string): Promise<void> {
    const updates: any = {
      converted: true,
      convertedAt: new Date().toISOString(),
      stripePaymentId,
      revenue,
    };
    // Store customer email for downstream Stripe attribution (OTO/upsell tracking)
    if (customerEmail) updates.customerEmail = customerEmail;
    await db.update(visitors).set(updates).where(eq(visitors.id, visitorId));
  }

  async getVisitorCountByCampaign(campaignId: number): Promise<number> {
    const rows = await db.select({ count: count() }).from(visitors).where(eq(visitors.campaignId, campaignId));
    return rows[0]?.count || 0;
  }

  // ===== Impressions =====
  async createImpression(data: InsertImpression): Promise<Impression> {
    const rows = await db.insert(impressions).values(data).returning();
    return rows[0];
  }

  // ===== Stats =====
  async getVariantStats(campaignId: number): Promise<VariantStats[]> {
    const allVariants = await this.getVariantsByCampaign(campaignId);
    const stats: VariantStats[] = [];

    // Determine test start date per type: when the newest challenger was created.
    // This ensures BOTH control and challenger are only counted from when the test began,
    // preventing pre-test conversions from inflating the control's stats.
    const testStartByType: Record<string, Date> = {};
    for (const v of allVariants) {
      if (!v.isControl && v.isActive && v.createdAt) {
        const t = v.type || "";
        const created = new Date(v.createdAt);
        if (!testStartByType[t] || created > testStartByType[t]) {
          testStartByType[t] = created;
        }
      }
    }

    for (const v of allVariants) {
      const isHeadline = v.type === "headline";
      const isSubheadline = v.type === "subheadline";
      const isSectionVariant = !isHeadline && !isSubheadline;

      let impResult, convResult, revResult;

      if (isSectionVariant) {
        // Section variants are tracked via JSON column section_variant_assignments
        // Use JSON text matching: look for '"variantId' pattern in the JSON
        const jsonPattern = `%"${v.id}"%`;
        // More precise: search for the variant ID as a value in the JSON
        // The format is {"sectionId": variantId}, so we look for :variantId or : variantId
        const jsonPatternExact = `%:${v.id}%`;
        const jsonPatternSpaced = `%: ${v.id}%`;
        impResult = await pool.query(
          `SELECT COUNT(DISTINCT id) as count FROM visitors WHERE campaign_id = $1 AND (
            section_variant_assignments LIKE $2 OR section_variant_assignments LIKE $3
          )`,
          [campaignId, jsonPatternExact, jsonPatternSpaced]
        );
        // Count DISTINCT buyer emails so a buyer who triggered N visitor
        // rows + N upsells across the same email doesn't show as N
        // conversions. Falls back to distinct visitor IDs when email is
        // missing. (May 2026 — Tiffany incident: Jeff had 20 visitor rows
        // marked converted from a single buyer.)
        convResult = await pool.query(
          `SELECT COUNT(*) as count FROM (
             SELECT COALESCE(NULLIF(LOWER(TRIM(customer_email)), ''), id) AS buyer_key
             FROM visitors
             WHERE campaign_id = $1 AND converted = true AND (
               section_variant_assignments LIKE $2 OR section_variant_assignments LIKE $3
             )
             GROUP BY 1
           ) buyers`,
          [campaignId, jsonPatternExact, jsonPatternSpaced]
        );
        revResult = await pool.query(
          `SELECT COALESCE(SUM(revenue), 0) as total FROM visitors WHERE campaign_id = $1 AND converted = true AND (
            section_variant_assignments LIKE $2 OR section_variant_assignments LIKE $3
          )`,
          [campaignId, jsonPatternExact, jsonPatternSpaced]
        );
      } else {
        const column = isHeadline ? "headline_variant_id" : "subheadline_variant_id";
        // Scope to visitors who arrived AFTER the test started (when newest challenger was created).
        // For controls, this prevents pre-test conversions from inflating stats.
        // For challengers, their own createdAt is the test start date anyway.
        const testStart = testStartByType[v.type || ""] || v.createdAt || new Date(0);
        impResult = await pool.query(
          `SELECT COUNT(DISTINCT id) as count FROM visitors WHERE campaign_id = $1 AND ${column} = $2 AND first_seen >= $3`,
          [campaignId, v.id, testStart]
        );
        // Same dedupe-by-email rule as the section-variant path above.
        convResult = await pool.query(
          `SELECT COUNT(*) as count FROM (
             SELECT COALESCE(NULLIF(LOWER(TRIM(customer_email)), ''), id) AS buyer_key
             FROM visitors
             WHERE campaign_id = $1 AND ${column} = $2 AND converted = true AND first_seen >= $3
             GROUP BY 1
           ) buyers`,
          [campaignId, v.id, testStart]
        );
        // Revenue: sum ALL revenue_events (purchases + refunds) for net revenue
        revResult = await pool.query(
          `SELECT COALESCE(SUM(re.amount), 0) as total
           FROM revenue_events re
           JOIN visitors v ON v.id = re.visitor_id
           WHERE re.campaign_id = $1 AND v.${column} = $2 AND v.first_seen >= $3`,
          [campaignId, v.id, testStart]
        );
      }

      const imp = parseInt(impResult.rows[0]?.count) || 0;
      const conv = parseInt(convResult.rows[0]?.count) || 0;
      const rev = parseFloat(revResult.rows[0]?.total) || 0;
      const cr = imp > 0 ? conv / imp : 0;
      const rpv = imp > 0 ? rev / imp : 0;

      // Parse persuasion tags from JSON text field
      let parsedTags: string[] | null = null;
      if (v.persuasionTags) {
        try {
          parsedTags = JSON.parse(v.persuasionTags);
        } catch {
          parsedTags = null;
        }
      }

      stats.push({
        variantId: v.id,
        type: v.type,
        text: v.text,
        isControl: v.isControl,
        isActive: v.isActive,
        testSectionId: v.testSectionId ?? null,
        createdAt: v.createdAt ?? null,
        impressions: imp,
        conversions: conv,
        conversionRate: cr,
        revenue: rev,
        revenuePerVisitor: rpv,
        confidence: 0,
        persuasionTags: parsedTags,
      });
    }

    // Calculate statistical significance vs control for each variant type
    const allTypes = [...new Set(stats.map(s => s.type))];
    for (const type of allTypes) {
      const typeStats = stats.filter(s => s.type === type);
      const control = typeStats.find(s => s.isControl);
      if (!control || control.impressions < 10) continue;

      for (const s of typeStats) {
        if (s.isControl || s.impressions < 10) { s.confidence = 0; continue; }
        s.confidence = this.calculateZTestConfidence(
          control.conversions, control.impressions,
          s.conversions, s.impressions
        );
      }
    }

    return stats;
  }

  private calculateZTestConfidence(
    controlConv: number, controlImp: number,
    variantConv: number, variantImp: number
  ): number {
    const p1 = controlConv / controlImp;
    const p2 = variantConv / variantImp;
    const pPooled = (controlConv + variantConv) / (controlImp + variantImp);
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / controlImp + 1 / variantImp));
    if (se === 0) return 0;
    const z = (p2 - p1) / se;
    const confidence = (1 - 2 * (1 - this.normalCDF(Math.abs(z)))) * 100;
    return Math.max(0, Math.min(100, confidence));
  }

  private normalCDF(x: number): number {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  }

  async getDailyStats(campaignId: number, days: number): Promise<DailyStats[]> {
    const result = await pool.query(`
      SELECT
        TO_CHAR(TO_TIMESTAMP(first_seen, 'YYYY-MM-DD"T"HH24:MI:SS'), 'YYYY-MM-DD') as date,
        COUNT(*) as impressions,
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END) as conversions,
        COALESCE(SUM(revenue), 0) as revenue
      FROM visitors
      WHERE campaign_id = $1 AND first_seen >= (NOW() - INTERVAL '1 day' * $2)::text
      GROUP BY date
      ORDER BY date ASC
    `, [campaignId, days]);
    return result.rows.map(r => ({
      date: r.date,
      impressions: parseInt(r.impressions) || 0,
      conversions: parseInt(r.conversions) || 0,
      revenue: parseFloat(r.revenue) || 0,
    }));
  }

  async getCampaignsWithStats(userId: number, status?: string): Promise<CampaignWithStats[]> {
    const userCampaigns = await this.getCampaignsByUser(userId, status);
    const results: CampaignWithStats[] = [];

    for (const campaign of userCampaigns) {
      // Count all visitors for this campaign — matches the campaign detail stats endpoint
      const visResult = await pool.query(
        "SELECT COUNT(*) as count FROM visitors v WHERE v.campaign_id = $1",
        [campaign.id]
      );
      // Conversions = distinct INITIAL buyers per Travis's directive: 'CVR
      // should ONLY EVER SHOW the sales that take place initially, and not
      // add in every potential upsell.' One buyer = one conversion, even
      // if they triggered N upsells across N visits. (May 2026 — Tiffany.)
      const convResult = await pool.query(
        `SELECT COUNT(*) AS count FROM (
           SELECT COALESCE(NULLIF(LOWER(TRIM(customer_email)), ''), external_id, visitor_id) AS buyer_key
           FROM revenue_events
           WHERE campaign_id = $1 AND event_type = 'purchase'
             AND COALESCE(NULLIF(LOWER(TRIM(customer_email)), ''), external_id, visitor_id) IS NOT NULL
           GROUP BY 1
         ) buyers`,
        [campaign.id]
      );
      // Revenue = sum of all purchase events (initial + upsells = total).
      const revResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM revenue_events
         WHERE campaign_id = $1 AND event_type = 'purchase'`,
        [campaign.id]
      );
      const varResult = await pool.query(
        "SELECT COUNT(*) as count FROM variants WHERE campaign_id = $1",
        [campaign.id]
      );

      const vis = parseInt(visResult.rows[0]?.count) || 0;
      const conv = parseInt(convResult.rows[0]?.count) || 0;

      results.push({
        campaign,
        totalVisitors: vis,
        totalConversions: conv,
        totalRevenue: parseFloat(revResult.rows[0]?.total) || 0,
        conversionRate: vis > 0 ? (conv / vis) * 100 : 0,
        variantCount: parseInt(varResult.rows[0]?.count) || 0,
      });
    }

    return results;
  }

  // ===== Test Lessons =====
  async createTestLesson(data: InsertTestLesson): Promise<TestLesson> {
    const rows = await db.insert(testLessons).values(data).returning();
    return rows[0];
  }

  async getTestLessons(filters: { pageType?: string; niche?: string; sectionType?: string }): Promise<TestLesson[]> {
    const conditions = [];
    if (filters.pageType) conditions.push(eq(testLessons.pageType, filters.pageType));
    if (filters.niche) conditions.push(eq(testLessons.niche, filters.niche));
    if (filters.sectionType) conditions.push(eq(testLessons.sectionType, filters.sectionType));

    if (conditions.length === 0) {
      return db.select().from(testLessons).orderBy(testLessons.createdAt);
    }
    // Query with at least one matching condition (pageType OR sectionType match)
    // We prioritize sectionType + pageType matches, then fall back to sectionType only
    if (filters.sectionType && filters.pageType) {
      // Try to get lessons that match both, then fall back to sectionType only
      const both = await db.select().from(testLessons)
        .where(and(eq(testLessons.sectionType, filters.sectionType), eq(testLessons.pageType, filters.pageType)))
        .orderBy(testLessons.createdAt);
      if (both.length > 0) return both;
      // Fall back to sectionType match only
      return db.select().from(testLessons)
        .where(eq(testLessons.sectionType, filters.sectionType))
        .orderBy(testLessons.createdAt);
    }
    if (filters.sectionType) {
      return db.select().from(testLessons)
        .where(eq(testLessons.sectionType, filters.sectionType))
        .orderBy(testLessons.createdAt);
    }
    return db.select().from(testLessons)
      .where(and(...conditions))
      .orderBy(testLessons.createdAt);
  }

  async getTestLessonCount(): Promise<number> {
    const rows = await db.select({ count: count() }).from(testLessons);
    return rows[0]?.count || 0;
  }

  // ===== Credits =====
  async incrementCredits(userId: number): Promise<void> {
    await pool.query("UPDATE users SET credits_used = credits_used + 1 WHERE id = $1", [userId]);
  }

  async incrementCreditsBy(userId: number, amount: number): Promise<void> {
    if (amount <= 0) return;
    await pool.query("UPDATE users SET credits_used = credits_used + $1 WHERE id = $2", [amount, userId]);
  }

  async resetMonthlyCredits(userId: number): Promise<void> {
    await pool.query("UPDATE users SET credits_used = 0 WHERE id = $1", [userId]);
  }

  // ===== Feedback =====
  async createFeedback(data: InsertFeedback): Promise<Feedback> {
    const rows = await db.insert(feedback).values({
      userId: data.userId,
      category: data.category,
      message: data.message,
      campaignId: data.campaignId ?? null,
    }).returning();
    return rows[0];
  }

  async getFeedbackByUser(userId: number): Promise<Feedback[]> {
    return db.select().from(feedback).where(eq(feedback.userId, userId));
  }

  async getAllFeedback(): Promise<Feedback[]> {
    return db.select().from(feedback);
  }

  async updateFeedbackStatus(id: number, status: string, adminNotes?: string): Promise<Feedback> {
    const updateData: Partial<Feedback> = { status };
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    const rows = await db.update(feedback).set(updateData).where(eq(feedback.id, id)).returning();
    return rows[0];
  }

  // ===== Behavioral Events =====
  async createBehavioralEvent(data: InsertBehavioralEvent): Promise<void> {
    await db.insert(behavioralEvents).values(data);
  }

  async upsertVisitorSession(visitorId: string, campaignId: number, updates: {
    maxScrollDepth?: number;
    timeOnPage?: number;
    sectionsViewed?: string[];
    clickCount?: number;
    videoPlayed?: boolean;
    videoCompleted?: boolean;
    deviceType?: string;
    converted?: boolean;
    pageHeight?: number;
    screenWidth?: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    // Try to get existing session
    const existing = await pool.query(
      "SELECT * FROM visitor_sessions WHERE visitor_id = $1 AND campaign_id = $2",
      [visitorId, campaignId]
    );

    if (existing.rows.length === 0) {
      // Insert new session
      const sectionsJson = updates.sectionsViewed ? JSON.stringify(updates.sectionsViewed) : null;
      await pool.query(
        `INSERT INTO visitor_sessions
          (visitor_id, campaign_id, max_scroll_depth, time_on_page, sections_viewed, click_count,
           video_played, video_completed, device_type, converted, page_height, screen_width, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (visitor_id, campaign_id) DO NOTHING`,
        [
          visitorId,
          campaignId,
          updates.maxScrollDepth ?? 0,
          updates.timeOnPage ?? 0,
          sectionsJson,
          updates.clickCount ?? 0,
          updates.videoPlayed ?? false,
          updates.videoCompleted ?? false,
          updates.deviceType ?? null,
          updates.converted ?? false,
          updates.pageHeight ?? 0,
          updates.screenWidth ?? 0,
          now,
          now,
        ]
      );
    } else {
      const row = existing.rows[0];
      // Merge sections
      let mergedSections: string[] = [];
      try {
        mergedSections = row.sections_viewed ? JSON.parse(row.sections_viewed) : [];
      } catch { mergedSections = []; }
      if (updates.sectionsViewed) {
        for (const s of updates.sectionsViewed) {
          if (!mergedSections.includes(s)) mergedSections.push(s);
        }
      }
      await pool.query(
        `UPDATE visitor_sessions SET
          max_scroll_depth = GREATEST(max_scroll_depth, $3),
          time_on_page = GREATEST(time_on_page, $4),
          sections_viewed = $5,
          click_count = click_count + $6,
          video_played = video_played OR $7,
          video_completed = video_completed OR $8,
          device_type = COALESCE(device_type, $9),
          converted = converted OR $10,
          page_height = GREATEST(page_height, $11),
          screen_width = GREATEST(screen_width, $12),
          updated_at = $13
         WHERE visitor_id = $1 AND campaign_id = $2`,
        [
          visitorId,
          campaignId,
          updates.maxScrollDepth ?? row.max_scroll_depth,
          updates.timeOnPage ?? row.time_on_page,
          JSON.stringify(mergedSections),
          updates.clickCount ?? 0,
          updates.videoPlayed ?? false,
          updates.videoCompleted ?? false,
          updates.deviceType ?? null,
          updates.converted ?? false,
          updates.pageHeight ?? 0,
          updates.screenWidth ?? 0,
          now,
        ]
      );
    }
  }

  async getSessionsByCampaign(campaignId: number): Promise<VisitorSession[]> {
    const rows = await db.select().from(visitorSessions).where(eq(visitorSessions.campaignId, campaignId));
    return rows;
  }

  async getVisitorFeed(campaignId: number, limit: number = 20): Promise<any> {
    // Live Activity sources EVERY recorded sale from revenue_events — whether attributed
    // to a visitor or not. Any sale we saw (Stripe webhook, GHL poll, pixel convert)
    // must surface here. No data is ever dropped because it failed an attribution join.
    // If a sale has a matched visitor, we enrich with their variant/device info.
    // If it doesn't, we still show the sale with source, email, amount, and timestamp.
    const conversionsResult = await pool.query(
      `SELECT
        re.visitor_id as visitor_id,
        true as converted,
        re.created_at as converted_at,
        re.amount as revenue,
        v.user_agent,
        v.referrer,
        v.first_seen,
        COALESCE(re.customer_email, v.customer_email) as customer_email,
        COALESCE(v.traffic_source, 'direct') as traffic_source,
        re.source as sale_source,
        re.external_id,
        hv.text as headline_variant,
        hv.is_control as headline_is_control,
        hv.id as headline_variant_id,
        sv.text as subheadline_variant,
        sv.is_control as subheadline_is_control,
        vs.device_type,
        vs.max_scroll_depth,
        vs.time_on_page,
        vs.click_count,
        vs.sections_viewed,
        CASE WHEN v.id IS NULL THEN true ELSE false END as unattributed
       FROM revenue_events re
       LEFT JOIN visitors v ON v.id = re.visitor_id
       LEFT JOIN variants hv ON hv.id = v.headline_variant_id
       LEFT JOIN variants sv ON sv.id = v.subheadline_variant_id
       LEFT JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = re.campaign_id
       WHERE re.campaign_id = $1 AND re.event_type = 'purchase'
       ORDER BY re.created_at DESC
       LIMIT 10`,
      [campaignId]
    );

    // Get aggregate summary: total visitors, buyers, avg scroll for each.
    // total_buyers counts DISTINCT purchase events from revenue_events (plus any
    // converted visitors without events) so rejected/unattributed sales still count.
    const summaryResult = await pool.query(
      `SELECT
        COUNT(*) as total_visitors,
        GREATEST(
          COUNT(CASE WHEN v.converted = true THEN 1 END),
          (SELECT COUNT(*) FROM revenue_events
             WHERE campaign_id = $1 AND event_type = 'purchase' AND amount > 0)
        ) as total_buyers,
        ROUND(AVG(CASE WHEN v.converted = true THEN vs.max_scroll_depth END)) as buyer_avg_scroll,
        ROUND(AVG(CASE WHEN v.converted = false THEN vs.max_scroll_depth END)) as visitor_avg_scroll,
        ROUND(AVG(CASE WHEN v.converted = true THEN vs.time_on_page END)) as buyer_avg_time,
        ROUND(AVG(CASE WHEN v.converted = false THEN vs.time_on_page END)) as visitor_avg_time,
        ROUND(AVG(CASE WHEN v.converted = true THEN vs.click_count END)) as buyer_avg_clicks,
        ROUND(AVG(CASE WHEN v.converted = false THEN vs.click_count END)) as visitor_avg_clicks
       FROM visitors v
       LEFT JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = v.campaign_id
       WHERE v.campaign_id = $1`,
      [campaignId]
    );

    const summary = summaryResult.rows[0] || {};

    // Fetch total revenue from revenue_events (includes upsells, not just first purchase)
    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM revenue_events WHERE campaign_id = $1`,
      [campaignId]
    );
    const totalRevenue = parseFloat(revenueResult.rows[0]?.total) || 0;

    // For each conversion in the feed, sum all revenue_events for that visitor
    // so upsells are reflected in the individual conversion card.
    // Include BOTH visitor-matched events AND Stripe charges matched by email.
    const visitorRevenueResult = await pool.query(
      `SELECT visitor_id, SUM(amount) as total
       FROM revenue_events
       WHERE campaign_id = $1 AND visitor_id IS NOT NULL AND amount > 0
       GROUP BY visitor_id`,
      [campaignId]
    );
    const visitorRevMap: Record<string, number> = {};
    for (const row of visitorRevenueResult.rows) {
      visitorRevMap[row.visitor_id] = parseFloat(row.total) || 0;
    }

    // For conversions with $0, try to find Stripe charges by customer email
    const emailRevResult = await pool.query(
      `SELECT customer_email, SUM(amount) as total
       FROM revenue_events
       WHERE campaign_id = $1 AND amount > 0 AND customer_email IS NOT NULL AND customer_email != ''
       GROUP BY customer_email`,
      [campaignId]
    );
    const emailRevMap: Record<string, number> = {};
    for (const row of emailRevResult.rows) {
      emailRevMap[row.customer_email.toLowerCase()] = parseFloat(row.total) || 0;
    }

    const mapRow = (r: any) => {
      let device = r.device_type || "desktop";
      if (!r.device_type && r.user_agent) {
        const ua = r.user_agent.toLowerCase();
        if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) device = "mobile";
        else if (ua.includes("tablet") || ua.includes("ipad")) device = "tablet";
      }
      return {
        visitorId: r.visitor_id || r.external_id || 'unattributed',
        device,
        maxScrollDepth: parseInt(r.max_scroll_depth) || 0,
        timeOnPage: parseInt(r.time_on_page) || 0,
        clickCount: parseInt(r.click_count) || 0,
        sectionsViewed: r.sections_viewed ? (() => { try { return JSON.parse(r.sections_viewed); } catch { return []; } })() : [],
        converted: r.converted || false,
        convertedAt: r.converted_at || null,
        // Revenue: for rows sourced from revenue_events, r.revenue IS the event amount.
        // For visitor-sourced rows, fall back to aggregated map.
        revenue: (r.revenue != null && !isNaN(parseFloat(r.revenue))) ? parseFloat(r.revenue)
          : visitorRevMap[r.visitor_id]
          || (r.customer_email ? emailRevMap[r.customer_email.toLowerCase()] : 0)
          || 0,
        createdAt: r.first_seen,
        headlineVariant: r.headline_variant || null,
        headlineIsControl: r.headline_is_control || false,
        subheadlineVariant: r.subheadline_variant || null,
        subheadlineIsControl: r.subheadline_is_control || false,
        referrer: r.referrer || null,
        trafficSource: r.traffic_source || 'direct',
        customerEmail: r.customer_email || null,
        saleSource: r.sale_source || null,   // stripe_account, gohighlevel, pixel, whop, etc.
        unattributed: r.unattributed === true,
        externalId: r.external_id || null,
      };
    };

    // Recent visitors (all activity, not just conversions) — makes the feed feel live
    const recentVisitorsResult = await pool.query(
      `SELECT
        v.id as visitor_id,
        v.converted,
        v.converted_at,
        v.revenue,
        v.user_agent,
        v.referrer,
        v.first_seen,
        v.customer_email,
        COALESCE(v.traffic_source, 'direct') as traffic_source,
        hv.text as headline_variant,
        hv.is_control as headline_is_control,
        hv.id as headline_variant_id,
        sv.text as subheadline_variant,
        sv.is_control as subheadline_is_control,
        vs.device_type,
        vs.max_scroll_depth,
        vs.time_on_page,
        vs.click_count,
        vs.sections_viewed
       FROM visitors v
       LEFT JOIN variants hv ON hv.id = v.headline_variant_id
       LEFT JOIN variants sv ON sv.id = v.subheadline_variant_id
       LEFT JOIN visitor_sessions vs ON vs.visitor_id = v.id AND vs.campaign_id = v.campaign_id
       WHERE v.campaign_id = $1
       ORDER BY v.first_seen DESC
       LIMIT 15`,
      [campaignId]
    );

    return {
      recentConversions: conversionsResult.rows.map(mapRow),
      recentVisitors: recentVisitorsResult.rows.map(mapRow),
      summary: {
        totalVisitors: parseInt(summary.total_visitors) || 0,
        totalBuyers: parseInt(summary.total_buyers) || 0,
        totalRevenue, // from revenue_events — includes all upsells
        buyerAvgScroll: parseInt(summary.buyer_avg_scroll) || 0,
        visitorAvgScroll: parseInt(summary.visitor_avg_scroll) || 0,
        buyerAvgTime: parseInt(summary.buyer_avg_time) || 0,
        visitorAvgTime: parseInt(summary.visitor_avg_time) || 0,
        buyerAvgClicks: parseInt(summary.buyer_avg_clicks) || 0,
        visitorAvgClicks: parseInt(summary.visitor_avg_clicks) || 0,
      },
    };
  }

  async getSessionStats(campaignId: number): Promise<{
    avgScrollDepth: number;
    avgTimeOnPage: number;
    videoPlayRate: number;
    convertedAvgScroll: number;
    nonConvertedAvgScroll: number;
  }> {
    // visitor_sessions does NOT have a converted column — must join visitors
    const result = await pool.query(
      `SELECT
        AVG(vs.max_scroll_depth) as avg_scroll,
        AVG(vs.time_on_page) as avg_time,
        AVG(CASE WHEN vs.video_played THEN 1.0 ELSE 0.0 END) as video_rate,
        AVG(CASE WHEN v.converted = true THEN vs.max_scroll_depth END) as converted_scroll,
        AVG(CASE WHEN v.converted = false THEN vs.max_scroll_depth END) as non_converted_scroll
       FROM visitor_sessions vs
       JOIN visitors v ON v.id = vs.visitor_id
       WHERE vs.campaign_id = $1`,
      [campaignId]
    );
    const r = result.rows[0] || {};
    return {
      avgScrollDepth: parseFloat(r.avg_scroll) || 0,
      avgTimeOnPage: parseFloat(r.avg_time) || 0,
      videoPlayRate: parseFloat(r.video_rate) || 0,
      convertedAvgScroll: parseFloat(r.converted_scroll) || 0,
      nonConvertedAvgScroll: parseFloat(r.non_converted_scroll) || 0,
    };
  }
  // ===== Daily Observations =====
  async createObservation(data: InsertDailyObservation): Promise<DailyObservation> {
    const rows = await db.insert(dailyObservations).values({
      userId: data.userId,
      campaignId: data.campaignId,
      observation: data.observation,
      dataPoints: data.dataPoints ?? null,
      category: data.category,
    }).returning();
    return rows[0];
  }

  async getObservationsByCampaign(campaignId: number, limit = 30): Promise<DailyObservation[]> {
    const result = await pool.query(
      `SELECT * FROM daily_observations WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [campaignId, limit]
    );
    return result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      campaignId: r.campaign_id,
      observation: r.observation,
      dataPoints: r.data_points,
      category: r.category,
      creditsUsed: r.credits_used,
      createdAt: r.created_at,
    }));
  }

  async getLatestObservation(userId: number, campaignId: number): Promise<DailyObservation | undefined> {
    const result = await pool.query(
      `SELECT * FROM daily_observations WHERE user_id = $1 AND campaign_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [userId, campaignId]
    );
    if (!result.rows[0]) return undefined;
    const r = result.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      campaignId: r.campaign_id,
      observation: r.observation,
      dataPoints: r.data_points,
      category: r.category,
      creditsUsed: r.credits_used,
      createdAt: r.created_at,
    };
  }

  async getTodayObservationCount(userId: number): Promise<number> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM daily_observations WHERE user_id = $1 AND created_at >= $2`,
      [userId, today]
    );
    return parseInt(result.rows[0]?.count) || 0;
  }

  // ===== Dashboard Stats =====
  async getDashboardStats(userId: number): Promise<DashboardStats> {
    // Count active and archived campaigns
    const activeCampsResult = await pool.query(
      `SELECT COUNT(*) as count FROM campaigns WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const archivedCampsResult = await pool.query(
      `SELECT COUNT(*) as count FROM campaigns WHERE user_id = $1 AND status = 'archived'`,
      [userId]
    );
    const activeCampaigns = parseInt(activeCampsResult.rows[0]?.count) || 0;
    const archivedCampaigns = parseInt(archivedCampsResult.rows[0]?.count) || 0;

    // Get all campaign IDs for this user
    const campaignIdsResult = await pool.query(
      `SELECT id FROM campaigns WHERE user_id = $1`,
      [userId]
    );
    const campaignIds: number[] = campaignIdsResult.rows.map((r: any) => r.id);

    if (campaignIds.length === 0) {
      return {
        activeCampaigns,
        archivedCampaigns,
        testsCompleted: 0,
        testsWon: 0,
        testsLost: 0,
        winRate: 0,
        totalVisitors: 0,
        totalConversions: 0,
        totalRevenue: 0,
        projectedMonthlyGain: 0,
        recentWins: [],
        recentLosses: [],
      };
    }

    const idList = campaignIds.join(',');

    // Test lessons for this user's campaigns
    const lessonsResult = await pool.query(
      `SELECT tl.*, c.name as campaign_name FROM test_lessons tl
       JOIN campaigns c ON tl.campaign_id = c.id
       WHERE tl.campaign_id IN (${idList})
       ORDER BY tl.created_at DESC`
    );
    const lessons = lessonsResult.rows;
    const testsCompleted = lessons.length;

    // A "win" = liftPercent > 0 (challenger beat control)
    // A "loss" = liftPercent <= 0 (control was already best)
    const wins = lessons.filter((l: any) => l.lift_percent > 0);
    const losses = lessons.filter((l: any) => l.lift_percent <= 0);
    const testsWon = wins.length;
    const testsLost = losses.length;
    const winRate = testsCompleted > 0 ? (testsWon / testsCompleted) * 100 : 0;

    // Aggregate visitor/conversion/revenue stats. Conversions = distinct
    // buyer emails across all this user's campaigns (one buyer = one
    // conversion). Revenue sums all PURCHASE-type revenue events. Refunds
    // don't decrement here — the per-campaign view shows them separately.
    // (May 2026 dedupe — Tiffany incident.)
    const visitorStatsResult = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM visitors WHERE campaign_id IN (${idList})) AS total_visitors,
         (
           SELECT COUNT(*) FROM (
             SELECT COALESCE(NULLIF(LOWER(TRIM(customer_email)), ''), id) AS buyer_key
             FROM visitors
             WHERE campaign_id IN (${idList}) AND converted = true
             GROUP BY 1
           ) buyers
         ) AS total_conversions,
         COALESCE((
           SELECT SUM(amount) FROM revenue_events
           WHERE campaign_id IN (${idList}) AND event_type = 'purchase'
         ), 0) AS total_revenue`
    );
    const vs = visitorStatsResult.rows[0] || {};
    const totalVisitors = parseInt(vs.total_visitors) || 0;
    const totalConversions = parseInt(vs.total_conversions) || 0;
    const totalRevenue = parseFloat(vs.total_revenue) || 0;

    // Projected monthly gain: for each winning test, estimate lift × monthly traffic × avg revenue per conversion
    // We use the visitor data per campaign to estimate monthly traffic
    let projectedMonthlyGain = 0;
    if (wins.length > 0) {
      const avgRevenuePerConversion = totalConversions > 0 ? totalRevenue / totalConversions : 0;
      // 30-day traffic estimate per campaign
      const monthlyTrafficResult = await pool.query(
        `SELECT campaign_id, COUNT(*) as count FROM visitors
         WHERE campaign_id IN (${idList})
           AND first_seen >= (NOW() - INTERVAL '30 days')::text
         GROUP BY campaign_id`
      );
      const monthlyTrafficByCampaign: Record<number, number> = {};
      for (const row of monthlyTrafficResult.rows) {
        monthlyTrafficByCampaign[parseInt(row.campaign_id)] = parseInt(row.count) || 0;
      }

      for (const win of wins) {
        const liftFrac = (win.lift_percent || 0) / 100;
        const baseConvRate = win.loser_conversion_rate || 0;
        const monthlyTraffic = monthlyTrafficByCampaign[win.campaign_id] || 0;
        const additionalConversions = monthlyTraffic * baseConvRate * liftFrac;
        projectedMonthlyGain += additionalConversions * avgRevenuePerConversion;
      }
    }

    // Build recent wins/losses (last 10)
    const recentWins = wins.slice(0, 10).map((l: any) => ({
      campaignName: l.campaign_name,
      section: l.section_type,
      lift: parseFloat(l.lift_percent),
      date: (l.created_at || '').slice(0, 10),
    }));
    const recentLosses = losses.slice(0, 10).map((l: any) => ({
      campaignName: l.campaign_name,
      section: l.section_type,
      lift: parseFloat(l.lift_percent),
      date: (l.created_at || '').slice(0, 10),
    }));

    // Build active test snapshots — current status of each running test
    const activeTests: any[] = [];
    for (const campId of campaignIds) {
      const camp = await this.getCampaign(campId);
      if (!camp || camp.status !== 'active') continue;

      const sections = await this.getTestSectionsByCampaign(campId);
      const activeSections = sections.filter(s => s.isActive);
      if (activeSections.length === 0) continue;

      const variantStats = await this.getVariantStats(campId);

      for (const section of activeSections) {
        // Find variants for this section
        const sectionVars = variantStats.filter(v => {
          if (v.testSectionId === section.id) return true;
          if (!v.testSectionId && v.isControl && v.type === section.category) return true;
          return false;
        });
        const control = sectionVars.find(v => v.isControl);
        const challengers = sectionVars.filter(v => !v.isControl);
        if (!control || challengers.length === 0) continue;

        // Use the unified winner-math module so revenue-positive wins on a
        // $0-revenue control don't get lost (Tiffany incident, May 1 2026).
        const { pickWinner } = await import("./winner-math");
        const verdict = pickWinner(
          {
            variantId: control.variantId, isControl: true,
            impressions: control.impressions, conversions: control.conversions,
            revenue: control.revenue || 0,
            conversionRate: (control.conversionRate ?? 0) / 100, // stored as %, we want fraction
            revenuePerVisitor: (control.revenuePerVisitor ?? 0),
            confidence: (control.confidence ?? 0),
          },
          challengers.map(c => ({
            variantId: c.variantId, isControl: false,
            impressions: c.impressions, conversions: c.conversions,
            revenue: c.revenue || 0,
            conversionRate: (c.conversionRate ?? 0) / 100,
            revenuePerVisitor: (c.revenuePerVisitor ?? 0),
            confidence: (c.confidence ?? 0),
          }))
        );
        const bestChallenger = verdict.winnerVariantId
          ? (challengers.find(c => c.variantId === verdict.winnerVariantId) || challengers[0])
          : challengers.reduce((best, c) =>
              (c.conversionRate ?? 0) > (best.conversionRate ?? 0) ? c : best, challengers[0]);

        const totalVisitorsInTest = sectionVars.reduce((sum, v) => sum + v.impressions, 0);
        const controlCR = control.conversionRate ?? 0;
        const challengerCR = bestChallenger.conversionRate ?? 0;

        activeTests.push({
          campaignId: campId,
          campaignName: camp.name,
          sectionLabel: section.label,
          sectionCategory: section.category,
          visitors: totalVisitorsInTest,
          controlCR: Math.round(controlCR * 1000) / 10,
          challengerCR: Math.round(challengerCR * 1000) / 10,
          lift: Math.round(verdict.liftPercent * 10) / 10,
          // Surface the human-friendly lift label + basis so the dashboard can
          // render "$665 gained" or "+125% revenue" instead of just a number.
          liftDisplay: verdict.liftDisplay,
          liftBasis: verdict.liftBasis,
          confidence: Math.round(verdict.confidence ?? 0),
          status: verdict.shouldCelebrate ? 'winner' :
                  verdict.confidence >= 75 ? 'promising' :
                  totalVisitorsInTest < 50 ? 'collecting' : 'testing',
        });
      }
    }

    return {
      activeCampaigns,
      archivedCampaigns,
      testsCompleted,
      testsWon,
      testsLost,
      winRate: Math.round(winRate * 10) / 10,
      totalVisitors,
      totalConversions,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      projectedMonthlyGain: Math.round(projectedMonthlyGain * 100) / 100,
      recentWins,
      recentLosses,
      activeTests,
    };
  }
  // ===== Referrals =====
  async createReferral(data: InsertReferral): Promise<Referral> {
    const rows = await db.insert(referrals).values(data).returning();
    return rows[0];
  }

  async getReferralsByReferrer(userId: number): Promise<Referral[]> {
    return db.select().from(referrals).where(eq(referrals.referrerId, userId));
  }

  async getReferralByReferred(userId: number): Promise<Referral | undefined> {
    const rows = await db.select().from(referrals).where(eq(referrals.referredId, userId));
    return rows[0];
  }

  async getReferralStats(userId: number): Promise<ReferralStats> {
    const result = await pool.query(
      `SELECT
         COUNT(*) as total_referred,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_referrals,
         COALESCE(SUM(total_earned), 0) as total_earned
       FROM referrals
       WHERE referrer_id = $1`,
      [userId]
    );
    const r = result.rows[0] || {};
    return {
      totalReferred: parseInt(r.total_referred) || 0,
      activeReferrals: parseInt(r.active_referrals) || 0,
      totalEarned: parseFloat(r.total_earned) || 0,
      pendingEarnings: 0, // Will be used when Stripe Connect is added
    };
  }

  async updateReferralEarnings(referralId: number, amount: number): Promise<void> {
    await pool.query(
      `UPDATE referrals SET total_earned = total_earned + $1 WHERE id = $2`,
      [amount, referralId]
    );
  }

  // ===== Brain Knowledge =====
  async addBrainKnowledge(data: {
    knowledgeType: string;
    pageType?: string;
    niche?: string;
    sectionType?: string;
    originalText?: string;
    winningText?: string;
    liftPercent?: number;
    confidence?: number;
    sampleSize?: number;
    insight?: string;
    tags?: string;
    campaignId?: number;
    userId?: number;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO brain_knowledge
        (knowledge_type, page_type, niche, section_type, original_text, winning_text,
         lift_percent, confidence, sample_size, insight, tags, campaign_id, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        data.knowledgeType,
        data.pageType || null,
        data.niche || null,
        data.sectionType || null,
        data.originalText || null,
        data.winningText || null,
        data.liftPercent ?? null,
        data.confidence ?? null,
        data.sampleSize ?? null,
        data.insight || null,
        data.tags || null,
        data.campaignId ?? null,
        data.userId ?? null,
        new Date().toISOString(),
      ]
    );
  }

  async getBrainKnowledge(opts: { pageType?: string; sectionType?: string; limit?: number }): Promise<any[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (opts.pageType) {
      conditions.push(`page_type = $${idx++}`);
      params.push(opts.pageType);
    }
    if (opts.sectionType) {
      conditions.push(`section_type = $${idx++}`);
      params.push(opts.sectionType);
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const limit = opts.limit || 20;
    params.push(limit);

    const result = await pool.query(
      `SELECT knowledge_type, page_type, niche, section_type,
              original_text, winning_text, lift_percent, confidence,
              sample_size, insight, tags, created_at
       FROM brain_knowledge ${where}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      params
    );
    return result.rows;
  }

  // ===== Specialist Knowledge =====
  async addSpecialistKnowledge(data: {
    specialistRole: string;
    knowledgeType: string;
    pageType?: string;
    niche?: string;
    sectionType?: string;
    insight: string;
    winnerText?: string;
    loserText?: string;
    liftPercent?: number;
    sampleSize?: number;
    confidence?: number;
    campaignId?: number;
    userId?: number;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO specialist_knowledge
        (specialist_role, knowledge_type, page_type, niche, section_type, insight,
         winner_text, loser_text, lift_percent, sample_size, confidence,
         campaign_id, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        data.specialistRole,
        data.knowledgeType,
        data.pageType || null,
        data.niche || null,
        data.sectionType || null,
        data.insight,
        data.winnerText || null,
        data.loserText || null,
        data.liftPercent ?? null,
        data.sampleSize ?? null,
        data.confidence ?? null,
        data.campaignId ?? null,
        data.userId ?? null,
        new Date().toISOString(),
      ]
    );
  }

  async getSpecialistKnowledge(
    role: string,
    opts?: { pageType?: string; sectionType?: string; limit?: number }
  ): Promise<any[]> {
    const conditions: string[] = ['specialist_role = $1'];
    const params: any[] = [role];
    let idx = 2;

    // Prefer matching page_type and section_type, but don't require exact match
    // Use a scoring approach: exact match first, then general
    if (opts?.pageType) {
      conditions.push(`(page_type = $${idx} OR page_type IS NULL)`);
      params.push(opts.pageType);
      idx++;
    }
    if (opts?.sectionType) {
      conditions.push(`(section_type = $${idx} OR section_type IS NULL)`);
      params.push(opts.sectionType);
      idx++;
    }

    const limit = opts?.limit || 8;
    params.push(limit);

    const result = await pool.query(
      `SELECT specialist_role, knowledge_type, page_type, niche, section_type,
              insight, winner_text, loser_text, lift_percent, sample_size,
              confidence, created_at
       FROM specialist_knowledge
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE WHEN page_type IS NOT NULL AND section_type IS NOT NULL THEN 0
              WHEN section_type IS NOT NULL THEN 1
              WHEN page_type IS NOT NULL THEN 2
              ELSE 3 END,
         created_at DESC
       LIMIT $${idx}`,
      params
    );
    return result.rows;
  }

  // ===== Pixel Verification =====
  async updatePixelVerification(
    campaignId: number,
    field: "pixel" | "conversion_pixel",
    verified: boolean,
    url?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    if (field === "pixel") {
      await pool.query(
        `UPDATE campaigns SET pixel_verified = $1, pixel_verified_at = $2 WHERE id = $3`,
        [verified, verified ? now : null, campaignId]
      );
    } else {
      await pool.query(
        `UPDATE campaigns SET conversion_pixel_verified = $1, conversion_pixel_verified_at = $2, conversion_url = COALESCE($3, conversion_url) WHERE id = $4`,
        [verified, verified ? now : null, url || null, campaignId]
      );
    }
  }

  // ===== BYOK API Spend Tracking =====
  //
  // Records each user's estimated LLM API spend for the current month, so the
  // sidebar widget can show "You've spent $X on API calls this month" — and
  // the upgrade CTA can compare that to what the Brain plan would cost.
  //
  // Stored on users.byok_cost_usd_month + byok_calls_month. The month_key
  // (YYYY-MM) is used to auto-reset the counter when the month rolls over
  // — cheaper than a CRON, lazy-evaluated on the next call.
  async addBYOKSpend(userId: number, provider: string, costUsd: number, tokens: number): Promise<void> {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    await pool.query(
      `UPDATE users
         SET byok_cost_usd_month = CASE
               WHEN byok_cost_month_key IS DISTINCT FROM $2 THEN $3
               ELSE COALESCE(byok_cost_usd_month, 0) + $3
             END,
             byok_calls_month = CASE
               WHEN byok_cost_month_key IS DISTINCT FROM $2 THEN 1
               ELSE COALESCE(byok_calls_month, 0) + 1
             END,
             byok_cost_month_key = $2
       WHERE id = $1`,
      [userId, monthKey, costUsd]
    );
  }

  async getBYOKSpend(userId: number): Promise<{ monthKey: string; costUsd: number; calls: number }> {
    const r = await pool.query(
      `SELECT byok_cost_usd_month, byok_calls_month, byok_cost_month_key FROM users WHERE id = $1`,
      [userId]
    );
    const row = r.rows[0] || {};
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    // If the stored month is not the current month, return 0 — next call
    // will overwrite via addBYOKSpend.
    if (row.byok_cost_month_key !== currentMonthKey) {
      return { monthKey: currentMonthKey, costUsd: 0, calls: 0 };
    }
    return {
      monthKey: currentMonthKey,
      costUsd: parseFloat(row.byok_cost_usd_month) || 0,
      calls: parseInt(row.byok_calls_month) || 0,
    };
  }

  // ===== Revenue Events + LTV =====
  //
  // DEDUP STRATEGY (added Apr 27 — fixes Malik's C84 "conversions are
  // being double counted" report).
  //
  // The same Stripe purchase fires TWO events through different paths:
  //   1. Stripe webhook → source="stripe_webhook", external_id=pi_xxx
  //   2. Stripe account-poll → source="stripe_account", external_id=ch_xxx
  // Both events refer to the same purchase but have different external_ids
  // (PaymentIntent vs Charge), so the previous external_id-based dedup
  // didn't catch them. Plus, an on-page pixel fires when the buyer hits the
  // thank-you page — source="pixel", no external_id, no email — producing
  // a third event for the same purchase.
  //
  // We now do three checks before insert:
  //   1. Exact external_id match (catches webhook retries on the same path)
  //   2. Cross-source same-email same-amount within 5 minutes
  //      (catches webhook+account-poll for same Stripe purchase)
  //   3. Pixel-after-Stripe: if source=pixel and a Stripe event of same
  //      amount on this campaign exists in the last 5 minutes, skip
  //      (catches OTO/thank-you-page pixel firing after a Stripe purchase)
  //
  // Returns true if inserted, false if deduped.
  async addRevenueEvent(data: {
    visitorId?: string;
    campaignId: number;
    source: string;
    eventType: string;
    amount: number;
    currency?: string;
    externalId?: string;
    customerEmail?: string;
    metadata?: string;
  }): Promise<boolean> {
    // === DEDUP CHECK 1: exact external_id match ===
    if (data.externalId) {
      const exact = await pool.query(
        `SELECT id FROM revenue_events
           WHERE campaign_id = $1 AND external_id = $2
           LIMIT 1`,
        [data.campaignId, data.externalId]
      );
      if (exact.rows.length > 0) {
        console.log(`[revenue dedup] external_id ${data.externalId} already recorded; skipping ${data.source}`);
        return false;
      }
    }

    // === DEDUP CHECK 2: cross-source by email + amount + time window ===
    // Catches stripe_webhook (pi_xxx) + stripe_account (ch_xxx) for the
    // same purchase. We only do this for revenue events that have an email
    // — pixel events without email are handled by check #3.
    if (data.customerEmail && data.amount > 0) {
      const crossSource = await pool.query(
        `SELECT id, source, external_id FROM revenue_events
           WHERE campaign_id = $1
             AND customer_email = $2
             AND amount = $3
             AND event_type = $4
             AND created_at::timestamptz > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
        [data.campaignId, data.customerEmail, data.amount, data.eventType]
      );
      if (crossSource.rows.length > 0) {
        const dup = crossSource.rows[0];
        console.log(`[revenue dedup] cross-source dup: ${data.source} ${data.externalId} matches ${dup.source} ${dup.external_id} (same email/amount within 5min); skipping`);
        return false;
      }
    }

    // === DEDUP CHECK 3: pixel after Stripe ===
    // Pixel events have no external_id and often no email. If a Stripe
    // event of the same amount on this campaign was just recorded, the
    // pixel is reporting on the same purchase — skip the pixel.
    if (data.source === "pixel" && data.amount > 0) {
      const stripeRecent = await pool.query(
        `SELECT id FROM revenue_events
           WHERE campaign_id = $1
             AND amount = $2
             AND event_type = $3
             AND source IN ('stripe_webhook','stripe_account','whop')
             AND created_at::timestamptz > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
        [data.campaignId, data.amount, data.eventType]
      );
      if (stripeRecent.rows.length > 0) {
        console.log(`[revenue dedup] pixel event suppressed — Stripe recorded same amount $${data.amount} in last 5min on C${data.campaignId}`);
        return false;
      }
    }

    await pool.query(
      `INSERT INTO revenue_events
        (visitor_id, campaign_id, source, event_type, amount, currency, external_id, customer_email, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        data.visitorId || null,
        data.campaignId,
        data.source,
        data.eventType,
        data.amount,
        data.currency || 'USD',
        data.externalId || null,
        data.customerEmail || null,
        data.metadata || null,
        new Date().toISOString(),
      ]
    );
    return true;
  }

  async getRevenueEventsByVisitor(visitorId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM revenue_events WHERE visitor_id = $1 ORDER BY created_at DESC`,
      [visitorId]
    );
    return result.rows;
  }

  async getLTVByCampaign(campaignId: number): Promise<{
    totalRevenue: number;
    totalTransactions: number;
    averageLTV: number;
    revenueBySource: Record<string, number>;
    ltv30Day: number;
    ltv90Day: number;
  }> {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const totalResult = await pool.query(
      `SELECT
         COALESCE(SUM(amount), 0) AS total_revenue,
         COUNT(*) AS total_transactions
       FROM revenue_events
       WHERE campaign_id = $1 AND event_type != 'refund'`,
      [campaignId]
    );

    const sourceResult = await pool.query(
      `SELECT source, COALESCE(SUM(amount), 0) AS revenue
       FROM revenue_events
       WHERE campaign_id = $1 AND event_type != 'refund'
       GROUP BY source`,
      [campaignId]
    );

    // Count distinct customers (by visitor_id or customer_email) for average LTV
    const customerResult = await pool.query(
      `SELECT COUNT(DISTINCT COALESCE(visitor_id, customer_email)) AS customer_count
       FROM revenue_events
       WHERE campaign_id = $1 AND event_type != 'refund'`,
      [campaignId]
    );

    const ltv30Result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue,
              COUNT(DISTINCT COALESCE(visitor_id, customer_email)) AS customers
       FROM revenue_events
       WHERE campaign_id = $1 AND event_type != 'refund' AND created_at >= $2`,
      [campaignId, d30]
    );

    const ltv90Result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue,
              COUNT(DISTINCT COALESCE(visitor_id, customer_email)) AS customers
       FROM revenue_events
       WHERE campaign_id = $1 AND event_type != 'refund' AND created_at >= $2`,
      [campaignId, d90]
    );

    const totalRevenue = parseFloat(totalResult.rows[0]?.total_revenue) || 0;
    const totalTransactions = parseInt(totalResult.rows[0]?.total_transactions) || 0;
    const customerCount = parseInt(customerResult.rows[0]?.customer_count) || 1;
    const averageLTV = totalRevenue / customerCount;

    const ltv30Customers = parseInt(ltv30Result.rows[0]?.customers) || 1;
    const ltv30Revenue = parseFloat(ltv30Result.rows[0]?.revenue) || 0;
    const ltv30Day = ltv30Revenue / ltv30Customers;

    const ltv90Customers = parseInt(ltv90Result.rows[0]?.customers) || 1;
    const ltv90Revenue = parseFloat(ltv90Result.rows[0]?.revenue) || 0;
    const ltv90Day = ltv90Revenue / ltv90Customers;

    const revenueBySource: Record<string, number> = {};
    for (const row of sourceResult.rows) {
      revenueBySource[row.source] = parseFloat(row.revenue) || 0;
    }

    return {
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalTransactions,
      averageLTV: parseFloat(averageLTV.toFixed(2)),
      revenueBySource,
      ltv30Day: parseFloat(ltv30Day.toFixed(2)),
      ltv90Day: parseFloat(ltv90Day.toFixed(2)),
    };
  }
  // ===== Traffic Anomalies =====
  async createAnomaly(data: {
    campaignId: number;
    anomalyType: string;
    source: string | null;
    title: string;
    description: string;
    severity: string;
    metricValue: number | null;
    baselineValue: number | null;
  }): Promise<any> {
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO traffic_anomalies
        (campaign_id, anomaly_type, source, title, description, severity, metric_value, baseline_value, is_read, detected_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $9)
       RETURNING *`,
      [data.campaignId, data.anomalyType, data.source, data.title, data.description,
       data.severity, data.metricValue, data.baselineValue, now]
    );
    return result.rows[0];
  }

  async getUnreadAnomalies(campaignId: number): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM traffic_anomalies WHERE campaign_id = $1 AND is_read = false ORDER BY created_at DESC`,
      [campaignId]
    );
    return result.rows;
  }

  async getAllAnomalies(campaignId: number, limit: number = 20): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM traffic_anomalies WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [campaignId, limit]
    );
    return result.rows;
  }

  async getUnreadAnomalyCount(campaignId: number): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as cnt FROM traffic_anomalies WHERE campaign_id = $1 AND is_read = false`,
      [campaignId]
    );
    return parseInt(result.rows[0]?.cnt) || 0;
  }

  async getUnreadAnomalyCountsByUser(userId: number): Promise<Record<number, number>> {
    const result = await pool.query(
      `SELECT ta.campaign_id, COUNT(*) as cnt
       FROM traffic_anomalies ta
       JOIN campaigns c ON c.id = ta.campaign_id
       WHERE c.user_id = $1 AND ta.is_read = false
       GROUP BY ta.campaign_id`,
      [userId]
    );
    const counts: Record<number, number> = {};
    for (const row of result.rows) {
      counts[row.campaign_id] = parseInt(row.cnt) || 0;
    }
    return counts;
  }

  async markAnomalyRead(anomalyId: number): Promise<void> {
    await pool.query(
      `UPDATE traffic_anomalies SET is_read = true WHERE id = $1`,
      [anomalyId]
    );
  }

  async markAllAnomaliesRead(campaignId: number): Promise<void> {
    await pool.query(
      `UPDATE traffic_anomalies SET is_read = true WHERE campaign_id = $1`,
      [campaignId]
    );
  }

  async checkRecentAnomaly(campaignId: number, anomalyType: string, source: string | null, sinceDate: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM traffic_anomalies
       WHERE campaign_id = $1 AND anomaly_type = $2 AND (source = $3 OR ($3 IS NULL AND source IS NULL))
         AND created_at >= $4
       LIMIT 1`,
      [campaignId, anomalyType, source, sinceDate]
    );
    return result.rows.length > 0;
  }
}

export const storage = new StorageImpl();
