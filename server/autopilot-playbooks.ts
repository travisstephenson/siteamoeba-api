/**
 * autopilot-playbooks.ts
 *
 * Defines the optimization sequence for each page type.
 * Each playbook specifies which sections to test in what order
 * and what the Brain should focus on for each section.
 */

export interface PlaybookStep {
  sectionCategory: string; // headline, subheadline, cta, guarantee, etc.
  priority: number;
  focusAreas: string; // what to optimize for this section
  minSampleSize: number; // minimum visitors before auto-declaring
}

const SALES_PAGE_PLAYBOOK: PlaybookStep[] = [
  {
    sectionCategory: "headline",
    priority: 1,
    focusAreas: "Test pattern interrupt, specificity, curiosity. Highest impact element.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "subheadline",
    priority: 2,
    focusAreas: "Test objection removal, qualification, promise expansion.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "cta",
    priority: 3,
    focusAreas: "Test action verbs, urgency, first-person framing.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "social_proof",
    priority: 4,
    focusAreas: "Test specificity of results, quantity, placement.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "guarantee",
    priority: 5,
    focusAreas: "Test strength, timeframe, conditional vs unconditional.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "pricing",
    priority: 6,
    focusAreas: "Test anchoring, per-unit framing, urgency.",
    minSampleSize: 400,
  },
  {
    sectionCategory: "product_stack",
    priority: 7,
    focusAreas: "Test value framing, feature vs benefit language.",
    minSampleSize: 400,
  },
  {
    sectionCategory: "body_copy",
    priority: 8,
    focusAreas: "Test persuasion frameworks, emotional triggers, story elements.",
    minSampleSize: 400,
  },
  {
    sectionCategory: "bonus",
    priority: 9,
    focusAreas: "Test exclusivity, value anchoring, urgency.",
    minSampleSize: 400,
  },
  {
    sectionCategory: "faq",
    priority: 10,
    focusAreas: "Test objection reframing, answer length, tone.",
    minSampleSize: 400,
  },
];

const OPT_IN_PAGE_PLAYBOOK: PlaybookStep[] = [
  {
    sectionCategory: "headline",
    priority: 1,
    focusAreas: "Test clarity of value proposition, specificity of the free offer.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "subheadline",
    priority: 2,
    focusAreas: "Test what they'll get, how fast, how easy.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "cta",
    priority: 3,
    focusAreas: "Test 'Get Free Access' vs 'Download Now' vs 'Send Me The Guide'.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "social_proof",
    priority: 4,
    focusAreas: "Test subscriber count, testimonials about the free resource.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "body_copy",
    priority: 5,
    focusAreas: "Test bullet points of what's included.",
    minSampleSize: 300,
  },
];

const WEBINAR_REGISTRATION_PLAYBOOK: PlaybookStep[] = [
  {
    sectionCategory: "headline",
    priority: 1,
    focusAreas: "Test what they'll learn, transformation promise.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "subheadline",
    priority: 2,
    focusAreas: "Test authority, exclusivity, date urgency.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "cta",
    priority: 3,
    focusAreas: "Test 'Reserve My Spot' vs 'Register Now' vs 'Save My Seat'.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "social_proof",
    priority: 4,
    focusAreas: "Test attendee count, past results.",
    minSampleSize: 300,
  },
];

const PRODUCT_PAGE_PLAYBOOK: PlaybookStep[] = [
  {
    sectionCategory: "headline",
    priority: 1,
    focusAreas: "Test product name framing, key benefit.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "body_copy",
    priority: 2,
    focusAreas: "Test product description, feature vs benefit.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "social_proof",
    priority: 3,
    focusAreas: "Test review highlights, star ratings, user photos.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "cta",
    priority: 4,
    focusAreas: "Test 'Add to Cart' vs 'Buy Now' vs 'Get Yours'.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "pricing",
    priority: 5,
    focusAreas: "Test price display, comparison, bundle offers.",
    minSampleSize: 400,
  },
];

const SAAS_PAGE_PLAYBOOK: PlaybookStep[] = [
  {
    sectionCategory: "headline",
    priority: 1,
    focusAreas: "Test value proposition clarity, outcome focus.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "subheadline",
    priority: 2,
    focusAreas: "Test how it works, speed to value.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "cta",
    priority: 3,
    focusAreas: "Test 'Start Free Trial' vs 'See Demo' vs 'Get Started Free'.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "social_proof",
    priority: 4,
    focusAreas: "Test logos, case studies, metrics.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "pricing",
    priority: 5,
    focusAreas: "Test plan comparison, highlighted plan, annual vs monthly.",
    minSampleSize: 400,
  },
  {
    sectionCategory: "faq",
    priority: 6,
    focusAreas: "Test common objections: security, integration, support.",
    minSampleSize: 400,
  },
];

const LANDING_PAGE_PLAYBOOK: PlaybookStep[] = [
  {
    sectionCategory: "headline",
    priority: 1,
    focusAreas: "Test clarity, specificity, and immediate value signal.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "subheadline",
    priority: 2,
    focusAreas: "Test supporting claim, proof statement, qualification.",
    minSampleSize: 200,
  },
  {
    sectionCategory: "cta",
    priority: 3,
    focusAreas: "Test action verb, benefit framing, urgency.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "body_copy",
    priority: 4,
    focusAreas: "Test value proposition expansion, bullet points.",
    minSampleSize: 300,
  },
  {
    sectionCategory: "social_proof",
    priority: 5,
    focusAreas: "Test testimonials, logos, counts.",
    minSampleSize: 300,
  },
];

const PLAYBOOK_MAP: Record<string, PlaybookStep[]> = {
  sales_page: SALES_PAGE_PLAYBOOK,
  opt_in_page: OPT_IN_PAGE_PLAYBOOK,
  webinar_registration: WEBINAR_REGISTRATION_PLAYBOOK,
  product_page: PRODUCT_PAGE_PLAYBOOK,
  ecommerce_page: PRODUCT_PAGE_PLAYBOOK,
  saas_page: SAAS_PAGE_PLAYBOOK,
  landing_page: LANDING_PAGE_PLAYBOOK,
};

/**
 * Returns the playbook for a given page type.
 * Falls back to the generic landing page playbook for unknown types.
 */
export function getPlaybook(pageType: string): PlaybookStep[] {
  return PLAYBOOK_MAP[pageType] || LANDING_PAGE_PLAYBOOK;
}
