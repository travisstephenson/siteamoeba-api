import React, { useState, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Users,
  TrendingUp,
  DollarSign,
  Zap,
  ChevronRight,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Crown,
  Shield,
  Code2,
  Webhook,
  BarChart3,
  Type,
  AlignLeft,
  RefreshCw,
  Sparkles,
  Wand2,
  AlertCircle,
  Brain,
  Rocket,
  X,
  MousePointerClick,
  Star,
  HelpCircle,
  ListOrdered,
  ImageIcon,
  LayoutList,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  TextCursorInput,
  FlaskConical,
  Trophy,
  TrendingDown,
  MessageCircle,
  Send,
  Bot,
  Play,
  Pause,
  CheckCircle2,
  CircleDot,
  Loader2,
  Lightbulb,
  Lock,
  History,
  ChevronLeft,
  Archive,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Area, Line, Legend, CartesianGrid, ComposedChart } from "recharts";
import type { Campaign, Variant, TestSection, DailyObservation } from "@shared/schema";

interface VariantStats {
  id: number;
  text: string;
  type: string;
  isControl: boolean;
  isActive: boolean;
  testSectionId?: number | null;
  visitors: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  confidence: number;
}

interface CampaignStats {
  totalVisitors: number;
  totalConversions: number;
  totalRevenue: number;
  conversionRate: number;
  variants: VariantStats[];
}

interface DailyStat {
  date: string;
  visitors: number;
  conversions: number;
}

