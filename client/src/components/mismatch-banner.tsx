/**
 * MismatchBanner
 *
 * Shown when the widget has detected that one or more active test sections
 * can no longer find their target on the customer's live page. Per Travis:
 * "ANYTIME there is a flaw in our system, it doesn't hurt the client. If our
 * system can't find the text they are asking to change, it bypasses changing
 * anything, leaves the original page as is, and flags a notification in the
 * members area saying 'No Tests Are Active Due To Text Mismatch, Please
 * Rescan Your Page.'"
 *
 * The widget bails out (page stays on control, untouched) and beacons home
 * to /api/widget/text-mismatch. This banner reads /api/campaigns/:id/mismatches
 * and surfaces the unacknowledged ones, with a one-click "Rescan now" CTA
 * and a dismiss option.
 *
 * Built May 2026 in response to the Stu incident.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, RefreshCw, X, ChevronDown, ChevronUp } from "lucide-react";

interface Mismatch {
  id: number;
  label: string;
  category: string;
  selector: string;
  current_text: string | null;
  last_mismatch_at: string;
  last_mismatch_reason: "selector_miss" | "size_mismatch" | "text_drift" | string;
  last_mismatch_url: string | null;
  mismatch_hit_count: number;
}

interface MismatchData {
  campaignId: number;
  campaignUrl: string;
  mismatches: Mismatch[];
}

const REASON_LABELS: Record<string, string> = {
  selector_miss: "Element no longer found on the page",
  size_mismatch: "Target element is much larger than the variant — refused to overwrite",
  text_drift: "Page text has changed significantly since the last scan",
};

interface MismatchBannerProps {
  campaignId: number;
  /** Called after a successful rescan triggers, so the parent can refresh state. */
  onRescan?: () => void;
}

export function MismatchBanner({ campaignId, onRescan }: MismatchBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery<MismatchData>({
    queryKey: [`/api/campaigns/${campaignId}/mismatches`],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/mismatches/dismiss`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/mismatches`] });
    },
  });

  const rescanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/rescan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/mismatches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/sections`] });
      onRescan?.();
    },
  });

  if (!data || !data.mismatches || data.mismatches.length === 0) return null;

  const count = data.mismatches.length;
  const isRescanning = rescanMutation.isPending;
  const isDismissing = dismissMutation.isPending;

  return (
    <Card className="overflow-hidden border-amber-500/40 bg-amber-500/[0.06] mb-4">
      <div className="flex items-start gap-3 p-4">
        <div className="shrink-0 w-9 h-9 rounded-lg border border-amber-500/40 bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            No Tests Are Active Due To Text Mismatch — Please Rescan Your Page
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            We couldn’t safely find {count === 1 ? "this section" : `${count} sections`} on your live
            page, so we left it alone instead of risking damage. Your visitors are seeing the
            original page exactly as you wrote it.
          </div>

          {/* Expandable per-section detail */}
          {expanded && (
            <div className="mt-3 space-y-2">
              {data.mismatches.map((m) => (
                <div
                  key={m.id}
                  className="rounded-md border border-amber-500/20 bg-background/40 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{m.label}</span>
                    <Badge variant="outline" className="text-[10px] py-0">
                      {m.category}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] py-0 text-amber-600 border-amber-500/40">
                      {REASON_LABELS[m.last_mismatch_reason] || m.last_mismatch_reason}
                    </Badge>
                    {m.mismatch_hit_count > 1 && (
                      <span className="text-[10px] text-muted-foreground">
                        {m.mismatch_hit_count} hits
                      </span>
                    )}
                  </div>
                  {m.current_text && (
                    <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                      Looking for: “{m.current_text.slice(0, 140)}{m.current_text.length > 140 ? "…" : ""}”
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              size="sm"
              onClick={() => rescanMutation.mutate()}
              disabled={isRescanning}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRescanning ? "animate-spin" : ""}`} />
              {isRescanning ? "Rescanning…" : "Rescan now"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
              className="gap-1.5"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Hide details" : "What's affected?"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissMutation.mutate()}
              disabled={isDismissing}
              className="gap-1.5 ml-auto text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
              Dismiss for now
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
