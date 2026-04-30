/**
 * ActivationSuggestionsBanner
 *
 * Shown at the top of the campaigns dashboard. Surfaces the dormant-campaign
 * suggestions from /api/activation-suggestions so users who have traffic but
 * no test running see a specific, brain-backed nudge to take action.
 *
 * Built Apr 30 2026. Per Travis: "remember our app will do more for people than
 * just test variations \u2014 we give them data about their offer they can't see
 * elsewhere." So when there's no actionable activation suggestion, we don't
 * render at all (no negative-space \"all campaigns are healthy\" message); the
 * dashboard's other widgets surface the analytical value.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, AlertCircle, ArrowRight, X } from "lucide-react";
import { useState } from "react";

interface ActivationSuggestion {
  campaignId: number;
  campaignName: string;
  campaignUrl: string;
  visitors7d: number;
  conversions7d: number;
  problem: "no_test_sections_picked" | "sections_picked_no_variants" | "variants_unattached";
  problemLabel: string;
  suggestedSection: string;
  suggestedSectionLabel: string;
  estimatedLiftPct: number | null;
  estimatedLiftBasis: string;
  ctaPath: string;
  ctaLabel: string;
}

const DISMISSED_KEY = "sa_activation_dismissed_v1";

function loadDismissed(): Record<number, number> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}
function saveDismissed(d: Record<number, number>) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(d));
  } catch {
    // ignore
  }
}

export function ActivationSuggestionsBanner() {
  const [dismissed, setDismissed] = useState<Record<number, number>>(loadDismissed());

  const { data } = useQuery<{ count: number; items: ActivationSuggestion[] }>({
    queryKey: ["/api/activation-suggestions"],
    staleTime: 60_000,
  });

  if (!data || data.count === 0) return null;

  // Filter out dismissed-this-session campaigns. Re-show after 24h.
  const now = Date.now();
  const visible = data.items.filter((it) => {
    const dismissedAt = dismissed[it.campaignId];
    if (!dismissedAt) return true;
    return now - dismissedAt > 24 * 60 * 60 * 1000;
  });

  if (visible.length === 0) return null;

  function dismiss(campaignId: number) {
    const next = { ...dismissed, [campaignId]: Date.now() };
    setDismissed(next);
    saveDismissed(next);
  }

  return (
    <div className="space-y-2.5 mb-5">
      {visible.map((s) => (
        <Card
          key={s.campaignId}
          className="overflow-hidden border-amber-500/30 bg-gradient-to-br from-amber-500/[0.04] to-emerald-500/[0.04]"
        >
          <div className="flex items-start gap-4 p-4">
            <div className="shrink-0 w-9 h-9 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">
                  Campaign getting traffic, no test running
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {s.visitors7d.toLocaleString()} visitors / 7d
                  {s.conversions7d > 0 && ` \u00b7 ${s.conversions7d.toLocaleString()} conversions`}
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground truncate">
                {s.campaignName}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.problemLabel}</p>

              <div className="mt-3 p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 flex items-start gap-2.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {s.estimatedLiftPct ? (
                    <p className="text-xs text-foreground">
                      <span className="font-semibold text-emerald-400">
                        +{s.estimatedLiftPct}% estimated lift
                      </span>{" "}
                      by testing your <span className="font-semibold">{s.suggestedSectionLabel}</span>.
                    </p>
                  ) : (
                    <p className="text-xs text-foreground">
                      Start with your <span className="font-semibold">{s.suggestedSectionLabel}</span> \u2014
                      it's the highest-leverage element on the page.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {s.estimatedLiftBasis}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Link href={s.ctaPath}>
                  <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                    {s.ctaLabel}
                    <ArrowRight className="w-3 h-3 ml-1.5" />
                  </Button>
                </Link>
                <button
                  onClick={() => dismiss(s.campaignId)}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button
              onClick={() => dismiss(s.campaignId)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}