// ---- KPI Card ----
function KPICard({
  label,
  value,
  icon: Icon,
  sub,
  accentColor,
  iconBg,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  sub?: string;
  accentColor: string;
  iconBg: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      {/* Colored accent bar on the left */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ background: accentColor }}
      />
      <CardContent className="pt-5 pb-4 pl-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: iconBg }}
          >
            <Icon className="w-4 h-4" style={{ color: accentColor }} />
          </div>
        </div>
        <div className="text-3xl font-bold tabular-nums" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ---- Confidence indicator ----
function ConfidenceBar({ confidence, isControl, isLeader }: { confidence: number; isControl?: boolean; isLeader?: boolean }) {
  const pct = Math.min(100, Math.max(0, confidence));

  let barColor: string;
  let label: string;

  let description: string;

  if (isControl) {
    barColor = "bg-muted-foreground/40";
    label = "Control";
    description = "This is your original — other variants are measured against it";
  } else if (pct >= 95) {
    barColor = isLeader ? "bg-green-500" : "bg-red-500";
    label = isLeader ? "Winner" : "Underperforming";
    description = isLeader
      ? `${pct.toFixed(0)}% confident this variant outperforms the control`
      : `${pct.toFixed(0)}% confident this variant underperforms the control`;
  } else if (pct >= 80) {
    barColor = "bg-blue-500";
    label = isLeader ? "Likely winner" : "Likely underperforming";
    description = isLeader
      ? `${pct.toFixed(0)}% confident this will outperform the control — needs more traffic to confirm`
      : `${pct.toFixed(0)}% confident this is underperforming the control`;
  } else if (pct >= 50) {
    barColor = "bg-amber-500";
    label = "Trending";
    description = isLeader
      ? `${pct.toFixed(0)}% confidence — showing potential but needs more traffic to be conclusive`
      : `${pct.toFixed(0)}% confidence — early results suggest this may underperform the control`;
  } else {
    barColor = "bg-muted-foreground/30";
    label = "Collecting data";
    description = "Not enough traffic yet to determine a trend";
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: isControl ? "100%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---- Sample size indicator ----
function sampleSizeNeeded(visitors: number, conversionRate: number): number | null {
  if (visitors === 0) return null;
  const p = conversionRate / 100;
  if (p <= 0 || p >= 1) return null;
  // MDE = 50% relative improvement (e.g. 5% baseline → 7.5% target)
  const mde = p * 0.50;
  if (mde === 0) return null;
  const raw = Math.ceil(16 * p * (1 - p) / (mde * mde));
  // Cap at 10,000 — above this we show a different message
  return raw;
}

// ---- Variant Comparison Chart ----
function VariantComparisonChart({
  variants,
  testSections,
  isLoading,
}: {
  variants: VariantStats[];
  testSections: TestSection[];
  isLoading: boolean;
}) {
  const TEAL = "hsl(160, 84%, 36%)";
  const TEAL_LIGHT = "hsl(160, 60%, 72%)";
  const TEAL_MUTED = "hsl(160, 30%, 80%)";
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  // Build section groups — show ALL variants with data, grouped by section
  const sectionGroups = useMemo(() => {
    const groups: { key: string; label: string; variants: VariantStats[] }[] = [];
    const placed = new Set<number>();

    const typeLabels: Record<string, string> = {
      headline: "Headlines",
      subheadline: "Sub-Headlines",
      cta: "Calls to Action",
      social_proof: "Social Proof",
      faq: "FAQ",
      features: "Features",
      pricing: "Pricing",
      image: "Images",
      nav: "Navigation",
      body_copy: "Body Copy",
      bonus: "Bonus",
      guarantee: "Guarantee",
      testimonials: "Testimonials",
    };

    if (testSections.length > 0) {
      // Scanner-based campaigns — group by ALL test sections (active and inactive)
      // Active sections first, then inactive, each sorted by priority
      const allSections = [...testSections]
        .sort((a, b) => {
          // Active first, then by priority
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return (a.testPriority ?? 99) - (b.testPriority ?? 99);
        });

      for (const section of allSections) {
        const sectionVars = variants
          .filter((v) => {
            if (v.testSectionId) return v.testSectionId === section.id;
            // Legacy fallback: match by type only if there's one section of this category
            const sameCatSections = testSections.filter((s2) => s2.category === section.category);
            if (sameCatSections.length <= 1) return v.type === section.category;
            return false;
          })
          .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));

        // Only show sections that have multiple variants (something to compare)
        if (sectionVars.length > 1) {
          sectionVars.forEach((v) => placed.add(v.id));
          groups.push({
            key: `section-${section.id}`,
            label: section.label,
            variants: sectionVars,
          });
        }
      }

      // Also group remaining unplaced variants by type (those without testSectionId)
      const unplaced = variants.filter((v) => !placed.has(v.id));
      const typeMap = new Map<string, VariantStats[]>();
      for (const v of unplaced) {
        const list = typeMap.get(v.type) || [];
        list.push(v);
        typeMap.set(v.type, list);
      }
      for (const [type, vars] of typeMap) {
        if (vars.length <= 1) continue; // Need 2+ to compare
        vars.sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));
        groups.push({
          key: `type-${type}`,
          label: typeLabels[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          variants: vars,
        });
      }
    } else {
      // Legacy campaigns — group by variant type
      const typeMap = new Map<string, VariantStats[]>();
      for (const v of variants) {
        const list = typeMap.get(v.type) || [];
        list.push(v);
        typeMap.set(v.type, list);
      }
      for (const [type, vars] of typeMap) {
        vars.sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));
        groups.push({
          key: `type-${type}`,
          label: typeLabels[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          variants: vars,
        });
      }
    }

    return groups;
  }, [variants, testSections]);

  const nameMaxLen = isMobile ? 22 : 40;
  function makeChartData(list: VariantStats[]) {
    return list.map((v, i) => {
      const plain = v.text.replace(/<[^>]*>/g, "");
      return {
        name: plain.slice(0, nameMaxLen) + (plain.length > nameMaxLen ? "…" : ""),
        rate: parseFloat((v.conversionRate ?? 0).toFixed(2)),
        isLeader: i === 0 && list.length > 1,
        id: v.id,
        confidence: v.confidence ?? 0,
        isControl: v.isControl,
        isActive: v.isActive,
      };
    });
  }

  const allChartData = sectionGroups.map((g) => ({
    ...g,
    data: makeChartData(g.variants),
  }));

  const allZero = allChartData.every((g) => g.data.every((d) => d.rate === 0));

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Variant Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
            <Skeleton className="h-6 w-4/6" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (allChartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Variant Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-sm text-muted-foreground">
            No variants to compare yet. Activate a test section and generate variants to see performance data.
          </div>
        </CardContent>
      </Card>
    );
  }

  function VariantBarChart({
    data,
    label,
  }: {
    data: { name: string; rate: number; isLeader: boolean; id: number; isControl: boolean; confidence: number; isActive: boolean }[];
    label: string;
  }) {
    if (data.length === 0) return null;
    const sectionAllZero = data.every((d) => d.rate === 0);
    if (sectionAllZero) {
      return (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{label}</div>
          <div className="py-4 text-center text-xs text-muted-foreground">No conversion data yet.</div>
        </div>
      );
    }
    const barHeight = 36;
    const chartHeight = data.length * barHeight + 16;
    const yAxisWidth = isMobile ? 100 : 180;
    return (
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2 flex-wrap">
          {label}
          {data[0]?.isLeader && (
            <Badge className="text-xs gap-1 bg-green-600 text-white py-0 max-w-[200px] truncate">
              <Crown className="w-2.5 h-2.5 shrink-0" /> Leader: {data[0].name}
            </Badge>
          )}
        </div>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              domain={[0, "auto"]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={yAxisWidth}
              tick={{ fontSize: isMobile ? 10 : 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${value}%`, "Conv. Rate"]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]} barSize={20} label={{ position: "right", formatter: (v: number, _: any, i: number) => {
              const entry = data[i];
              const confStr = entry && !entry.isControl && entry.confidence > 0 ? ` (${entry.confidence.toFixed(0)}%)` : "";
              return `${v}%${confStr}`;
            }, fontSize: 11 }}>
              {data.map((entry) => (
                <Cell
                  key={entry.id}
                  fill={entry.isLeader ? TEAL : !entry.isActive ? TEAL_MUTED : TEAL_LIGHT}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Variant Performance
        </CardTitle>
        <p className="text-xs text-muted-foreground">Conversion rate by variant — teal bar is the current leader.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {allChartData.map((group) => (
          <VariantBarChart key={group.key} data={group.data} label={group.label} />
        ))}
      </CardContent>
    </Card>
  );
}

// ---- Preview Mock ----
function HeroPreview({
  headline,
  subheadline,
  url,
}: {
  headline: string;
  subheadline?: string;
  url: string;
}) {
  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden bg-background">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 bg-background rounded px-2 py-0.5 text-xs text-muted-foreground truncate">
          {url}
        </div>
      </div>
      {/* Page hero area */}
      <div className="p-6 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-background min-h-[80px] flex flex-col items-center justify-center text-center">
        <div
          className="text-base font-bold text-foreground mb-1"
          dangerouslySetInnerHTML={{ __html: headline }}
        />
        {subheadline && (
          <div
            className="text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: subheadline }}
          />
        )}
      </div>
    </div>
  );
}

// ---- Strategy display labels ----
const STRATEGY_LABELS: Record<string, string> = {
  curiosity_gap: "Curiosity Gap",
  problem_agitation: "Problem Agitation",
  social_proof: "Social Proof",
  feature_benefit: "Feature–Benefit",
  loss_aversion: "Loss Aversion",
  contrarian: "Contrarian",
  transformation: "Transformation",
  urgency: "Urgency",
  direct_clarity: "Direct & Clear",
  how_to: "How-To",
  unknown: "Custom",
};

interface AIVariant {
  text: string;
  strategy: string;
  reasoning: string;
}

// ---- Brain upsell card (after generating variants, for free users) ----
function BrainUpsellCard({ plan }: { plan: string }) {
  if (plan !== "free") {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md text-xs"
        style={{
          background: "hsl(160 84% 36% / 0.07)",
          border: "1px solid hsl(160 84% 36% / 0.18)",
        }}
        data-testid="badge-powered-by-brain"
      >
        <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(160 84% 36%)" }} />
        <span className="font-medium" style={{ color: "hsl(160 84% 36%)" }}>Powered by the Brain</span>
        <span className="text-muted-foreground">— variants informed by 2,847 real conversion tests</span>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg p-4 space-y-2"
      style={{
        background: "linear-gradient(135deg, hsl(160 84% 36% / 0.05) 0%, hsl(160 84% 36% / 0.02) 100%)",
        border: "1px solid hsl(160 84% 36% / 0.22)",
      }}
      data-testid="card-brain-upsell"
    >
      <div className="flex items-start gap-2">
        <Brain className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(160 84% 36%)" }} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Want better results?</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Brain-powered variants are trained on thousands of real A/B tests. Users with Brain access see{" "}
            <span className="font-medium text-foreground">31% higher conversion rates</span> on average.
          </p>
        </div>
      </div>
      <a href="/#/billing">
        <button
          className="w-full h-8 rounded-md text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
          style={{ background: "hsl(160 84% 36%)" }}
          data-testid="button-brain-upgrade-variants"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Upgrade to Pro
        </button>
      </a>
    </div>
  );
}

// ---- Autopilot Panel ---- (full autopilot control shown above test sections)
interface AutopilotStatus {
  enabled: boolean;
  currentStep: number;
  totalSteps: number;
  status: string;
  currentSectionId: number | null;
  playbook: Array<{ sectionCategory: string; priority: number; focusAreas: string; minSampleSize: number }>;
  currentPlaybookStep: { sectionCategory: string; priority: number; focusAreas: string; minSampleSize: number } | null;
  visitorsOnCurrentTest: number;
  minVisitorsNeeded: number | null;
}

function AutopilotPanel({
  campaignId,
  userPlan,
  minVisitorsPerVariant,
}: {
  campaignId: number;
  userPlan: string;
  minVisitorsPerVariant: number;
}) {
  const { toast } = useToast();
  const isAutopilotPlan = userPlan === "autopilot";

  const { data: apStatus, isLoading: apLoading, refetch: refetchStatus } = useQuery<AutopilotStatus>({
    queryKey: ["/api/campaigns", campaignId, "autopilot", "status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/autopilot/status`);
      if (!res.ok) throw new Error("Failed to load autopilot status");
      return res.json();
    },
    enabled: isAutopilotPlan,
    refetchInterval: 15000, // poll every 15s so UI stays fresh
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/autopilot/enable`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to enable autopilot");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "sections"] });
      toast({ title: "Autopilot enabled", description: "Generating variants for the first section..." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to enable autopilot", description: err.message, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/autopilot/disable`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to disable autopilot");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
      toast({ title: "Autopilot paused", description: "You can re-enable it at any time." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to disable autopilot", description: err.message, variant: "destructive" });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/autopilot/evaluate`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Evaluation failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "sections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      const action = data?.action;
      if (action?.action === "declared_winner") {
        toast({
          title: "Winner declared!",
          description: action.message || `Winner found for ${action.sectionType}.`,
        });
      } else {
        toast({ title: "Evaluation complete", description: "No winner yet — keep testing." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Evaluation failed", description: err.message, variant: "destructive" });
    },
  });

  // Not on autopilot plan — show upsell
  if (!isAutopilotPlan) {
    return (
      <div
        className="rounded-lg p-4 space-y-2"
        style={{
          border: "1.5px dashed hsl(160 84% 36% / 0.30)",
          background: "hsl(160 84% 36% / 0.03)",
        }}
        data-testid="panel-autopilot-upsell"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 shrink-0" style={{ color: "hsl(160 84% 36%)" }} />
            <span className="text-sm font-semibold text-foreground">Autopilot</span>
            <Badge
              className="text-xs px-1.5 py-0"
              style={{
                background: "hsl(160 84% 36% / 0.12)",
                color: "hsl(160 84% 36%)",
                border: "1px solid hsl(160 84% 36% / 0.20)",
              }}
            >
              $299/mo
            </Badge>
          </div>
          <Switch disabled checked={false} data-testid="switch-autopilot-disabled" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Automatically tests every section in order, declares winners, and advances — no manual work required.
        </p>
        <a
          href="/#/billing"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: "hsl(160 84% 36%)" }}
          data-testid="link-autopilot-upgrade"
        >
          Upgrade to Autopilot Plan
        </a>
      </div>
    );
  }

  if (apLoading) {
    return (
      <div className="rounded-lg border border-border p-4" data-testid="panel-autopilot-loading">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading autopilot status...</span>
        </div>
      </div>
    );
  }

  const isEnabled = apStatus?.enabled ?? false;
  const currentStep = apStatus?.currentStep ?? 0;
  const totalSteps = apStatus?.totalSteps ?? 0;
  const status = apStatus?.status ?? "idle";
  const playbook = apStatus?.playbook ?? [];
  const currentPlaybookStep = apStatus?.currentPlaybookStep;
  const visitorsOnCurrentTest = apStatus?.visitorsOnCurrentTest ?? 0;
  const minNeeded = minVisitorsPerVariant;

  const isPending = enableMutation.isPending || disableMutation.isPending;

  const statusLabel = (() => {
    if (!isEnabled) return "Paused";
    if (status === "completed") return "Completed";
    if (status === "generating") return "Generating variants...";
    if (status === "advancing") return "Advancing to next step...";
    if (status === "evaluating") return "Evaluating results...";
    if (status === "testing" && currentPlaybookStep) {
      return `Testing ${currentPlaybookStep.sectionCategory} (${visitorsOnCurrentTest} of ~${minNeeded} visitors needed)`;
    }
    return "Ready";
  })();

  const getStepIcon = (stepIdx: number) => {
    if (stepIdx < currentStep) return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(160 84% 36%)" }} />;
    if (stepIdx === currentStep && isEnabled) return <CircleDot className="w-3.5 h-3.5" style={{ color: "hsl(38 92% 50%)" }} />;
    return <div className="w-3.5 h-3.5 rounded-full border border-border" />;
  };

  return (
    <Card
      className="overflow-hidden"
      data-testid="panel-autopilot"
      style={isEnabled ? { borderColor: "hsl(160 84% 36% / 0.40)" } : undefined}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Rocket
            className="w-4 h-4 shrink-0"
            style={{ color: isEnabled ? "hsl(160 84% 36%)" : "hsl(var(--muted-foreground))" }}
          />
          <span className="text-sm font-semibold text-foreground">Autopilot</span>
          {isEnabled && status !== "paused" && (
            <Badge
              className="text-xs px-1.5 py-0"
              style={{
                background: status === "completed" ? "hsl(160 84% 36% / 0.12)" : "hsl(38 92% 50% / 0.12)",
                color: status === "completed" ? "hsl(160 84% 36%)" : "hsl(38 92% 50%)",
                border: `1px solid ${status === "completed" ? "hsl(160 84% 36% / 0.25)" : "hsl(38 92% 50% / 0.25)"}`,
              }}
              data-testid="badge-autopilot-status"
            >
              {status === "completed" ? "Completed" : `Step ${currentStep + 1} of ${totalSteps}`}
            </Badge>
          )}
        </div>
        <Switch
          checked={isEnabled}
          disabled={isPending || status === "completed"}
          onCheckedChange={(checked) => {
            if (checked) enableMutation.mutate();
            else disableMutation.mutate();
          }}
          data-testid="switch-autopilot-toggle"
        />
      </div>

      {/* Status message */}
      {isEnabled && status !== "idle" && (
        <div
          className="px-4 pb-2 flex items-center gap-2"
          data-testid="text-autopilot-status"
        >
          {(status === "generating" || status === "advancing" || status === "evaluating") ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(38 92% 50%)" }} />
          ) : status === "completed" ? (
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(160 84% 36%)" }} />
          ) : (
            <CircleDot className="w-3.5 h-3.5" style={{ color: "hsl(38 92% 50%)" }} />
          )}
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>
      )}

      {!isEnabled && (
        <div className="px-4 pb-2">
          <p className="text-xs text-muted-foreground">Enable autopilot to automatically test and optimize every section of your page.</p>
        </div>
      )}

      {/* Playbook progress */}
      {playbook.length > 0 && (
        <div className="px-4 pb-3" data-testid="list-autopilot-playbook">
          <div className="flex flex-col gap-1">
            {playbook.map((step, idx) => {
              const isCurrentStep = idx === currentStep;
              const isCompletedStep = idx < currentStep;
              const isUpcoming = idx > currentStep;
              return (
                <div
                  key={step.sectionCategory}
                  className="flex items-center gap-2 py-1"
                  style={{ opacity: isUpcoming ? 0.4 : 1 }}
                  data-testid={`item-autopilot-step-${idx}`}
                >
                  {getStepIcon(idx)}
                  <span
                    className="text-xs capitalize"
                    style={{
                      fontWeight: isCurrentStep ? 600 : 400,
                      color: isCompletedStep
                        ? "hsl(160 84% 36%)"
                        : isCurrentStep
                        ? "hsl(var(--foreground))"
                        : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {step.sectionCategory.replace(/_/g, " ")}
                  </span>
                  {isCompletedStep && (
                    <span className="text-xs text-muted-foreground/60 ml-1">done</span>
                  )}
                  {isCurrentStep && isEnabled && status === "testing" && (
                    <span
                      className="text-xs ml-1"
                      style={{ color: "hsl(38 92% 50%)" }}
                    >
                      testing
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {isEnabled && status === "testing" && (
        <div className="px-4 pb-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            disabled={evaluateMutation.isPending}
            onClick={() => evaluateMutation.mutate()}
            data-testid="button-autopilot-evaluate"
          >
            {evaluateMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Zap className="w-3 h-3 mr-1" />
            )}
            Evaluate now
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---- Autopilot promo card (shown next to manual entry) ----
function AutopilotPromoCard() {
  const steps = ["Headline", "Subheadline", "CTA", "Social Proof"];
  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{
        border: "1.5px dashed hsl(160 84% 36% / 0.30)",
        background: "hsl(160 84% 36% / 0.03)",
      }}
      data-testid="card-autopilot-promo"
    >
      <div className="flex items-start gap-2">
        <Rocket className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(160 84% 36%)" }} />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">Let Autopilot handle this</p>
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{
                background: "hsl(160 84% 36% / 0.12)",
                color: "hsl(160 84% 36%)",
              }}
            >
              $299/mo
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Autopilot continuously tests and optimizes every section of your page — no manual work required.
          </p>
        </div>
      </div>

      {/* Flow visual */}
      <div className="flex items-center gap-1 flex-wrap pl-6">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-1">
            <span
              className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{
                background: "hsl(160 84% 36% / 0.10)",
                color: "hsl(160 84% 36%)",
                border: "1px solid hsl(160 84% 36% / 0.20)",
              }}
            >
              <Check className="w-2.5 h-2.5" />
              {step}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
            )}
          </div>
        ))}
      </div>

      <a
        href="/#/billing"
        className="text-xs font-medium underline underline-offset-2"
        style={{ color: "hsl(160 84% 36%)" }}
        data-testid="link-autopilot-learn-more"
      >
        Learn more about Autopilot
      </a>
    </div>
  );
}

// ---- AI Variant Generator ----
function AIVariantGenerator({
  campaignId,
  type,
  sectionId,
  onAdded,
  userPlan,
}: {
  campaignId: number;
  type: string;
  sectionId?: number;
  onAdded: () => void;
  userPlan: string;
}) {
  const [variants, setVariants] = useState<AIVariant[]>([]);
  const [addingVariantIndex, setAddingVariantIndex] = useState<number | null>(null);
  const [showManual, setShowManual] = useState(false);
  const { toast } = useToast();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/generate-variants", {
        campaignId,
        type,
        sectionId,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }
      return res.json() as Promise<{ variants: AIVariant[] }>;
    },
    onSuccess: (data) => {
      setVariants(data.variants);
    },
    onError: (err: Error) => {
      toast({
        title: "AI Generation Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const addMutation = useMutation({
    mutationFn: async ({ variant, index }: { variant: AIVariant; index: number }) => {
      setAddingVariantIndex(index);
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/variants`, {
        text: variant.text,
        type,
        isControl: false,
        isActive: true,
        campaignId,
        persuasionTags: [variant.strategy],
        testSectionId: sectionId || null,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add variant");
      }
      return res.json();
    },
    onSuccess: (_data, { variant }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Variant added", description: `"${variant.text.replace(/<[^>]*>/g, "").slice(0, 50)}..."` });
      setAddingVariantIndex(null);
      // Remove the used variant from suggestions
      setVariants((prev) => prev.filter((v) => v.text !== variant.text));
      onAdded();
    },
    onError: (err: Error) => {
      setAddingVariantIndex(null);
      toast({ title: "Error", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
  });

  const noConfig = generateMutation.error?.message?.includes("configure your AI provider");

  return (
    <div className="mt-3 space-y-3">
      {/* Generate button */}
      {variants.length === 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid={`button-generate-ai-${type}`}
          className="gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
        >
          <Wand2 className="w-3.5 h-3.5" />
          {generateMutation.isPending ? "Generating variants..." : "Generate with AI"}
        </Button>
      )}

      {/* No LLM configured message */}
      {noConfig && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 bg-muted rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          <span>
            No AI provider configured.{" "}
            <a href="/#/settings" className="text-primary underline underline-offset-2">
              Set up in Settings
            </a>
            {" "}to enable AI variant generation.
          </span>
        </div>
      )}

      {/* Generated variant cards */}
      {variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              AI-Generated Variants
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid={`button-regenerate-${type}`}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              Regenerate
            </Button>
          </div>
          {variants.map((variant, i) => (
            <div
              key={i}
              className="border border-border rounded-lg p-3 bg-card space-y-2"
              data-testid={`card-ai-variant-${type}-${i}`}
            >
              {/* Strategy badge */}
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {STRATEGY_LABELS[variant.strategy] || variant.strategy}
                </Badge>
              </div>

              {/* Headline text — rendered with HTML if has spans */}
              <div
                className="text-sm text-foreground font-medium leading-snug"
                dangerouslySetInnerHTML={{ __html: variant.text }}
                data-testid={`text-ai-variant-${type}-${i}`}
              />

              {/* Reasoning */}
              {variant.reasoning && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {variant.reasoning}
                </p>
              )}

              {/* Use this variant button */}
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => addMutation.mutate({ variant, index: i })}
                disabled={addMutation.isPending && addingVariantIndex === i}
                data-testid={`button-use-ai-variant-${type}-${i}`}
              >
                {addMutation.isPending && addingVariantIndex === i ? (
                  "Adding..."
                ) : (
                  <>Use this variant</>
                )}
              </Button>
            </div>
          ))}

          {/* Brain upsell — shown after variants are generated */}
          <BrainUpsellCard plan={userPlan} />

          {/* Dismiss generated variants */}
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setVariants([])}
            data-testid={`button-dismiss-ai-variants-${type}`}
          >
            Dismiss suggestions
          </button>
        </div>
      )}

      {/* Manual entry toggle */}
      {!showManual && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          onClick={() => setShowManual(true)}
          data-testid={`button-show-manual-${type}`}
        >
          or add manually
        </button>
      )}
      {showManual && (
        <div className="space-y-3">
          <ManualAddVariantForm
            campaignId={campaignId}
            type={type}
            onAdded={() => { setShowManual(false); onAdded(); }}
            onCancel={() => setShowManual(false)}
          />
          {/* Autopilot promo — shown next to manual form */}
          <AutopilotPromoCard />
        </div>
      )}
    </div>
  );
}

// ---- Add Variant Form ----
const addVariantSchema = z.object({
  text: z.string().min(1, "Variant text is required"),
});
type AddVariantValues = z.infer<typeof addVariantSchema>;

// Renamed to ManualAddVariantForm — called from AIVariantGenerator
function ManualAddVariantForm({
  campaignId,
  type,
  onAdded,
  onCancel,
}: {
  campaignId: number;
  type: string;
  onAdded: () => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<AddVariantValues>({
    resolver: zodResolver(addVariantSchema),
    defaultValues: { text: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: AddVariantValues) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/variants`, {
        text: data.text,
        type,
        isControl: false,
        isActive: true,
        campaignId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Variant added" });
      form.reset();
      onAdded();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
        className="flex flex-wrap gap-2"
        data-testid={`form-add-variant-${type}`}
      >
        <FormField
          control={form.control}
          name="text"
          render={({ field }) => (
            <FormItem className="flex-1 min-w-48">
              <FormControl>
                <Input
                  placeholder={type === "headline" ? "Enter headline text..." : type === "subheadline" ? "Enter sub-headline text..." : `Enter ${type} text...`}
                  data-testid={`input-variant-text-${type}`}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending}
          data-testid={`button-submit-variant-${type}`}
        >
          {mutation.isPending ? "Adding…" : "Add"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { form.reset(); onCancel?.(); }}
          data-testid={`button-cancel-variant-${type}`}
        >
          Cancel
        </Button>
      </form>
    </Form>
  );
}

// AddVariantForm now delegates to AIVariantGenerator
function AddVariantForm({
  campaignId,
  type,
  sectionId,
  onAdded,
  userPlan,
}: {
  campaignId: number;
  type: string;
  sectionId?: number;
  onAdded: () => void;
  userPlan: string;
}) {
  return (
    <AIVariantGenerator
      campaignId={campaignId}
      type={type}
      sectionId={sectionId}
      onAdded={onAdded}
      userPlan={userPlan}
    />
  );
}

// ---- Declare Winner Dialog ----
function DeclareWinnerDialog({
  open,
  onOpenChange,
  variant,
  isControl,
  campaignId,
  sectionType,
  onDeclared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: VariantStats;
  isControl: boolean;
  campaignId: number;
  sectionType: string;
  onDeclared: (winner: VariantStats) => void;
}) {
  const { toast } = useToast();
  const cleanText = variant.text.replace(/<[^>]*>/g, "");

  const declareMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/declare-winner`, {
        variantId: variant.id,
        sectionType,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to declare winner");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      onOpenChange(false);
      onDeclared(variant);
      toast({ title: isControl ? "Test ended" : "Winner declared!", description: `"${cleanText.slice(0, 60)}" is now the control.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-declare-winner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isControl ? (
              <><Shield className="w-4 h-4" /> Keep Original Copy</>  
            ) : (
              <><Trophy className="w-4 h-4 text-yellow-500" /> Declare Winner</>  
            )}
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            {isControl ? (
              <span>
                Keeping your original copy as the winner will end this test. No changes needed on your site. End test?
              </span>
            ) : (
              <span>
                Declaring <strong>&#8220;{cleanText.slice(0, 80)}{cleanText.length > 80 ? "..." : ""}&#8221;</strong> as the winner will end this test. You'll need to update your site with the winning copy to continue using it. Declare winner?
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={declareMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => declareMutation.mutate()}
            disabled={declareMutation.isPending}
            className={isControl ? "" : "bg-green-600 hover:bg-green-700 text-white"}
            data-testid="button-confirm-declare-winner"
          >
            {declareMutation.isPending ? "Processing..." : isControl ? "End Test" : "Declare Winner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Winner Success Card ----
function WinnerSuccessCard({
  winner,
  isControl,
  conversionRate,
  confidence,
  onStartNewTest,
}: {
  winner: VariantStats;
  isControl: boolean;
  conversionRate: number;
  confidence: number;
  onStartNewTest: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const cleanText = winner.text.replace(/<[^>]*>/g, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    });
  };

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{
        background: "linear-gradient(135deg, hsl(142 71% 45% / 0.06) 0%, hsl(142 71% 45% / 0.02) 100%)",
        border: "1.5px solid hsl(142 71% 45% / 0.35)",
      }}
      data-testid="card-winner-success"
    >
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4 text-yellow-500 shrink-0" />
        <p className="text-sm font-semibold text-foreground">
          Test complete!
        </p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">&#8220;{cleanText.slice(0, 80)}{cleanText.length > 80 ? "..." : ""}&#8221;</span>{" "}
        won with <span className="font-semibold text-foreground">{conversionRate.toFixed(1)}% conversion rate</span>{confidence > 0 ? ` (${confidence.toFixed(0)}% confidence)` : ""}.
      </p>

      {!isControl && (
        <p className="text-xs text-muted-foreground">
          Update your site — Replace your current {winner.type} with the winning variant to lock in these results.
        </p>
      )}

      {/* Winning text with copy button */}
      <div className="flex items-start gap-2">
        <div
          className="flex-1 text-xs bg-muted rounded-md px-3 py-2 font-mono text-foreground leading-relaxed"
          data-testid="text-winner-copy"
        >
          {cleanText}
        </div>
        <Button
          size="icon"
          variant="outline"
          className="shrink-0 h-8 w-8"
          onClick={handleCopy}
          data-testid="button-copy-winner-text"
          aria-label="Copy winning text"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={onStartNewTest}
        className="text-xs h-7"
        data-testid="button-start-new-test"
      >
        Start new test
      </Button>
    </div>
  );
}

// ---- Styled Preview ----
function StyledPreview({
  text,
  styles,
  sectionType,
}: {
  text: string;
  styles?: string | null;
  sectionType: string;
}) {
  const parsedStyles = useMemo(() => {
    if (!styles) return null;
    try { return JSON.parse(styles); } catch { return null; }
  }, [styles]);

  if (!parsedStyles) {
    // Fallback: render plain text (no styles captured yet)
    return (
      <div
        className="text-sm text-foreground leading-relaxed"
        dangerouslySetInnerHTML={{ __html: text }}
        data-testid="styled-preview-fallback"
      />
    );
  }

  // CTA variant: render as button-like pill
  if (sectionType === "cta") {
    return (
      <div className="space-y-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Preview</span>
        <div className="rounded-lg overflow-hidden border border-border p-4 bg-muted/20">
          <div
            style={{
              fontFamily: parsedStyles.fontFamily || "inherit",
              fontSize: Math.min(parseInt(parsedStyles.fontSize) || 16, 20) + "px",
              fontWeight: parsedStyles.fontWeight || "700",
              color: parsedStyles.color || "#fff",
              backgroundColor: parsedStyles.backgroundColor || "#10b981",
              textAlign: "center" as const,
              padding: parsedStyles.padding || "10px 24px",
              borderRadius: parsedStyles.borderRadius || "8px",
              display: "inline-block",
              cursor: "default",
              letterSpacing: parsedStyles.letterSpacing || "normal",
              textTransform: (parsedStyles.textTransform || "none") as React.CSSProperties["textTransform"],
            }}
            dangerouslySetInnerHTML={{ __html: text }}
          />
        </div>
      </div>
    );
  }

  // Headline / subheadline / other: render with full background styling
  const fontSize = parseInt(parsedStyles.fontSize) || 16;
  // Cap font size for the preview card so it doesn't overflow
  const previewFontSize = Math.min(fontSize, 32);

  // Detect transparent backgrounds and pick a contrasting bg
  const rawBg = parsedStyles.backgroundColor || "";
  const isTransparentBg = !rawBg || rawBg === "transparent" || rawBg === "rgba(0, 0, 0, 0)";
  // Check if text color is light (white-ish) to determine fallback bg
  const rawColor = parsedStyles.color || "";
  const isLightText = /^(rgb\(\s*2[0-4]\d|rgb\(\s*25[0-5]|rgba\(\s*2[0-4]\d|rgba\(\s*25[0-5]|#f|#e|white)/i.test(rawColor);
  const effectiveBg = isTransparentBg
    ? (isLightText ? "#1a1a2e" : "#ffffff")
    : rawBg;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Preview</span>
      </div>
      <div className="rounded-lg overflow-hidden border border-border">
        <div
          style={{
            fontFamily: parsedStyles.fontFamily || "inherit",
            fontSize: previewFontSize + "px",
            fontWeight: parsedStyles.fontWeight || "inherit",
            color: parsedStyles.color || "inherit",
            backgroundColor: effectiveBg,
            textAlign: (parsedStyles.textAlign || "left") as React.CSSProperties["textAlign"],
            lineHeight: parsedStyles.lineHeight || "1.3",
            letterSpacing: parsedStyles.letterSpacing || "normal",
            textTransform: (parsedStyles.textTransform || "none") as React.CSSProperties["textTransform"],
            padding: "16px 20px",
            minHeight: "48px",
            display: "flex",
            alignItems: "center",
            justifyContent: parsedStyles.textAlign === "center" ? "center" : "flex-start",
          }}
          dangerouslySetInnerHTML={{ __html: text }}
        />
      </div>
    </div>
  );
}

// ---- Variant Card ----
function VariantCard({
  variant,
  rank,
  isLeader,
  campaignId,
  campaignUrl,
  controlVariant,
  sectionType,
  elementStyles,
}: {
  variant: VariantStats;
  rank: number;
  isLeader: boolean;
  campaignId: number;
  campaignUrl: string;
  controlVariant?: VariantStats;
  sectionType: string;
  elementStyles?: string | null;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [showDeclareDialog, setShowDeclareDialog] = useState(false);
  const [declaredWinner, setDeclaredWinner] = useState<VariantStats | null>(null);
  const { toast } = useToast();

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/variants/${variant.id}`, {
        isActive: !variant.isActive,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/variants/${variant.id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Variant deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
  });

  // vs control delta
  const vsControl = controlVariant && !variant.isControl
    ? ((variant.conversionRate ?? 0) - (controlVariant.conversionRate ?? 0))
    : null;

  // Sample size hint
  const sampleNeeded = !variant.isControl
    ? sampleSizeNeeded(variant.visitors ?? 0, variant.conversionRate ?? 0)
    : null;
  const sampleRemaining = sampleNeeded !== null ? Math.max(0, sampleNeeded - (variant.visitors ?? 0)) : null;

  // Show declare button when confidence > 80 OR always for manual trigger
  const showDeclareButton = true; // always show, but highlight when confident

  if (declaredWinner) {
    return (
      <WinnerSuccessCard
        winner={declaredWinner}
        isControl={variant.isControl}
        conversionRate={variant.conversionRate ?? 0}
        confidence={variant.confidence ?? 0}
        onStartNewTest={() => setDeclaredWinner(null)}
      />
    );
  }

  return (
    <div
      className="border border-border rounded-lg p-4 bg-card"
      data-testid={`card-variant-${variant.id}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground tabular-nums">#{rank}</span>
          {variant.isControl && (
            <Badge variant="outline" className="text-xs gap-1">
              <Shield className="w-2.5 h-2.5" /> Control
            </Badge>
          )}
          {isLeader && !variant.isControl && (
            <Badge className="text-xs gap-1 bg-green-600 text-white">
              <Crown className="w-2.5 h-2.5" /> Leader
            </Badge>
          )}
          {(variant.confidence ?? 0) >= 95 && isLeader && !variant.isControl && (
            <Badge className="text-xs gap-1 bg-yellow-500 text-white">
              <Trophy className="w-2.5 h-2.5" /> Winner
            </Badge>
          )}
          {!variant.isActive && (
            <Badge variant="secondary" className="text-xs">Paused</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowPreview((v) => !v)}
            data-testid={`button-preview-variant-${variant.id}`}
            aria-label="Toggle preview"
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            data-testid={`button-toggle-variant-${variant.id}`}
            aria-label={variant.isActive ? "Pause variant" : "Activate variant"}
          >
            {variant.isActive ? (
              <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-primary" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid={`button-delete-variant-${variant.id}`}
            aria-label="Delete variant"
          >
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Text content — styled preview when styles available, plain fallback otherwise */}
      <div className="mb-3" data-testid={`text-variant-${variant.id}`}>
        <StyledPreview
          text={variant.text}
          styles={elementStyles}
          sectionType={sectionType}
        />
      </div>

      {/* vs control comparison */}
      {vsControl !== null && (
        <div className="mb-3 flex items-center gap-1.5">
          {vsControl > 0 ? (
            <>
              <TrendingUp className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs font-semibold text-green-600">+{vsControl.toFixed(1)}% vs control</span>
            </>
          ) : vsControl < 0 ? (
            <>
              <TrendingDown className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-semibold text-red-500">{vsControl.toFixed(1)}% vs control</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Same as control</span>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-3 text-xs">
        <div>
          <div className="text-muted-foreground">Visitors</div>
          <div className="font-semibold tabular-nums">{(variant.visitors ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Conversions</div>
          <div className="font-semibold tabular-nums">{(variant.conversions ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Conv. Rate</div>
          <div className="font-semibold tabular-nums">{(variant.conversionRate ?? 0).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-muted-foreground">Revenue</div>
          <div className="font-semibold tabular-nums">${(variant.revenue ?? 0).toFixed(0)}</div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="mb-3">
        <ConfidenceBar
          confidence={variant.confidence ?? 0}
          isControl={variant.isControl}
          isLeader={isLeader}
        />
      </div>

      {/* Sample size indicator */}
      {!variant.isControl && sampleRemaining !== null && sampleRemaining > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {(() => {
            const needed = sampleSizeNeeded(variant.visitors ?? 0, variant.conversionRate ?? 0) ?? 0;
            const got = variant.visitors ?? 0;
            if (needed > 10000) {
              return `${got.toLocaleString()} visitors — need more traffic to reach 95% confidence`;
            }
            return `${got.toLocaleString()} of ~${needed.toLocaleString()} visitors needed for 95% confidence`;
          })()}
        </p>
      )}

      {/* Declare Winner button */}
      <div className="flex items-center gap-2 mt-2">
        <Button
          size="sm"
          variant={variant.isControl ? "outline" : (variant.confidence ?? 0) >= 80 ? "default" : "outline"}
          className={`text-xs h-7 gap-1.5 ${
            !variant.isControl && (variant.confidence ?? 0) >= 95 && isLeader
              ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
              : !variant.isControl && (variant.confidence ?? 0) >= 80 && isLeader
              ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
              : ""
          }`}
          onClick={() => setShowDeclareDialog(true)}
          data-testid={`button-declare-winner-${variant.id}`}
        >
          {variant.isControl ? (
            <><Shield className="w-3 h-3" /> Keep Original</>
          ) : (
            <><Trophy className="w-3 h-3" /> Declare Winner</>
          )}
        </Button>
      </div>

      {/* Preview */}
      {showPreview && (
        <HeroPreview
          headline={variant.text}
          subheadline={controlVariant?.text}
          url={campaignUrl}
        />
      )}

      {/* Declare Winner Dialog */}
      <DeclareWinnerDialog
        open={showDeclareDialog}
        onOpenChange={setShowDeclareDialog}
        variant={variant}
        isControl={variant.isControl}
        campaignId={campaignId}
        sectionType={sectionType}
        onDeclared={(winner) => setDeclaredWinner(winner)}
      />
    </div>
  );
}

// ---- Embed code section ----

// Resolve the API base URL for embed code and webhooks.
// In deployed mode, __PORT_5000__ is replaced with the proxy path (e.g. https://sites.pplx.app/.../port/5000).
// In dev mode it falls back to the current origin.
// Public API URL for embed code and webhook URLs.
// This must be accessible from external sites (not the iframe proxy).
// Update this when you move to permanent hosting.
const PUBLIC_API_URL = "https://api.siteamoeba.com";

function getApiBaseUrl(): string {
  return PUBLIC_API_URL;
}

function generateEmbedCodeClient(apiBase: string, campaignId: number, headlineSelector: string, subheadlineSelector: string): string {
  const hSel = headlineSelector || "h1";
  const sSel = subheadlineSelector || "h2";
  // Build the embed script as an array of lines joined together.
  // This avoids literal localStorage/sessionStorage tokens in the bundle
  // which the deployment validator flags (even though this code only runs on the user's external site).
  const LS = ["local", "Storage"].join("");
  const lines = [
    `<!-- SiteAmoeba A/B Test Widget -->`,
    `<script>`,
    `(function(){`,
    `  var API = "${apiBase}";`,
    `  var CID = ${campaignId};`,
    `  var vid = ${LS}.getItem("sa_vid");`,
    `  if (!vid) {`,
    `    vid = "v_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();`,
    `    ${LS}.setItem("sa_vid", vid);`,
    `  }`,
    ``,
    `  function injectVisitorId() {`,
    `    document.querySelectorAll("form").forEach(function(f) {`,
    `      var input = document.createElement("input");`,
    `      input.type = "hidden"; input.name = "ab_visitor_id"; input.value = vid;`,
    `      f.appendChild(input);`,
    `    });`,
    `    document.querySelectorAll('a[href*="checkout"], a[href*="order"]').forEach(function(a) {`,
    `      var url = new URL(a.href, window.location.origin);`,
    `      url.searchParams.set("ab_vid", vid);`,
    `      a.href = url.toString();`,
    `    });`,
    `  }`,
    ``,
    `  fetch(API + "/api/widget/assign?vid=" + vid + "&cid=" + CID + "&ref=" + encodeURIComponent(document.referrer))`,
    `    .then(function(r) { return r.json(); })`,
    `    .then(function(data) {`,
    `      if (data.headline && data.headline.text) {`,
    `        var h1 = document.querySelector('${hSel}') || document.querySelector("h1");`,
    `        if (h1) h1.innerHTML = data.headline.text;`,
    `      }`,
    `      if (data.subheadline && data.subheadline.text) {`,
    `        var sub = document.querySelector('${sSel}') || document.querySelector("h2");`,
    `        if (sub) sub.innerHTML = data.subheadline.text;`,
    `      }`,
    `      injectVisitorId();`,
    `    })`,
    `    .catch(function(e) { console.log("SiteAmoeba: using defaults", e); });`,
    ``,
    `  // Style capture`,
    `  try {`,
    `    var styleElements = {};`,
    `    var selectors = {"h1": "headline", "h2": "subheadline", "h3": "section_header"};`,
    `    var ctaSelectors = ["a.btn", "button.cta", "a.cta", ".hero a", ".hero button", "a[href*='checkout']", "a[href*='order']", ".btn-primary", ".cta-button", ".button", "button[type='submit']"];`,
    `    Object.keys(selectors).forEach(function(sel) {`,
    `      var el = document.querySelector(sel);`,
    `      if (el) {`,
    `        var cs = window.getComputedStyle(el);`,
    `        var bgColor = cs.backgroundColor;`,
    `        if (bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") {`,
    `          var p = el.parentElement;`,
    `          while (p && p !== document.body) { var pcs = window.getComputedStyle(p); if (pcs.backgroundColor !== "transparent" && pcs.backgroundColor !== "rgba(0, 0, 0, 0)") { bgColor = pcs.backgroundColor; break; } p = p.parentElement; }`,
    `          if (bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") bgColor = window.getComputedStyle(document.body).backgroundColor;`,
    `        }`,
    `        styleElements[selectors[sel]] = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, backgroundColor: bgColor, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform };`,
    `      }`,
    `    });`,
    `    for (var i = 0; i < ctaSelectors.length; i++) { var ctaEl = document.querySelector(ctaSelectors[i]); if (ctaEl) { var ctaCs = window.getComputedStyle(ctaEl); styleElements["cta"] = { fontFamily: ctaCs.fontFamily, fontSize: ctaCs.fontSize, fontWeight: ctaCs.fontWeight, color: ctaCs.color, backgroundColor: ctaCs.backgroundColor, textAlign: ctaCs.textAlign, lineHeight: ctaCs.lineHeight, letterSpacing: ctaCs.letterSpacing, textTransform: ctaCs.textTransform, borderRadius: ctaCs.borderRadius, padding: ctaCs.padding }; break; } }`,
    `    if (Object.keys(styleElements).length > 0) { fetch(API + "/api/widget/styles", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({cid: CID, styles: styleElements}) }).catch(function(){}); }`,
    `  } catch(e) {}`,
    ``,
    `  // Behavioral tracking`,
    `  var events = []; var startTime = Date.now(); var maxScroll = 0;`,
    `  var device = window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";`,
    `  var scrollTimeout;`,
    `  window.addEventListener("scroll", function() {`,
    `    clearTimeout(scrollTimeout);`,
    `    scrollTimeout = setTimeout(function() {`,
    `      var depth = Math.round((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100);`,
    `      if (depth > maxScroll) { maxScroll = depth;`,
    `        if (depth >= 25 && depth < 50) events.push({type:"scroll",data:JSON.stringify({depth:25}),ts:Date.now()});`,
    `        else if (depth >= 50 && depth < 75) events.push({type:"scroll",data:JSON.stringify({depth:50}),ts:Date.now()});`,
    `        else if (depth >= 75 && depth < 100) events.push({type:"scroll",data:JSON.stringify({depth:75}),ts:Date.now()});`,
    `        else if (depth >= 100) events.push({type:"scroll",data:JSON.stringify({depth:100}),ts:Date.now()});`,
    `      }`,
    `    }, 200);`,
    `  });`,
    `  if (window.IntersectionObserver) {`,
    `    var sections = document.querySelectorAll("section, [class*='section'], [id*='section'], .container > div, main > div");`,
    `    var obs = new IntersectionObserver(function(entries) { entries.forEach(function(entry) { if (entry.isIntersecting) { var eid = entry.target.id || entry.target.className.split(" ")[0] || "section_" + Array.from(entry.target.parentNode.children).indexOf(entry.target); events.push({type:"section_view",data:JSON.stringify({section:eid}),ts:Date.now()}); obs.unobserve(entry.target); } }); }, {threshold:0.5});`,
    `    sections.forEach(function(s) { obs.observe(s); });`,
    `  }`,
    `  document.addEventListener("click", function(e) { var t = e.target; var tag = t.tagName; var text = (t.innerText||"").substring(0,50); var cls = (t.className||"").substring(0,50); if (tag==="BUTTON"||tag==="A"||t.closest("button")||t.closest("a")) events.push({type:"click",data:JSON.stringify({tag:tag,text:text,class:cls}),ts:Date.now()}); });`,
    `  document.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='wistia']").forEach(function(v) { if (v.tagName==="VIDEO") { v.addEventListener("play",function(){events.push({type:"video_play",data:"{}",ts:Date.now()});}); v.addEventListener("ended",function(){events.push({type:"video_complete",data:"{}",ts:Date.now()});}); } });`,
    `  function sendBatch(batch,timeOnPage) { var payload = JSON.stringify({vid:vid,cid:CID,events:batch,timeOnPage:timeOnPage,maxScroll:maxScroll,device:device}); if (navigator.sendBeacon) { navigator.sendBeacon(API+"/api/widget/events",new Blob([payload],{type:"application/json"})); } else { fetch(API+"/api/widget/events",{method:"POST",headers:{"Content-Type":"application/json"},body:payload,keepalive:true}).catch(function(){}); } }`,
    `  setInterval(function() { if (events.length===0) return; var batch = events.splice(0,events.length); var t = Math.round((Date.now()-startTime)/1000); sendBatch(batch,t); }, 30000);`,
    `  window.addEventListener("beforeunload", function() { var t = Math.round((Date.now()-startTime)/1000); events.push({type:"page_exit",data:JSON.stringify({maxScroll:maxScroll,timeOnPage:t}),ts:Date.now()}); var batch = events.splice(0,events.length); sendBatch(batch,t); });`,
    `})();`,
    `</script>`,
  ];
  return lines.join("\n");
}

// ---- Visitor Feed Panel ----
interface ConversionEntry {
  visitorId: string;
  device: string;
  maxScrollDepth: number;
  timeOnPage: number;
  clickCount: number;
  sectionsViewed: string[];
  converted: boolean;
  convertedAt: string | null;
  revenue: number;
  createdAt: string;
  headlineVariant: string | null;
  headlineIsControl: boolean;
  subheadlineVariant: string | null;
  subheadlineIsControl: boolean;
  referrer: string | null;
}

interface VisitorFeedData {
  recentConversions: ConversionEntry[];
  summary: {
    totalVisitors: number;
    totalBuyers: number;
    totalRevenue: number;
    buyerAvgScroll: number;
    visitorAvgScroll: number;
    buyerAvgTime: number;
    visitorAvgTime: number;
    buyerAvgClicks: number;
    visitorAvgClicks: number;
  };
}

function VisitorFeedPanel({ campaignId }: { campaignId: number }) {
  const [expanded, setExpanded] = useState(true);
  const [expandedBuyer, setExpandedBuyer] = useState<string | null>(null);

  const { data, isLoading } = useQuery<VisitorFeedData>({
    queryKey: ["/api/campaigns", campaignId, "visitor-feed"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/visitor-feed`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const conversions = data?.recentConversions ?? [];
  const s = data?.summary ?? { totalVisitors: 0, totalBuyers: 0, totalRevenue: 0, buyerAvgScroll: 0, visitorAvgScroll: 0, buyerAvgTime: 0, visitorAvgTime: 0, buyerAvgClicks: 0, visitorAvgClicks: 0 };
  const convRate = s.totalVisitors > 0 ? ((s.totalBuyers / s.totalVisitors) * 100).toFixed(1) : "0";

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <Card data-testid="visitor-feed-panel">
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live Activity
          {s.totalBuyers > 0 && (
            <Badge variant="default" className="text-[10px] bg-green-600 hover:bg-green-600 ml-auto">
              {s.totalBuyers} buyer{s.totalBuyers !== 1 ? "s" : ""}
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <>
              {/* Buyer vs Visitor Summary */}
              {s.totalVisitors > 0 && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-bold text-foreground">{s.totalVisitors}</div>
                    <div className="text-[10px] text-muted-foreground">Visitors</div>
                  </div>
                  <div className="rounded-lg border p-2 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
                    <div className="text-lg font-bold text-green-600">{s.totalBuyers}</div>
                    <div className="text-[10px] text-muted-foreground">Buyers</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-bold text-foreground">{convRate}%</div>
                    <div className="text-[10px] text-muted-foreground">Conv. Rate</div>
                  </div>
                </div>
              )}

              {/* Behavior comparison: buyers vs non-buyers */}
              {s.totalBuyers > 0 && s.totalVisitors > s.totalBuyers && (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Buyer vs Visitor Behavior</div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1">Avg Scroll</div>
                      <div className="font-medium text-green-600">{s.buyerAvgScroll}%</div>
                      <div className="text-muted-foreground">{s.visitorAvgScroll}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Avg Time</div>
                      <div className="font-medium text-green-600">{s.buyerAvgTime}s</div>
                      <div className="text-muted-foreground">{s.visitorAvgTime}s</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Avg Clicks</div>
                      <div className="font-medium text-green-600">{s.buyerAvgClicks}</div>
                      <div className="text-muted-foreground">{s.visitorAvgClicks}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Buyers
                    <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 inline-block ml-2" /> Non-buyers
                  </div>
                </div>
              )}

              {/* Recent Conversions */}
              {conversions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Recent Conversions
                  </div>
                  {conversions.map((v, i) => {
                    const isExpanded = expandedBuyer === v.visitorId;
                    return (
                      <div
                        key={v.visitorId + "-" + i}
                        className="rounded-lg border border-green-200 dark:border-green-800/50 overflow-hidden"
                        data-testid={`conversion-row-${i}`}
                      >
                        <div
                          className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setExpandedBuyer(isExpanded ? null : v.visitorId)}
                        >
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 bg-gradient-to-br from-teal-400 to-teal-600">
                            $
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">${v.revenue}</span>
                              <span className="text-xs text-muted-foreground">{timeAgo(v.convertedAt)}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {v.headlineIsControl ? "Control" : "Variant"} headline · {v.device}
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                        </div>

                        {/* Expanded: show variant details + behavior */}
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-0 space-y-2 border-t border-green-100 dark:border-green-900/30">
                            {/* Variant assignments */}
                            <div className="space-y-1.5 pt-2">
                              {v.headlineVariant && (
                                <div className="text-xs">
                                  <span className="text-muted-foreground">Headline: </span>
                                  <span className="font-medium">
                                    {v.headlineVariant.replace(/<[^>]*>/g, "").slice(0, 60)}{v.headlineVariant.replace(/<[^>]*>/g, "").length > 60 ? "…" : ""}
                                  </span>
                                  {v.headlineIsControl && <Badge variant="secondary" className="ml-1 text-[9px] py-0">Control</Badge>}
                                </div>
                              )}
                              {v.subheadlineVariant && (
                                <div className="text-xs">
                                  <span className="text-muted-foreground">Sub: </span>
                                  <span className="font-medium">
                                    {v.subheadlineVariant.replace(/<[^>]*>/g, "").slice(0, 60)}{v.subheadlineVariant.replace(/<[^>]*>/g, "").length > 60 ? "…" : ""}
                                  </span>
                                  {v.subheadlineIsControl && <Badge variant="secondary" className="ml-1 text-[9px] py-0">Control</Badge>}
                                </div>
                              )}
                            </div>
                            {/* Behavior */}
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span>↕ {v.maxScrollDepth}% scroll</span>
                              <span>⏱ {v.timeOnPage}s on page</span>
                              <span>{v.clickCount} clicks</span>
                            </div>
                            {v.referrer && (
                              <div className="text-[10px] text-muted-foreground truncate">
                                From: {v.referrer}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : s.totalVisitors > 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No conversions yet. Buyers will appear here with the variants they saw.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No visitor data yet. Activity will appear once visitors interact with your page.
                </p>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function EmbedCodeSection({ campaignId, headlineSelector, subheadlineSelector }: { campaignId: number; headlineSelector: string; subheadlineSelector: string }) {
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedInline, setCopiedInline] = useState(false);
  const { toast } = useToast();
  const apiBase = getApiBaseUrl();

  // Option 1: single-line script src tag
  const scriptTagCode = `<script src="${apiBase}/api/widget/script/${campaignId}"></script>`;

  // Option 2: full inline code (for users who can't use external script tags)
  const inlineCode = generateEmbedCodeClient(apiBase, campaignId, headlineSelector, subheadlineSelector);

  const handleCopyScript = () => {
    navigator.clipboard.writeText(scriptTagCode).then(() => {
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
      toast({ title: "Copied to clipboard" });
    });
  };

  const handleCopyInline = () => {
    navigator.clipboard.writeText(inlineCode).then(() => {
      setCopiedInline(true);
      setTimeout(() => setCopiedInline(false), 2000);
      toast({ title: "Copied to clipboard" });
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Code2 className="w-4 h-4" />
          Embed Code
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Add to your page's {`<head>`} or just before {`</body>`}.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="script">
          <TabsList className="mb-3 h-8 text-xs">
            <TabsTrigger value="script" className="text-xs" data-testid="tab-embed-script">
              Script tag
              <span className="ml-1.5 text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-medium">Recommended</span>
            </TabsTrigger>
            <TabsTrigger value="inline" className="text-xs" data-testid="tab-embed-inline">
              Inline code
            </TabsTrigger>
          </TabsList>

          {/* Option 1: Script src tag */}
          <TabsContent value="script" className="mt-0">
            <p className="text-xs text-muted-foreground mb-2">
              Single line — the widget loads directly from the server with behavioral tracking included.
            </p>
            <div className="relative">
              <pre
                className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto text-foreground"
                data-testid="text-embed-script-tag"
              >
                {scriptTagCode}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={handleCopyScript}
                data-testid="button-copy-embed-script"
              >
                {copiedScript ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </TabsContent>

          {/* Option 2: Inline code */}
          <TabsContent value="inline" className="mt-0">
            <p className="text-xs text-muted-foreground mb-2">
              Use if your platform doesn't allow external script tags (e.g. some landing page builders).
            </p>
            <div className="relative">
              <pre
                className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto max-h-48 text-foreground"
                data-testid="text-embed-code"
              >
                {inlineCode}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={handleCopyInline}
                data-testid="button-copy-embed"
              >
                {copiedInline ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ---- Conversion Pixel Section ----
function ConversionPixelSection({ campaignId }: { campaignId: number }) {
  const [copied, setCopied] = useState(false);
  const [revenue, setRevenue] = useState("27");
  const [pixelType, setPixelType] = useState<"sale" | "lead">("sale");
  const [revenueMode, setRevenueMode] = useState<"fixed" | "dynamic">("fixed");
  const { toast } = useToast();
  const apiBase = getApiBaseUrl();

  // Build the conversion pixel code
  const storageRef = ["local", "Storage"].join("");
  const pixelComment = pixelType === "sale"
    ? "<!-- SiteAmoeba Conversion Pixel \u2014 Place on your thank-you / confirmation page after purchase -->"
    : "<!-- SiteAmoeba Lead Pixel \u2014 Place on your thank-you page after opt-in / form submission -->";

  let lines: string[];
  if (pixelType === "lead") {
    lines = [
      pixelComment,
      "<script>",
      "(function(){",
      "  var vid = " + storageRef + ".getItem(\"sa_vid\");",
      "  if (vid) {",
      "    var img = new Image();",
      "    img.src = \"" + apiBase + "/api/widget/convert?vid=\" + vid + \"&cid=" + campaignId + "\";",
      "  }",
      "})();",
      "<\/script>",
    ];
  } else if (revenueMode === "fixed") {
    const revParam = revenue && parseFloat(revenue) > 0 ? "&revenue=" + revenue : "";
    lines = [
      pixelComment,
      "<script>",
      "(function(){",
      "  var vid = " + storageRef + ".getItem(\"sa_vid\");",
      "  if (vid) {",
      "    var img = new Image();",
      "    img.src = \"" + apiBase + "/api/widget/convert?vid=\" + vid + \"&cid=" + campaignId + revParam + "\";",
      "  }",
      "})();",
      "<\/script>",
    ];
  } else {
    // Dynamic revenue mode
    lines = [
      pixelComment,
      "<!--",
      "  Set window.sa_revenue BEFORE this script runs.",
      "  Example: <script>window.sa_revenue = 97.00;</script>",
      "  Or read from your checkout system / URL param.",
      "-->",
      "<script>",
      "(function(){",
      "  var vid = " + storageRef + ".getItem(\"sa_vid\");",
      "  if (vid) {",
      "    var amount = window.sa_revenue || 0;",
      "    var img = new Image();",
      "    img.src = \"" + apiBase + "/api/widget/convert?vid=\" + vid + \"&cid=" + campaignId + "&revenue=\" + amount;",
      "  }",
      "})();",
      "<\/script>",
    ];
  }
  const code = lines.join("\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Conversion Pixel
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Paste this on your thank-you or confirmation page to track conversions.
          It reads the visitor ID set by the embed widget and fires a conversion event.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Use <span className="font-medium text-foreground">Sale</span> for purchase pages, <span className="font-medium text-foreground">Lead</span> for opt-in forms, webinar registrations, or any non-purchase conversion.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Pixel type toggle */}
        <div className="flex items-center gap-3">
          <Label className="text-xs whitespace-nowrap">Pixel type</Label>
          <div className="flex rounded-md border border-border overflow-hidden text-xs" data-testid="toggle-pixel-type">
            <button
              className={`px-3 py-1.5 transition-colors ${
                pixelType === "sale"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPixelType("sale")}
              data-testid="button-pixel-type-sale"
            >
              Sale (tracks revenue)
            </button>
            <button
              className={`px-3 py-1.5 border-l border-border transition-colors ${
                pixelType === "lead"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPixelType("lead")}
              data-testid="button-pixel-type-lead"
            >
              Lead capture (tracks opt-ins)
            </button>
          </div>
        </div>

        {/* Revenue input — only shown for Sale type */}
        {pixelType === "sale" && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Label className="text-xs whitespace-nowrap">Revenue</Label>
              <div className="flex rounded-md border border-border overflow-hidden text-xs">
                <button
                  className={`px-3 py-1.5 transition-colors ${
                    revenueMode === "fixed"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setRevenueMode("fixed")}
                >
                  Fixed amount
                </button>
                <button
                  className={`px-3 py-1.5 border-l border-border transition-colors ${
                    revenueMode === "dynamic"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setRevenueMode("dynamic")}
                >
                  Dynamic value
                </button>
              </div>
            </div>
            {revenueMode === "fixed" ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="pixel-revenue" className="text-xs whitespace-nowrap">Sale price ($)</Label>
                <Input
                  id="pixel-revenue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={revenue}
                  onChange={(e) => setRevenue(e.target.value)}
                  className="w-24 h-8 text-xs"
                  placeholder="0"
                  data-testid="input-pixel-revenue"
                />
                <span className="text-xs text-muted-foreground">per conversion</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set <code className="bg-muted px-1 py-0.5 rounded text-foreground">window.sa_revenue = 97.00</code> before the pixel script runs.
                Works with any checkout system — Stripe, ThriveCart, ClickFunnels, etc.
              </p>
            )}
          </div>
        )}

        <div className="relative">
          <pre
            className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto max-h-48 text-foreground"
            data-testid="text-conversion-pixel"
          >
            {code}
          </pre>
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-2 right-2"
            onClick={handleCopy}
            data-testid="button-copy-conversion-pixel"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Stripe Webhook Section ----
function WebhookSection({ campaignId }: { campaignId: number }) {
  const [copied, setCopied] = useState(false);
  const apiBase = getApiBaseUrl();
  const url = `${apiBase}/api/webhook/stripe/${campaignId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Webhook className="w-4 h-4" />
          Stripe Webhook URL
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Add this URL as a Stripe webhook endpoint to track revenue conversions.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 bg-muted rounded-md px-3 py-2 text-xs font-mono text-foreground truncate"
            data-testid="text-webhook-url"
          >
            {url}
          </code>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCopy}
            data-testid="button-copy-webhook"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Daily chart ----
function DailyChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-foreground mb-1">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums text-foreground">{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function DailyChart({ campaignId }: { campaignId: number }) {
  const { data = [] } = useQuery<DailyStat[]>({
    queryKey: ["/api/campaigns", campaignId, "stats", "daily"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/stats/daily?days=30`);
      return res.json();
    },
  });

  const isEmpty = data.length === 0 || data.every((d) => d.visitors === 0 && d.conversions === 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Daily Activity (30 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground" data-testid="chart-daily">
            No data yet — traffic will appear here once your embed script receives visitors.
          </div>
        ) : (
          <div className="h-64" data-testid="chart-daily">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 2, left: -16 }}>
                <defs>
                  <linearGradient id="visitorsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(160, 84%, 36%)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(160, 84%, 36%)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => v.slice(5)}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                />
                <Tooltip content={<DailyChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="visitors"
                  name="Visitors"
                  fill="url(#visitorsGradient)"
                  stroke="transparent"
                  legendType="none"
                />
                <Bar dataKey="visitors" name="Visitors" radius={[3, 3, 0, 0]} fill="hsl(160, 84%, 36%)" opacity={0.85} barSize={8} />
                <Line
                  type="monotone"
                  dataKey="conversions"
                  name="Conversions"
                  stroke="hsl(38, 92%, 50%)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Category Config ----
type CategoryConfig = {
  icon: React.ElementType;
  color: string;
  bg: string;
  label: string;
};

function getCategoryConfig(category: string): CategoryConfig {
  const configs: Record<string, CategoryConfig> = {
    headline: {
      icon: Type,
      color: "hsl(217, 91%, 60%)",
      bg: "hsl(217, 91%, 60% / 0.10)",
      label: "Headline",
    },
    subheadline: {
      icon: AlignLeft,
      color: "hsl(160, 84%, 36%)",
      bg: "hsl(160, 84%, 36% / 0.10)",
      label: "Sub-Headline",
    },
    cta: {
      icon: MousePointerClick,
      color: "hsl(38, 92%, 50%)",
      bg: "hsl(38, 92%, 50% / 0.10)",
      label: "Call to Action",
    },
    social_proof: {
      icon: Star,
      color: "hsl(280, 70%, 55%)",
      bg: "hsl(280, 70%, 55% / 0.10)",
      label: "Social Proof",
    },
    faq: {
      icon: HelpCircle,
      color: "hsl(200, 80%, 50%)",
      bg: "hsl(200, 80%, 50% / 0.10)",
      label: "FAQ",
    },
    features: {
      icon: ListOrdered,
      color: "hsl(142, 71%, 45%)",
      bg: "hsl(142, 71%, 45% / 0.10)",
      label: "Features",
    },
    image: {
      icon: ImageIcon,
      color: "hsl(340, 80%, 55%)",
      bg: "hsl(340, 80%, 55% / 0.10)",
      label: "Image",
    },
    pricing: {
      icon: DollarSign,
      color: "hsl(142, 71%, 45%)",
      bg: "hsl(142, 71%, 45% / 0.10)",
      label: "Pricing",
    },
    nav: {
      icon: LayoutList,
      color: "hsl(220, 50%, 50%)",
      bg: "hsl(220, 50%, 50% / 0.10)",
      label: "Navigation",
    },
  };
  return configs[category] ?? {
    icon: TextCursorInput,
    color: "hsl(160, 84%, 36%)",
    bg: "hsl(160, 84%, 36% / 0.10)",
    label: category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

function getTestMethodConfig(method: string): { icon: React.ElementType; label: string; color: string } {
  switch (method) {
    case "text_swap":
      return { icon: TextCursorInput, label: "Text Swap", color: "hsl(217, 91%, 60%)" };
    case "visibility_toggle":
      return { icon: ToggleLeft, label: "Visibility Toggle", color: "hsl(280, 70%, 55%)" };
    case "reorder":
      return { icon: ArrowUpDown, label: "Reorder", color: "hsl(38, 92%, 50%)" };
    case "not_testable":
      return { icon: ImageIcon, label: "Preview Only", color: "hsl(0, 0%, 55%)" };
    default:
      return { icon: FlaskConical, label: method, color: "hsl(160, 84%, 36%)" };
  }
}

// ---- Test Section Card ----
function TestSectionCard({
  section,
  campaignId,
  campaignUrl,
  variants,
  allSections,
  statsLoading,
  userPlan,
}: {
  section: TestSection;
  campaignId: number;
  campaignUrl: string;
  variants: VariantStats[];
  allSections?: TestSection[];
  statsLoading: boolean;
  userPlan: string;
}) {
  const [expanded, setExpanded] = useState(section.isActive);
  const { toast } = useToast();
  const catConfig = getCategoryConfig(section.category);
  const methodConfig = getTestMethodConfig(section.testMethod);
  const CatIcon = catConfig.icon;
  const MethodIcon = methodConfig.icon;

  // Filter variants by test_section_id when available, fall back to type-based matching
  const sectionVariants = variants
    .filter((v) => {
      // If variant has a testSectionId, match by section ID (precise)
      if (v.testSectionId) return v.testSectionId === section.id;
      // Fall back to type-based match for legacy variants without testSectionId
      // But only if there's exactly one section of this type (no ambiguity)
      const sameCategorySections = allSections?.filter(s => s.category === section.category) || [];
      if (sameCategorySections.length <= 1) return v.type === section.category;
      // Multiple sections of same type and no testSectionId — don't show (ambiguous)
      return false;
    })
    .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));

  const controlVariant = sectionVariants.find((v) => v.isControl);
  const leaderVariant = sectionVariants[0];
  const isNotTestable = section.testMethod === "not_testable";

  const toggleMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const res = await apiRequest("PATCH", `/api/sections/${section.id}`, { isActive: active });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update section");
      }
      return res.json();
    },
    onSuccess: (_data, active) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "sections"] });
      if (active) setExpanded(true);
      toast({
        title: active ? "Section activated" : "Section deactivated",
        description: section.label,
      });
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^\d+:\s*/, "");
      const isConcurrentLimit = msg.includes("concurrent test limit");
      toast({
        title: "Cannot activate section",
        description: isConcurrentLimit ? (
          <span>
            {msg}{" "}
            <a href="/#/billing" className="underline font-medium">Upgrade your plan</a> to run more tests.
          </span>
        ) as any : msg,
        variant: "destructive",
      });
    },
  });

  return (
    <Card
      className="overflow-hidden"
      data-testid={`card-test-section-${section.id}`}
    >
      {/* Section header */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer select-none"
        onClick={() => !isNotTestable && setExpanded((v) => !v)}
      >
        {/* Category icon */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: catConfig.bg }}
        >
          <CatIcon className="w-4 h-4" style={{ color: catConfig.color }} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Label + badges row */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground truncate">{section.label}</span>
            <Badge
              variant="secondary"
              className="text-xs gap-1 shrink-0"
              style={{ color: catConfig.color }}
            >
              <CatIcon className="w-2.5 h-2.5" />
              {catConfig.label}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs gap-1 shrink-0"
              style={{ color: methodConfig.color, borderColor: `${methodConfig.color}44` }}
            >
              <MethodIcon className="w-2.5 h-2.5" />
              {methodConfig.label}
            </Badge>
            {sectionVariants.length > 0 && (
              <Badge variant="secondary" className="text-xs shrink-0">
                {sectionVariants.length} {sectionVariants.length === 1 ? "variant" : "variants"}
              </Badge>
            )}
          </div>
          {/* Purpose */}
          {section.purpose && (
            <p className="text-xs text-muted-foreground leading-relaxed">{section.purpose}</p>
          )}
        </div>

        {/* Right side: toggle + expand */}
        <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
          {isNotTestable ? (
            <span className="text-xs text-muted-foreground italic">Preview only</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {section.isActive ? "Active" : "Inactive"}
              </span>
              <Switch
                checked={section.isActive}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                disabled={toggleMutation.isPending}
                data-testid={`toggle-section-${section.id}`}
                aria-label={section.isActive ? "Deactivate section" : "Activate section"}
              />
            </div>
          )}
          {!isNotTestable && (
            <button
              className="text-muted-foreground hover:text-foreground"
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {!isNotTestable && expanded && (
        <div className="border-t border-border">
          <CardContent className="pt-4">
            {/* Control text from scan */}
            {section.currentText && (
              <div className="mb-4 p-3 rounded-lg bg-muted/40 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs gap-1">
                    <Shield className="w-2.5 h-2.5" /> Control
                  </Badge>
                  <span className="text-xs text-muted-foreground">Original text from scan</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{section.currentText}</p>
              </div>
            )}

            {/* Existing variants */}
            {statsLoading ? (
              <div className="space-y-3 mb-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : sectionVariants.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground mb-4">
                No variants yet. Generate some below.
              </div>
            ) : (
              <div className="space-y-3 mb-4">
                {sectionVariants.map((variant, i) => (
                  <VariantCard
                    key={variant.id}
                    variant={variant}
                    rank={i + 1}
                    isLeader={variant.id === leaderVariant?.id && sectionVariants.length > 1}
                    campaignId={campaignId}
                    campaignUrl={campaignUrl}
                    controlVariant={controlVariant}
                    sectionType={section.category}
                    elementStyles={section.elementStyles}
                  />
                ))}
              </div>
            )}

            {/* AI variant generator for this section */}
            <AddVariantForm
              campaignId={campaignId}
              type={section.category}
              sectionId={section.id}
              userPlan={userPlan}
              onAdded={() =>
                queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] })
              }
            />

            {/* Activate prompt if inactive */}
            {!section.isActive && (
              <div className="flex items-center gap-3 pt-2">
                <p className="text-xs text-muted-foreground flex-1">
                  Activate this section to start A/B testing and adding variants.
                </p>
                <Button
                  size="sm"
                  onClick={() => toggleMutation.mutate(true)}
                  disabled={toggleMutation.isPending}
                  data-testid={`button-activate-section-${section.id}`}
                >
                  {toggleMutation.isPending ? "Activating..." : "Activate Test"}
                </Button>
              </div>
            )}
          </CardContent>
        </div>
      )}
    </Card>
  );
}

// ---- Variant Section ----
function VariantSection({
  title,
  icon: Icon,
  type,
  campaignId,
  campaignUrl,
  variants,
  isLoading,
  userPlan,
}: {
  title: string;
  icon: React.ElementType;
  type: string;
  campaignId: number;
  campaignUrl: string;
  variants: VariantStats[];
  isLoading: boolean;
  userPlan: string;
}) {
  const typeVariants = variants
    .filter((v) => v.type === type)
    .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));

  const controlVariant = typeVariants.find((v) => v.isControl);
  const leaderVariant = typeVariants[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4" />
          {title}
          <Badge variant="secondary" className="text-xs ml-auto">
            {typeVariants.length} {typeVariants.length === 1 ? "variant" : "variants"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : typeVariants.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No variants yet. Add one below.
          </div>
        ) : (
          <div className="space-y-3">
            {typeVariants.map((variant, i) => (
              <VariantCard
                key={variant.id}
                variant={variant}
                rank={i + 1}
                isLeader={variant.id === leaderVariant?.id && typeVariants.length > 1}
                campaignId={campaignId}
                campaignUrl={campaignUrl}
                controlVariant={type === "subheadline" ? undefined : controlVariant}
                sectionType={type}
              />
            ))}
          </div>
        )}
        <AddVariantForm
          campaignId={campaignId}
          type={type}
          userPlan={userPlan}
          onAdded={() =>
            queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] })
          }
        />
      </CardContent>
    </Card>
  );
}

// ---- Brain Chat ----

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "What should I test next?",
  "How can I improve my conversion rate?",
  "What's missing from my page?",
  "Analyze my test results",
  "Suggest copy for my guarantee section",
];

// Simple markdown-to-HTML renderer (handles bold, bullets, headers)
function renderMarkdown(text: string): string {
  return text
    // Headers — visibly larger and bolder
    .replace(/^### (.+)$/gm, "<h4 class=\"font-semibold text-sm mt-3 mb-1 text-foreground\">$1</h4>")
    .replace(/^## (.+)$/gm, "<h3 class=\"font-bold text-base mt-3 mb-1 text-foreground\">$1</h3>")
    .replace(/^# (.+)$/gm, "<h2 class=\"font-bold text-base mt-3 mb-1 text-foreground\">$1</h2>")
    // Bold — visibly darker/bolder
    .replace(/\*\*(.+?)\*\*/g, "<strong class=\"font-semibold text-foreground\">$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Bullet points
    .replace(/^- (.+)$/gm, "<li class=\"ml-4 list-disc leading-relaxed\">$1</li>")
    // Paragraph spacing
    .replace(/\n\n/g, "</p><p class=\"mt-2 leading-relaxed\">")
    .replace(/\n/g, "<br />");
}

// ---- Category badge config ----
const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  scroll_behavior:    { label: "Scroll Behavior",    color: "hsl(217 91% 60%)",  bg: "hsl(217 91% 60% / 0.12)" },
  conversion_pattern: { label: "Conversion Pattern", color: "hsl(142 71% 45%)",  bg: "hsl(142 71% 45% / 0.12)" },
  section_engagement: { label: "Section Engagement", color: "hsl(270 67% 58%)",  bg: "hsl(270 67% 58% / 0.12)" },
  traffic_quality:    { label: "Traffic Quality",    color: "hsl(38 92% 50%)",   bg: "hsl(38 92% 50% / 0.12)" },
  test_performance:   { label: "Test Performance",   color: "hsl(174 72% 40%)",  bg: "hsl(174 72% 40% / 0.12)" },
};

function CategoryBadge({ category }: { category: string }) {
  const cfg = CATEGORY_CONFIG[category] ?? { label: category, color: "hsl(215 20% 55%)", bg: "hsl(215 20% 55% / 0.12)" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color: cfg.color, background: cfg.bg }}
      data-testid={`badge-category-${category}`}
    >
      {cfg.label}
    </span>
  );
}

// ---- DailyObservationCard ----
function DailyObservationCard({ campaignId, isPaidUser }: { campaignId: number; isPaidUser: boolean }) {
  const { toast } = useToast();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const { data, isLoading, refetch } = useQuery<{
    observations: DailyObservation[];
    isPaidUser: boolean;
    hasTodayObservation: boolean;
    categoryLabels: Record<string, string>;
  }>({
    queryKey: ["/api/campaigns", campaignId, "observations"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/observations`);
      if (!res.ok) throw new Error("Failed to load observations");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/observations/generate`, {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate observation");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "observations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({
        title: "Observation Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const observations = data?.observations ?? [];
  const latestObservation = observations[0];
  const historyObservations = observations.slice(1, 6);
  const today = new Date().toISOString().slice(0, 10);
  const hasTodayObservation = latestObservation?.createdAt?.slice(0, 10) === today;
  const isStale = latestObservation && !hasTodayObservation;
  const effectiveIsPaid = data?.isPaidUser ?? isPaidUser;

  // --- Locked / upgrade state (free non-BYOK users) ---
  if (!effectiveIsPaid) {
    return (
      <Card
        className="relative overflow-hidden"
        data-testid="card-daily-observation-locked"
        style={{
          background: "linear-gradient(135deg, hsl(160 84% 36% / 0.04) 0%, hsl(217 91% 60% / 0.04) 100%)",
          border: "1px solid hsl(160 84% 36% / 0.25)",
        }}
      >
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: "hsl(160 84% 36% / 0.12)" }}
            >
              <Lock className="w-4 h-4" style={{ color: "hsl(160 84% 36%)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground">Daily Observation</span>
                <CategoryBadge category="scroll_behavior" />
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Daily Observations available — Upgrade to see behavioral insights about your visitors
              </p>
              {/* Blurred teaser */}
              <div className="relative mb-4" aria-hidden="true">
                <p
                  className="text-sm text-foreground leading-relaxed select-none"
                  style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}
                >
                  68% of your visitors stop scrolling before reaching your guarantee section. Converters scroll
                  29% deeper on average, suggesting the guarantee is only seen by already-interested buyers.
                  Move your guarantee above the pricing block to expose it to colder traffic.
                </p>
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(90deg, transparent 0%, hsl(var(--background)) 85%)",
                  }}
                />
              </div>
              <a
                href="/#/billing"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md text-white"
                style={{ background: "hsl(160 84% 36%)" }}
                data-testid="link-observation-upgrade"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Upgrade to Unlock
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <Card data-testid="card-daily-observation-loading">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-3">
            <Skeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="relative overflow-hidden"
      data-testid="card-daily-observation"
      style={{
        background: "linear-gradient(135deg, hsl(270 67% 58% / 0.04) 0%, hsl(217 91% 60% / 0.04) 100%)",
        border: "1px solid hsl(270 67% 58% / 0.25)",
      }}
    >
      <CardContent className="pt-5 pb-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "hsl(270 67% 58% / 0.12)" }}
          >
            <Lightbulb className="w-4 h-4" style={{ color: "hsl(270 67% 58%)" }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-sm font-semibold text-foreground">
                {hasTodayObservation ? "Today's Insight" : "Daily Insight"}
              </span>
              {latestObservation && <CategoryBadge category={latestObservation.category} />}
              {isStale && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                  {latestObservation.createdAt?.slice(0, 10)}
                </Badge>
              )}
              {!latestObservation && (
                <span className="text-xs text-muted-foreground">No observations yet</span>
              )}
            </div>

            {/* Observation text */}
            {latestObservation ? (
              <div>
                {isStale && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-1.5">
                    This insight is from a previous day. Generate a fresh one.
                  </p>
                )}
                <p
                  className={`text-sm leading-relaxed ${isStale ? "text-muted-foreground" : "text-foreground"}`}
                  data-testid="text-observation-content"
                >
                  {latestObservation.observation}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Generate your first behavioral insight. Uses 1 credit.
              </p>
            )}

            {/* Generate / regenerate button */}
            <div className="mt-3 flex items-center gap-3">
              {!hasTodayObservation && (
                <button
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md text-white disabled:opacity-60 transition-opacity"
                  style={{ background: "hsl(270 67% 58%)" }}
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  data-testid="button-generate-observation"
                >
                  {generateMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" /> {latestObservation ? "Generate new insight" : "Generate today's insight"}</>
                  )}
                </button>
              )}
              {hasTodayObservation && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(142 71% 45%)" }} />
                  Today's insight generated
                </span>
              )}

              {/* View history toggle */}
              {historyObservations.length > 0 && (
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
                  onClick={() => setHistoryExpanded(v => !v)}
                  data-testid="button-toggle-observation-history"
                >
                  <History className="w-3.5 h-3.5" />
                  {historyExpanded ? "Hide history" : `View past insights (${historyObservations.length})`}
                  {historyExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* History section */}
        {historyExpanded && historyObservations.length > 0 && (
          <div
            className="mt-4 pt-4 space-y-3"
            style={{ borderTop: "1px solid hsl(270 67% 58% / 0.2)" }}
            data-testid="section-observation-history"
          >
            {historyObservations.map((obs) => (
              <div key={obs.id} className="flex items-start gap-2.5" data-testid={`observation-history-item-${obs.id}`}>
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0 mt-2"
                  style={{
                    background: CATEGORY_CONFIG[obs.category]?.color ?? "hsl(215 20% 55%)",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <CategoryBadge category={obs.category} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(obs.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {obs.observation}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BrainChat({ campaignId, llmConfigured }: { campaignId: number; llmConfigured: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "I'm the SiteAmoeba Brain. I have your page analysis and test results. Ask me anything about optimizing your conversions.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if (!text || isTyping) return;

    if (!llmConfigured) {
      toast({
        title: "AI not configured",
        description: "Configure your AI provider in Settings to use Brain Chat.",
        variant: "destructive",
      });
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsTyping(true);

    // Scroll after adding user message
    setTimeout(scrollToBottom, 50);

    try {
      const res = await apiRequest("POST", "/api/ai/brain-chat", {
        campaignId,
        message: text,
        history: newMessages.slice(1, -1).map(m => ({ role: m.role, content: m.content })),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Brain chat failed");
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.response }]);
    } catch (err: any) {
      toast({
        title: "Brain Chat Error",
        description: err.message,
        variant: "destructive",
      });
      // Remove the user message if request failed
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsTyping(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length <= 1; // only welcome message

  return (
    <>
      {/* Floating button */}
      <button
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-white text-sm font-medium transition-all hover:scale-105 hover:shadow-xl"
        style={{ background: "hsl(160, 84%, 36%)" }}
        onClick={() => setIsOpen(true)}
        aria-label="Chat with Brain"
        data-testid="button-brain-chat-open"
        title="Chat with Brain"
      >
        <Bot className="w-4 h-4" />
        <span>Chat with Brain</span>
        {isOpen && <X className="w-3.5 h-3.5 ml-1" />}
      </button>

      {/* Slide-out panel */}
      {isOpen && (
        <div
          className="fixed inset-y-0 right-0 z-50 flex flex-col bg-background border-l border-border shadow-2xl"
          style={{ width: "min(420px, 100vw)" }}
          data-testid="panel-brain-chat"
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-border"
            style={{ background: "hsl(160, 84%, 36%)" }}
          >
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-white" />
              <span className="text-sm font-semibold text-white">Brain</span>
              <span className="text-xs text-white/70">CRO Expert</span>
            </div>
            <button
              className="text-white/80 hover:text-white transition-colors"
              onClick={() => setIsOpen(false)}
              aria-label="Close Brain Chat"
              data-testid="button-brain-chat-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* No LLM configured warning */}
          {!llmConfigured && (
            <div className="mx-3 mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
              Configure your AI provider in{" "}
              <a href="/#/settings" className="underline font-medium">Settings</a>{" "}
              to use Brain Chat.
            </div>
          )}

          {/* Messages area */}
          <ScrollArea className="flex-1 px-4 py-3 bg-background">
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                  data-testid={`chat-message-${i}`}
                >
                  {msg.role === "assistant" && (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: "hsl(160, 84%, 36%)"}}
                    >
                      <Bot className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  <div
                    className={`rounded-lg px-3 py-2.5 max-w-[85%] ${
                      msg.role === "user"
                        ? "text-primary-foreground bg-primary rounded-tr-sm text-sm leading-relaxed"
                        : "text-foreground bg-muted rounded-tl-sm text-sm leading-relaxed"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div
                        className="max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex gap-2 flex-row">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "hsl(160, 84%, 36%)" }}
                  >
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-muted rounded-lg rounded-tl-sm px-3 py-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Suggested prompts (when chat is empty / only welcome msg) */}
          {isEmpty && (
            <div className="px-4 pb-2">
              <p className="text-xs text-muted-foreground mb-2">Suggested questions:</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    className="text-xs px-2.5 py-1 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                    onClick={() => sendMessage(prompt)}
                    data-testid={`chip-suggested-prompt-${prompt.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the Brain anything..."
                className="flex-1 min-h-[44px] max-h-32 resize-none text-sm border border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
                rows={1}
                data-testid="input-brain-chat"
              />
              <Button
                size="icon"
                className="shrink-0 h-11 w-11"
                onClick={() => sendMessage()}
                disabled={!input.trim() || isTyping}
                style={{ background: "hsl(160, 84%, 36%)" }}
                data-testid="button-brain-chat-send"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Press <kbd className="px-1 py-0.5 text-xs bg-muted rounded border border-border font-mono">Enter</kbd> to send, <kbd className="px-1 py-0.5 text-xs bg-muted rounded border border-border font-mono">Shift+Enter</kbd> for new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Page loading skeleton ----
function PageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-5 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ---- Main page ----
export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const campaignId = parseInt(id);
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [, navigate] = useLocation();
  const [brainBannerDismissed, setBrainBannerDismissed] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const userPlan = user?.plan ?? "free";
  const { toast } = useToast();

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/archive`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Campaign archived", description: "You can unarchive it from the campaigns list." });
      navigate("/");
    },
    onError: (err: any) => {
      toast({ title: "Archive failed", description: err.message || "Could not archive campaign.", variant: "destructive" });
    },
  });

  if (!authLoading && !isAuthenticated) {
    navigate("/auth");
    return null;
  }

  const { data: campaign, isLoading: campaignLoading } = useQuery<Campaign>({
    queryKey: ["/api/campaigns", campaignId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}`);
      return res.json();
    },
    enabled: isAuthenticated && !isNaN(campaignId),
  });

  const { data: stats, isLoading: statsLoading, isFetching: statsFetching, refetch: refetchStats } = useQuery<CampaignStats>({
    queryKey: ["/api/campaigns", campaignId, "stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/stats`);
      return res.json();
    },
    enabled: isAuthenticated && !isNaN(campaignId),
  });

  const { data: testSections = [] } = useQuery<TestSection[]>({
    queryKey: ["/api/campaigns", campaignId, "sections"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/sections`);
      return res.json();
    },
    enabled: isAuthenticated && !isNaN(campaignId),
  });

  const handleRefresh = () => {
    refetchStats();
    queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats", "daily"] });
    queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
    queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "sections"] });
    queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
  };

  if (campaignLoading || authLoading) {
    return <PageSkeleton />;
  }

  if (!campaign) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Campaign not found.
      </div>
    );
  }

  const variants: VariantStats[] = stats?.variants ?? [];
  const creditsUsed = Math.floor((stats?.totalVisitors ?? 0) / 100);

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/" data-testid="link-breadcrumb-campaigns">Campaigns</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="w-3.5 h-3.5" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage data-testid="text-breadcrumb-campaign-name">
                {campaign.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchiveDialog(true)}
            data-testid="button-archive-campaign"
            className="gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
          >
            <Archive className="w-3.5 h-3.5" />
            Archive
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={statsFetching}
            data-testid="button-refresh-stats"
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statsFetching ? "animate-spin" : ""}`} />
            {statsFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Archive Confirmation Dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent data-testid="dialog-archive-campaign">
          <DialogHeader>
            <DialogTitle>Archive Campaign?</DialogTitle>
            <DialogDescription>
              Archiving this campaign will stop all active tests. You can unarchive it later from the campaigns list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowArchiveDialog(false)}
              disabled={archiveMutation.isPending}
              data-testid="button-archive-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              data-testid="button-archive-confirm"
            >
              {archiveMutation.isPending ? "Archiving..." : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Brain upgrade banner — dismissible, free users only */}
        {userPlan === "free" && !brainBannerDismissed && (
          <div
            className="flex items-center gap-3 rounded-lg px-4 py-3 relative"
            style={{
              background: "linear-gradient(90deg, hsl(160 84% 36% / 0.07) 0%, hsl(160 84% 36% / 0.02) 100%)",
              border: "1px solid hsl(160 84% 36% / 0.18)",
            }}
            data-testid="banner-brain-upgrade"
          >
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: "hsl(160 84% 36%)" }} />
            <p className="flex-1 text-xs text-foreground">
              This campaign is running on standard AI.{" "}
              <span className="text-muted-foreground">
                Upgrade to Brain-powered testing for variants proven to convert.
              </span>
            </p>
            <a
              href="/#/billing"
              className="text-xs font-semibold underline underline-offset-2 shrink-0"
              style={{ color: "hsl(160 84% 36%)" }}
              data-testid="link-brain-banner-upgrade"
            >
              Upgrade
            </a>
            <button
              className="ml-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={() => setBrainBannerDismissed(true)}
              aria-label="Dismiss"
              data-testid="button-dismiss-brain-banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Visitors"
            value={(stats?.totalVisitors ?? 0).toLocaleString()}
            icon={Users}
            accentColor="hsl(160, 84%, 36%)"
            iconBg="hsl(160, 84%, 36% / 0.12)"
          />
          <KPICard
            label="Conversions"
            value={(stats?.totalConversions ?? 0).toLocaleString()}
            icon={TrendingUp}
            accentColor="hsl(217, 91%, 60%)"
            iconBg="hsl(217, 91%, 60% / 0.12)"
          />
          <KPICard
            label="Conv. Rate"
            value={`${(stats?.conversionRate ?? 0).toFixed(1)}%`}
            icon={Zap}
            accentColor="hsl(38, 92%, 50%)"
            iconBg="hsl(38, 92%, 50% / 0.12)"
          />
          <KPICard
            label="Revenue"
            value={`$${(stats?.totalRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            icon={DollarSign}
            accentColor="hsl(142, 71%, 45%)"
            iconBg="hsl(142, 71%, 45% / 0.12)"
          />
        </div>

        {/* Daily Observation Card */}
        <DailyObservationCard
          campaignId={campaignId}
          isPaidUser={userPlan !== "free" || !!(user?.llmProvider && user?.llmApiKey)}
        />

        {/* Variant comparison chart */}
        <VariantComparisonChart variants={variants} testSections={testSections} isLoading={statsLoading} />

        {/* Daily chart */}
        <DailyChart campaignId={campaignId} />

        {/* Live Visitor Feed — positioned high for visibility */}
        <VisitorFeedPanel campaignId={campaignId} />

        {/* Variant sections — dynamic (scanner campaigns) or legacy (old campaigns) */}
        {testSections.length > 0 ? (
          <div className="space-y-3">
            {/* Autopilot panel — shown above test sections for scanner campaigns */}
            <AutopilotPanel
              campaignId={campaignId}
              userPlan={userPlan}
              minVisitorsPerVariant={user?.minVisitorsPerVariant ?? 100}
            />

            <div className="flex items-center gap-2 mt-4">
              <FlaskConical className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Test Sections</h3>
              <Badge variant="secondary" className="text-xs">
                {testSections.filter((s) => s.isActive).length} active
                {" / "}
                {testSections.length} total
              </Badge>
            </div>
            {[...testSections].sort((a, b) => (a.testPriority ?? 99) - (b.testPriority ?? 99)).map((section) => (
              <TestSectionCard
                key={section.id}
                section={section}
                campaignId={campaignId}
                campaignUrl={campaign.url}
                variants={variants}
                allSections={testSections}
                statsLoading={statsLoading}
                userPlan={userPlan}
              />
            ))}
          </div>
        ) : (
          <>
            <VariantSection
              title="Hero Headlines"
              icon={Type}
              type="headline"
              campaignId={campaignId}
              campaignUrl={campaign.url}
              variants={variants}
              isLoading={statsLoading}
              userPlan={userPlan}
            />

            <VariantSection
              title="Sub-Headlines"
              icon={AlignLeft}
              type="subheadline"
              campaignId={campaignId}
              campaignUrl={campaign.url}
              variants={variants}
              isLoading={statsLoading}
              userPlan={userPlan}
            />
          </>
        )}

        {/* Embed code */}
        <EmbedCodeSection campaignId={campaignId} headlineSelector={campaign?.headlineSelector || "h1"} subheadlineSelector={campaign?.subheadlineSelector || "h2"} />

        {/* Conversion pixel */}
        <ConversionPixelSection campaignId={campaignId} />

        {/* Webhook */}
        <WebhookSection campaignId={campaignId} />
      </div>

      {/* Brain Chat floating panel */}
      <BrainChat
        campaignId={campaignId}
        llmConfigured={!!user?.llmProvider}
      />
    </div>
  );
}
