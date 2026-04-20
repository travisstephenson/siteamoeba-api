import { pgTable, text, integer, serial, boolean, real, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============== USERS ==============
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  // Stripe
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Plan: 'free' | 'starter' | 'growth' | 'scale'
  plan: text("plan").notNull().default("free"),
  // Credits — 1 credit = 100 visitors tracked
  creditsUsed: integer("credits_used").notNull().default(0),
  creditsLimit: integer("credits_limit").notNull().default(10), // free = 1,000 visitors (10 credits)
  // Campaign limits
  campaignsLimit: integer("campaigns_limit").notNull().default(1),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  // AI / LLM configuration (BYOK)
  llmProvider: text("llm_provider"),
  llmApiKey: text("llm_api_key"),
  llmModel: text("llm_model"),
  // Statistical significance settings
  minVisitorsPerVariant: integer("min_visitors_per_variant").notNull().default(100),
  winConfidenceThreshold: integer("win_confidence_threshold").notNull().default(95),
  // Credit overage
  allowOverage: boolean("allow_overage").notNull().default(false),
  overageCreditsUsed: integer("overage_credits_used").notNull().default(0),
  // Concurrent test limit
  concurrentTestLimit: integer("concurrent_test_limit").notNull().default(1),
  // Referral
  referralCode: text("referral_code"),
  referredBy: integer("referred_by"),
  isAdmin: integer("is_admin").default(0), // 1 = admin, 0 = regular user
  trialEndsAt: text("trial_ends_at"), // ISO date string, null = not on trial
  adminNotes: text("admin_notes_user"), // internal notes about this user
  accountStatus: text("account_status").default("active"), // active, suspended, cancelled
  // Stripe account-level connection
  stripeAccountId: text("stripe_account_id"),
  stripeAccessToken: text("stripe_access_token"),
  stripeConnectedAt: text("stripe_connected_at"),
  ghlLocationId: text("ghl_location_id"),
  ghlApiKey: text("ghl_api_key"),
  ghlConnectedAt: text("ghl_connected_at"),
  ghlLocationName: text("ghl_location_name"),
  // User-level integrations
  webhookSecret: text("webhook_secret"),
  shopifyStoreUrl: text("shopify_store_url"),
  shopifyConnectedAt: text("shopify_connected_at"),
  // Whop integration
  whopApiKey: text("whop_api_key"),
  whopConnectedAt: text("whop_connected_at"),
  // Onboarding metrics
  firstTestEnabledAt: text("first_test_enabled_at"), // ISO string — when user activated their first test section
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  plan: true,
  creditsUsed: true,
  creditsLimit: true,
  campaignsLimit: true,
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ============== CAMPAIGNS ==============
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(), // The page being tested
  // CSS selectors for the page elements
  headlineSelector: text("headline_selector"),
  subheadlineSelector: text("subheadline_selector"),
  // Page context classification (set during page scan)
  pageType: text("page_type"), // sales_page, opt_in_page, product_page, webinar_registration, checkout_page, landing_page
  pageGoal: text("page_goal"), // direct_purchase, lead_capture, webinar_signup, free_trial, demo_request
  pricePoint: text("price_point"), // product price if applicable
  niche: text("niche"), // auto-detected from page scan
  pageFacts: text("page_facts"), // verified facts: testimonials, numbers, credentials — AI uses ONLY these for social proof variants
  // Status
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("active"), // 'active' | 'archived' | 'completed'
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  // Campaign type
  campaignType: text("campaign_type").notNull().default("purchase"), // 'purchase' | 'lead_gen'
  // Autopilot
  autopilotEnabled: boolean("autopilot_enabled").notNull().default(false),
  autopilotStep: integer("autopilot_step").notNull().default(0),
  autopilotStatus: text("autopilot_status").default("idle"), // idle, testing, evaluating, advancing, paused, completed
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

// ============== VARIANTS ==============
export const variants = pgTable("variants", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  type: text("type").notNull(), // 'headline' | 'subheadline' | any section category
  text: text("text").notNull(),
  isControl: boolean("is_control").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  // Persuasion tags — JSON array stored as text, e.g. ["curiosity_gap"]
  persuasionTags: text("persuasion_tags"),
  // Link to a test_section (nullable for backward compat)
  testSectionId: integer("test_section_id"),
  // Display validation — set when the widget detects this variant is rendering incorrectly
  displayIssue: boolean("display_issue").default(false),
  displayIssueReason: text("display_issue_reason"),
  displayIssueAt: text("display_issue_at"),
  // Visual editor mutations — JSON describing element targeting and style overrides
  mutations: text("mutations"),
});

