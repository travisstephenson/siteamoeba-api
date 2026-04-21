/**
 * useActiveTests(campaignId)
 *
 * THE ONLY way to read "what tests are running on this campaign?" from
 * the client. Wraps the /api/campaigns/:id/active-tests endpoint which
 * returns the canonical ActiveTestState (see server/active-tests.ts).
 *
 * Every component that renders test state \u2014 visual editor, campaign
 * dashboard, variant cards, preview banners \u2014 should use this hook.
 * Do NOT read variants + test_sections separately and combine them
 * client-side. That's exactly the drift pattern we're eliminating.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface ActiveTestVariant {
  id: number;
  type: string;
  text: string;
  isControl: boolean;
  isActive: boolean;
  testSectionId: number | null;
  mutations: string | null;
  displayIssue: boolean;
}

export interface ActiveTestSection {
  id: number;
  sectionId: string;
  label: string;
  category: string;
  selector: string;
  testMethod: string;
  currentText: string;
  trafficPercentage: number;
  isActive: true;
  control: ActiveTestVariant | null;
  challengers: ActiveTestVariant[];
}

export interface ActiveTestState {
  campaignId: number;
  campaignIsActive: boolean;
  liveSections: ActiveTestSection[];
  needsAttention: Array<{
    section: ActiveTestSection;
    reason: "no_active_variants" | "no_control" | "no_challenger";
  }>;
  isLive: boolean;
  totalLiveSections: number;
  totalActiveChallengers: number;
}

export function useActiveTests(campaignId: number | undefined) {
  return useQuery<ActiveTestState>({
    queryKey: ["/api/campaigns", campaignId, "active-tests"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/active-tests`);
      return res.json();
    },
    enabled: !!campaignId && !isNaN(campaignId),
    staleTime: 5_000, // short stale time — this data changes the moment a toggle flips
  });
}

/**
 * Canonical invalidation helper.
 *
 * Any time test/variant state changes (toggle, generate, rescan, winner,
 * pause, delete, etc.) call this ONE helper with the campaign id. It
 * invalidates every cache entry that depends on the active-test state
 * \u2014 active-tests, stats, campaign, test-sections, variants. Nothing
 * gets missed and no surface goes stale.
 */
export function invalidateActiveTests(
  queryClient: ReturnType<typeof useQueryClient>,
  campaignId: number | undefined
) {
  if (!campaignId) return;
  queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "active-tests"] });
  queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
  queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "test-sections"] });
  queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
  queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
}
