/**
 * Winner math \u2014 the single source of truth for "did a variant beat its control?"
 *
 * Built May 1 2026. Tiffany's $665.60 challenger vs $0 control NEVER triggered
 * the platform's winner UI because lift = (winner - control) / control \u2192 divide
 * by zero. CVR was also stuck (control had 1.4%, challenger 3.4% \u2014 close enough
 * to feel statistically inconclusive at small sample sizes).
 *
 * Key insight: when the user is paying us for a CRO product, the most important
 * "win" metric is REVENUE. Anyone who makes their first paying customer through
 * a tested variant should be celebrated, even if the math doesn't get to 95%
 * confidence on a pure CVR comparison.
 *
 * This module is referenced everywhere lift/winner math runs so the behavior is
 * uniform across the autopilot, the dashboard active-tests panel, the brain
 * sync, and the winner-detection cron.
 */

export interface VariantPerformance {
  variantId: number;
  isControl: boolean;
  impressions: number;
  conversions: number;
  revenue: number;
  conversionRate: number; // 0..1
  revenuePerVisitor: number;
  confidence: number;     // 0..100, statistical confidence of CVR test
}

export interface WinnerVerdict {
  hasWinner: boolean;
  winnerVariantId: number | null;
  // Lift computed using the BEST AVAILABLE measure:
  //   - if both control + challenger have revenue: revenue lift %
  //   - else if control has CVR: CVR lift %
  //   - else if control has $0 but challenger has paid revenue: "infinite" lift (we cap and label)
  liftPercent: number;
  liftBasis: "revenue" | "cvr" | "first_revenue";
  // The label we show in the UI \u2014 e.g. "+125%", "$665 gained", "First revenue"
  liftDisplay: string;
  // Confidence level \u2014 reuses CVR confidence for cvr basis. For revenue basis we
  // synthesize: if both sides have \u2265 5 conversions and rev lift > 50%, treat as
  // 90%. If the challenger generated paid revenue while control made $0 with
  // \u226550 visitors on each side, we treat that as 95%+ (the customer made money;
  // the platform should celebrate it).
  confidence: number;
  // Why the platform decided this is/isn't a winner. Useful for the UI tooltip.
  reason: string;
  // Whether the win is large enough to merit showing the user a "you won!" UI
  // celebration. (95% confidence OR \u2265 50 visitors per side AND first revenue.)
  shouldCelebrate: boolean;
}

/**
 * Decide if a challenger has beaten a control. Pass perf rows for both.
 *
 * Tunables: tweak these later if too generous / too strict.
 */
const MIN_VISITORS_PER_SIDE_FOR_REVENUE_WIN = 50;
const MIN_PAID_CONVERSIONS_FOR_REVENUE_WIN = 1;
const MIN_REVENUE_FOR_FIRST_REVENUE_WIN = 50; // dollars
const CVR_CONFIDENCE_TO_CELEBRATE = 90;

