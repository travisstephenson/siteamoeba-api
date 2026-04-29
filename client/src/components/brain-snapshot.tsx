/**
 * BrainSnapshot — live SiteAmoeba Brain visualization for marketing surfaces.
 *
 * Pulls from /api/public/brain-graph (no auth, CORS-enabled) and renders:
 *   1. Hero stat row: visitors analyzed, behavioral signals, knowledge points
 *   2. Top winning section types + average lift
 *   3. Active strategies with win rates
 *   4. Knowledge sources (CRO research, sales psychology, etc.)
 *
 * Used on the in-app billing page (above plan tiers) so users converting are
 * looking at the actual moat they're paying for. Same data source as the
 * standalone /brain.html visualization.
 *
 * Designed to be drop-in: no router context required, no global state, no
 * theme-specific assumptions. Works on light or dark backgrounds.
 */

import { useQuery } from "@tanstack/react-query";
import { Brain, Sparkles, TrendingUp, Activity, Database } from "lucide-react";

interface BrainGraphData {
  stats: {
    pagesScanned: number;
    testsWon: number;
    totalTests: number;
    visitorsAnalyzed: number;
    conversionsTracked: number;
    behavioralSignals: number;
    revenueEvents: number;
    sessionsAnalyzed: number;
    strategiesTested: number;
    totalPreTaughtKnowledge: number;
    totalKnowledgePoints: number;
  };
  strategies: Array<{ name: string; key: string; wins: number; losses: number; avgWinLift: number }>;
  sections: Array<{ type: string; tests: number; wins: number; avgLift: number }>;
  knowledgeSources: Record<string, { label: string; description: string; totalDataPoints: number; categories: Array<{ name: string; dataPoints: number }> }>;
}

const fmt = (n: number) => n.toLocaleString();

export function BrainSnapshot() {
  const { data, isLoading } = useQuery<BrainGraphData>({
    queryKey: ["/api/public/brain-graph"],
    staleTime: 5 * 60_000, // 5 min — these stats don't change second-to-second
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-2xl border border-border bg-card/40 p-8 text-center">
        <Brain className="w-8 h-8 mx-auto text-muted-foreground animate-pulse mb-2" />
        <p className="text-sm text-muted-foreground">Loading brain stats…</p>
      </div>
    );
  }

  const { stats, strategies, sections, knowledgeSources } = data;
  const winRate = stats.totalTests > 0 ? Math.round((stats.testsWon / stats.totalTests) * 100) : 0;
  const topSections = [...sections].sort((a, b) => b.avgLift - a.avgLift).slice(0, 4);
  const topStrategies = [...strategies].sort((a, b) => b.avgWinLift - a.avgWinLift).slice(0, 4);
  const totalKnowledgeSources = Object.values(knowledgeSources || {}).reduce((sum, ks: any) => sum + (ks.totalDataPoints || 0), 0);

  return (
    <div className="space-y-6">
      {/* === HEADER === */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-medium mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live · updates every 60s
          </div>
          <h2 className="text-2xl font-bold tracking-tight">The SiteAmoeba Brain</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every test our customers run feeds the brain. Every winner makes the next test smarter.
            This is the data your campaigns are tested against.
          </p>
        </div>
      </div>

      {/* === HERO STATS ROW === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Visitors analyzed"
          value={fmt(stats.visitorsAnalyzed)}
          accent="emerald"
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Behavioral signals"
          value={fmt(stats.behavioralSignals)}
          accent="blue"
        />
        <StatCard
          icon={<Database className="w-4 h-4" />}
          label="Knowledge points"
          value={fmt(stats.totalKnowledgePoints)}
          accent="purple"
        />
        <StatCard
          icon={<Sparkles className="w-4 h-4" />}
          label="Test win rate"
          value={`${winRate}%`}
          sublabel={`${stats.testsWon} of ${stats.totalTests} tests`}
          accent="amber"
        />
      </div>

      {/* === TWO-COLUMN: top sections + top strategies === */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card/40 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold tracking-tight">Highest-leverage sections</h3>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">avg lift</span>
          </div>
          <div className="space-y-2.5">
            {topSections.length === 0 && (
              <p className="text-xs text-muted-foreground">Insufficient data yet — check back soon.</p>
            )}
            {topSections.map((s) => (
              <div key={s.type} className="flex items-center justify-between text-sm">
                <span className="capitalize text-foreground">{s.type.replace(/_/g, " ")}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{s.wins}/{s.tests} wins</span>
                  <span className="font-mono font-semibold text-emerald-400">+{s.avgLift.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold tracking-tight">Top winning strategies</h3>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">avg lift</span>
          </div>
          <div className="space-y-2.5">
            {topStrategies.length === 0 && (
              <p className="text-xs text-muted-foreground">Strategies are learned over time.</p>
            )}
            {topStrategies.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{s.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{s.wins}-{s.losses}</span>
                  <span className="font-mono font-semibold text-emerald-400">+{s.avgWinLift.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === KNOWLEDGE SOURCES === */}
      <div className="rounded-xl border border-border bg-card/40 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold tracking-tight">Pre-taught knowledge ({fmt(totalKnowledgeSources)} principles)</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">curated from research</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {Object.entries(knowledgeSources || {}).map(([key, src]: [string, any]) => (
            <div key={key} className="rounded-lg border border-border/50 bg-background/30 p-3">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-foreground">{src.label}</span>
                <span className="text-xs font-mono text-emerald-400">{src.totalDataPoints}</span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2">{src.description}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Every plan above gets the full power of the brain on every campaign you run.
      </p>
    </div>
  );
}

function StatCard({
  icon, label, value, sublabel, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  accent: "emerald" | "blue" | "purple" | "amber";
}) {
  const accentClasses = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    blue:    "text-blue-400 bg-blue-500/10 border-blue-500/20",
    purple:  "text-purple-400 bg-purple-500/10 border-purple-500/20",
    amber:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
  }[accent];
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border ${accentClasses} mb-2`}>
        {icon}
      </div>
      <div className="text-2xl font-bold font-mono tracking-tight">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</div>
      {sublabel && <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>}
    </div>
  );
}