export const insertVariantSchema = createInsertSchema(variants).omit({
  id: true,
  createdAt: true,
});

export type Variant = typeof variants.$inferSelect;
export type InsertVariant = z.infer<typeof insertVariantSchema>;

// ============== TEST SECTIONS ==============
export const testSections = pgTable("test_sections", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  sectionId: text("section_id").notNull(), // e.g. "hero-headline"
  label: text("label").notNull(), // e.g. "Hero Headline"
  purpose: text("purpose"), // sales psychology purpose
  selector: text("selector").notNull(), // CSS selector
  category: text("category").notNull(), // headline, cta, social_proof, etc.
  currentText: text("current_text"), // original text from the page
  testPriority: integer("test_priority").notNull().default(1),
  // Percentage of incoming traffic that enters this test (1-100). Default 100.
  // E.g. 20 = 20% see a random variant, 80% see control (original page untouched).
  trafficPercentage: integer("traffic_percentage").default(50), // % of visitors who see a challenger (not control)
  isActive: boolean("is_active").notNull().default(false),
  // Test method: "text_swap" | "visibility_toggle" | "reorder" | "not_testable"
  testMethod: text("test_method").notNull().default("text_swap"),
  // Captured CSS properties from the live page (JSON string) — used for styled preview cards
  elementStyles: text("element_styles"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertTestSectionSchema = createInsertSchema(testSections).omit({
  id: true,
  createdAt: true,
});

export type TestSection = typeof testSections.$inferSelect;
export type InsertTestSection = z.infer<typeof insertTestSectionSchema>;

// ============== VISITORS ==============
export const visitors = pgTable("visitors", {
  id: text("id").primaryKey(), // uuid from widget
  campaignId: integer("campaign_id").notNull(),
  headlineVariantId: integer("headline_variant_id").notNull(),
  subheadlineVariantId: integer("subheadline_variant_id").notNull(),
  converted: boolean("converted").notNull().default(false),
  convertedAt: text("converted_at"),
  stripePaymentId: text("stripe_payment_id"),
  revenue: real("revenue"),
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  trafficSource: text("traffic_source"),
  deviceCategory: text("device_category"),
  // JSON map of section test assignments: {"sectionId": variantId, ...}
  // Tracks which variant was shown for each active test section beyond headline/subheadline
  sectionVariantAssignments: text("section_variant_assignments"),
  fingerprint: text("fingerprint"),
  customerEmail: text("customer_email"),
  firstSeen: text("first_seen").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertVisitorSchema = createInsertSchema(visitors).omit({
  firstSeen: true,
});

export type Visitor = typeof visitors.$inferSelect;
export type InsertVisitor = z.infer<typeof insertVisitorSchema>;

// ============== IMPRESSIONS ==============
export const impressions = pgTable("impressions", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  headlineVariantId: integer("headline_variant_id").notNull(),
  subheadlineVariantId: integer("subheadline_variant_id").notNull(),
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertImpressionSchema = createInsertSchema(impressions).omit({
  id: true,
  createdAt: true,
});

export type Impression = typeof impressions.$inferSelect;
export type InsertImpression = z.infer<typeof insertImpressionSchema>;

// ============== TEST LESSONS ==============
export const testLessons = pgTable("test_lessons", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  sectionType: text("section_type").notNull(), // headline, cta, guarantee, etc.
  pageType: text("page_type"), // sales_page, opt_in_page, etc.
  niche: text("niche"),
  pricePoint: text("price_point"),
  winnerText: text("winner_text").notNull(),
  loserText: text("loser_text").notNull(),
  winnerConversionRate: real("winner_conversion_rate").notNull(),
  loserConversionRate: real("loser_conversion_rate").notNull(),
  liftPercent: real("lift_percent").notNull(),
  winnerStrategy: text("winner_strategy"), // persuasion tags
  loserStrategy: text("loser_strategy"),
  sampleSize: integer("sample_size").notNull(),
  confidence: real("confidence").notNull(),
  // What the Brain learned from this test
  lesson: text("lesson"), // LLM-generated summary of what was learned
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertTestLessonSchema = createInsertSchema(testLessons).omit({
  id: true,
  createdAt: true,
});

export type TestLesson = typeof testLessons.$inferSelect;
export type InsertTestLesson = z.infer<typeof insertTestLessonSchema>;

// ============== FEEDBACK ==============
export const funnelSteps = pgTable("funnel_steps", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  stepOrder: integer("step_order").notNull().default(1),
  name: text("name").notNull(),
  price: text("price").notNull().default("0"),
  stepType: text("step_type").notNull().default("front_end"), // front_end, order_bump, upsell, downsell, recurring
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export type FunnelStep = typeof funnelSteps.$inferSelect;

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(), // bug, feature_request, brain_quality, other
  message: text("message").notNull(),
  status: text("status").notNull().default("new"), // new, reviewed, planned, resolved, declined
  adminNotes: text("admin_notes"),
  adminResponse: text("admin_response"), // visible reply shown to the user
  respondedAt: text("responded_at"), // when the admin responded
  responseRead: boolean("response_read").notNull().default(false), // has the user seen the response
  campaignId: integer("campaign_id"), // optional, if feedback relates to a specific campaign
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  status: true,
  adminNotes: true,
  createdAt: true,
});

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;

// ============== BEHAVIORAL EVENTS ==============
export const behavioralEvents = pgTable("behavioral_events", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  eventType: text("event_type").notNull(), // scroll, section_view, click, video_play, video_complete, page_exit
  eventData: text("event_data"), // JSON string with event-specific data
  timestamp: text("timestamp").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertBehavioralEventSchema = createInsertSchema(behavioralEvents).omit({
  id: true,
});

export type BehavioralEvent = typeof behavioralEvents.$inferSelect;
export type InsertBehavioralEvent = z.infer<typeof insertBehavioralEventSchema>;

// ============== VISITOR SESSIONS ==============
export const visitorSessions = pgTable("visitor_sessions", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  // Aggregated session data (updated as events come in)
  maxScrollDepth: integer("max_scroll_depth").notNull().default(0), // 0-100 percentage
  timeOnPage: integer("time_on_page").notNull().default(0), // seconds
  sectionsViewed: text("sections_viewed"), // JSON array of section IDs seen
  clickCount: integer("click_count").notNull().default(0),
  videoPlayed: boolean("video_played").notNull().default(false),
  videoCompleted: boolean("video_completed").notNull().default(false),
  deviceType: text("device_type"), // mobile, tablet, desktop
  converted: boolean("converted").notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertVisitorSessionSchema = createInsertSchema(visitorSessions).omit({
  id: true,
});

export type VisitorSession = typeof visitorSessions.$inferSelect;
export type InsertVisitorSession = z.infer<typeof insertVisitorSessionSchema>;

// ============== DAILY OBSERVATIONS ==============
export const dailyObservations = pgTable("daily_observations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  observation: text("observation").notNull(), // the insight text (markdown)
  dataPoints: text("data_points"), // JSON: the raw numbers that support the insight
  category: text("category").notNull(), // scroll_behavior, conversion_pattern, section_engagement, traffic_quality, test_performance
  creditsUsed: integer("credits_used").notNull().default(1),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertDailyObservationSchema = createInsertSchema(dailyObservations).omit({
  id: true,
  createdAt: true,
  creditsUsed: true,
});

export type DailyObservation = typeof dailyObservations.$inferSelect;
export type InsertDailyObservation = z.infer<typeof insertDailyObservationSchema>;

// ============== REFERRALS ==============
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull(), // the user who referred
  referredId: integer("referred_id").notNull(), // the user who signed up
  referralCode: text("referral_code").notNull(), // the code used
  status: text("status").notNull().default("active"), // active, expired (after 1 year)
  commissionRate: real("commission_rate").notNull().default(0.20), // 20%
  totalEarned: real("total_earned").notNull().default(0),
  expiresAt: text("expires_at").notNull(), // 1 year from creation
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
});

export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;

// ============== CLIENT ERROR LOGS ==============
export const clientErrors = pgTable("client_errors", {
  id: serial("id").primaryKey(),
  message: text("message"),
  stack: text("stack"),
  componentStack: text("component_stack"),
  errorType: text("error_type"), // 'boundary' | 'unhandledrejection' | 'window.onerror'
  url: text("url"),
  userId: integer("user_id"),
  userEmail: text("user_email"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ============== AUTH SCHEMAS (not DB tables) ==============
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  referralCode: z.string().optional(),
});