export function pickWinner(
  control: VariantPerformance | null,
  challengers: VariantPerformance[]
): WinnerVerdict {
  if (!control || challengers.length === 0) {
    return blank("No control or no challengers");
  }

  // Pick the strongest challenger by EITHER revenue OR CVR \u2014 whichever the
  // current best is, that's our representative.
  const best = pickBestChallenger(challengers);
  if (!best) return blank("No viable challenger");

  // === CASE 1: First-revenue win ===
  // Control has $0 revenue (no paid conversions yet) but challenger has at
  // least one paid conversion + meaningful revenue + enough visitors on both
  // sides to be confident this isn't just luck.
  if (
    control.revenue <= 0 &&
    best.revenue >= MIN_REVENUE_FOR_FIRST_REVENUE_WIN &&
    best.conversions >= MIN_PAID_CONVERSIONS_FOR_REVENUE_WIN &&
    best.impressions >= MIN_VISITORS_PER_SIDE_FOR_REVENUE_WIN &&
    control.impressions >= MIN_VISITORS_PER_SIDE_FOR_REVENUE_WIN
  ) {
    return {
      hasWinner: true,
      winnerVariantId: best.variantId,
      liftPercent: 9999, // sentinel \u2014 callers should use liftDisplay for UI
      liftBasis: "first_revenue",
      liftDisplay: `$${best.revenue.toFixed(2)} gained`,
      confidence: 95,
      reason: `Control made $0 over ${control.impressions} visitors. Challenger made $${best.revenue.toFixed(2)} over ${best.impressions} visitors. Real money is the strongest signal.`,
      shouldCelebrate: true,
    };
  }

  // === CASE 2: Revenue lift (both sides have revenue) ===
  if (
    control.revenue > 0 &&
    best.revenue > control.revenue &&
    best.impressions >= MIN_VISITORS_PER_SIDE_FOR_REVENUE_WIN &&
    control.impressions >= MIN_VISITORS_PER_SIDE_FOR_REVENUE_WIN
  ) {
    const rpvControl = control.revenuePerVisitor || control.revenue / Math.max(1, control.impressions);
    const rpvChallenger = best.revenuePerVisitor || best.revenue / Math.max(1, best.impressions);
    const liftPct = rpvControl > 0 ? ((rpvChallenger - rpvControl) / rpvControl) * 100 : 0;
    if (liftPct >= 25) {
      // Sample size + lift size threshold for revenue confidence \u2014 simpler than
      // running a full t-test, but defensible: ROAS uplift > 25% with 50+ each side.
      const conf = liftPct >= 100 && best.conversions >= 5 ? 95 :
                   liftPct >= 50  && best.conversions >= 3 ? 85 : 75;
      return {
        hasWinner: conf >= 80,
        winnerVariantId: best.variantId,
        liftPercent: Math.round(liftPct * 10) / 10,
        liftBasis: "revenue",
        liftDisplay: `+${Math.round(liftPct)}% revenue`,
        confidence: conf,
        reason: `Revenue per visitor: $${rpvControl.toFixed(2)} \u2192 $${rpvChallenger.toFixed(2)} (+${Math.round(liftPct)}% lift, ${best.conversions} paid conversions on the winner).`,
        shouldCelebrate: conf >= 85,
      };
    }
  }

  // === CASE 3: CVR lift (the original logic, but now with first-revenue check above) ===
  if (control.conversionRate > 0 && best.conversionRate > control.conversionRate) {
    const liftPct = ((best.conversionRate - control.conversionRate) / control.conversionRate) * 100;
    return {
      hasWinner: best.confidence >= CVR_CONFIDENCE_TO_CELEBRATE,
      winnerVariantId: best.variantId,
      liftPercent: Math.round(liftPct * 10) / 10,
      liftBasis: "cvr",
      liftDisplay: `+${Math.round(liftPct)}%`,
      confidence: best.confidence,
      reason: `CVR ${(control.conversionRate*100).toFixed(2)}% \u2192 ${(best.conversionRate*100).toFixed(2)}% (+${Math.round(liftPct)}% lift, ${best.confidence}% confidence).`,
      shouldCelebrate: best.confidence >= CVR_CONFIDENCE_TO_CELEBRATE,
    };
  }

  return blank("Neither revenue nor CVR criteria met");
}

function pickBestChallenger(challengers: VariantPerformance[]): VariantPerformance | null {
  if (challengers.length === 0) return null;
  // Prefer the challenger with the highest revenue. If revenue is tied, pick
  // the one with the highest conversion rate. This way revenue-positive
  // variants win the tiebreaker over higher-CVR-but-no-revenue variants.
  return [...challengers].sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return (b.conversionRate || 0) - (a.conversionRate || 0);
  })[0];
}

function blank(reason: string): WinnerVerdict {
  return {
    hasWinner: false, winnerVariantId: null, liftPercent: 0,
    liftBasis: "cvr", liftDisplay: "0%", confidence: 0, reason, shouldCelebrate: false,
  };
}
