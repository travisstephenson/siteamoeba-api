import React, { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  Globe,
  Users,
  TrendingUp,
  BarChart2,
  FlaskConical,
  Layers,
  ArrowRight,
  Search,
  Loader2,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Sparkles,
  Tag,
  Star,
  Check,
  X,
  ScanLine,
  FileText,
  MousePointerClick,
  ShieldCheck,
  Gift,
  HelpCircle,
  MessageSquare,
  ImageIcon,
  DollarSign,
  ThumbsUp,
  BookOpen,
  Zap,
  Rocket,
  Type,
  Eye,
  ArrowUpDown,
  Trophy,
  TrendingDown,
  ArchiveRestore,
  Archive,
  CheckCircle2,
  Activity,
  BarChart3,
  TrendingUp as TrendingUpIcon,
  Settings,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ============================================================
// TYPES
// ============================================================

interface CampaignWithStats {
  id: number;
  name: string;
  url: string;
  isActive: boolean;
  status: string; // 'active' | 'archived' | 'completed'
  archivedAt?: string | null;
  totalVisitors: number;
  totalConversions: number;
  totalRevenue: number;
  conversionRate: number;
  variantCount: number;
  headlineSelector: string | null;
  subheadlineSelector: string | null;
}

interface DashboardStats {
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
  activeTests: Array<{
    campaignId: number;
    campaignName: string;
    sectionLabel: string;
    sectionCategory: string;
    visitors: number;
    controlCR: number;
    challengerCR: number;
    lift: number;
    confidence: number;
    status: 'collecting' | 'testing' | 'promising' | 'winner';
  }>;
}

interface ScannedSection {
  id: string;
  label: string;
  purpose: string;
  selector: string;
  currentText: string;
  contentLength?: number;
  testPriority: number;
  category: string;
  testMethod?: string;
}

interface ScanResult {
  pageName: string;
  pageType: string;
  sections: ScannedSection[];
}

// ============================================================
// CATEGORY CONFIG
// ============================================================

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  headline:     { label: "Headline",      icon: FileText,          color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20" },
  subheadline:  { label: "Sub-headline",  icon: FileText,          color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
  cta:          { label: "CTA",           icon: MousePointerClick, color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  social_proof: { label: "Social Proof",  icon: ThumbsUp,          color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  guarantee:    { label: "Guarantee",     icon: ShieldCheck,       color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" },
  product_stack:{ label: "Product Stack", icon: Layers,            color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20" },
  bonus:        { label: "Bonus",         icon: Gift,              color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" },
  hero_journey: { label: "Hero Journey",  icon: BookOpen,          color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  pricing:      { label: "Pricing",       icon: DollarSign,        color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  faq:          { label: "FAQ",           icon: HelpCircle,        color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" },
  testimonials: { label: "Testimonials",  icon: MessageSquare,     color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
  body_copy:    { label: "Body Copy",     icon: FileText,          color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" },
  image:        { label: "Image",         icon: ImageIcon,         color: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20" },
};

function getCategoryConfig(category: string) {
  return CATEGORY_CONFIG[category] || { label: category, icon: Tag, color: "bg-muted text-muted-foreground border-border" };
}

// ============================================================
// QUICK CREATE FORM SCHEMA (legacy fallback)
// ============================================================

const quickCreateSchema = z.object({
  name: z.string().min(1, "Campaign name is required"),
  url: z.string().url("Enter a valid URL including https://"),
  headlineSelector: z.string().optional(),
  subheadlineSelector: z.string().optional(),
});

type QuickCreateValues = z.infer<typeof quickCreateSchema>;

// ============================================================
// SKELETON & EMPTY STATE
// ============================================================

function CampaignCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-4 w-56 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <FlaskConical className="w-8 h-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-2">No campaigns yet</h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Create your first A/B test campaign to start optimizing your headlines and conversion rates.
      </p>
      <Button onClick={onNew} data-testid="button-create-first-campaign">
        <Plus className="w-4 h-4 mr-2" />
        Create your first campaign
      </Button>
    </div>
  );
}

function CampaignCard({ campaign, onUnarchive }: { campaign: CampaignWithStats; onUnarchive?: (id: number) => void }) {
  const convRate = campaign.conversionRate ?? 0;
  const isArchived = campaign.status === 'archived';

  return (
    <Card
      className={`hover-elevate ${isArchived ? 'opacity-60' : ''}`}
      data-testid={`card-campaign-${campaign.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-snug line-clamp-2">
            {campaign.name}
          </CardTitle>
          <Badge
            variant={isArchived ? "outline" : campaign.isActive ? "default" : "secondary"}
            className="shrink-0 text-xs"
            data-testid={`badge-status-${campaign.id}`}
          >
            {isArchived ? "Archived" : campaign.isActive ? "Active" : "Paused"}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
          <Globe className="w-3 h-3 shrink-0" />
          <span className="truncate">{campaign.url}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" /> Visitors
            </span>
            <span className="text-base font-semibold tabular-nums" data-testid={`text-visitors-${campaign.id}`}>
              {(campaign.totalVisitors ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Conv. Rate
            </span>
            <span className="text-base font-semibold tabular-nums" data-testid={`text-convrate-${campaign.id}`}>
              {convRate.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Layers className="w-3 h-3" /> Variants
            </span>
            <span className="text-base font-semibold tabular-nums" data-testid={`text-variants-${campaign.id}`}>
              {campaign.variantCount ?? 0}
            </span>
          </div>
        </div>
        {isArchived ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center gap-1.5"
            onClick={() => onUnarchive?.(campaign.id)}
            data-testid={`button-unarchive-${campaign.id}`}
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            Unarchive
          </Button>
        ) : (
          <Link href={`/campaigns/${campaign.id}`}>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              data-testid={`link-campaign-detail-${campaign.id}`}
            >
              View dashboard
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// QUICK CREATE DIALOG (legacy fallback)
// ============================================================

function QuickCreateDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (campaignId: number) => void;
}) {
  const { toast } = useToast();
  const form = useForm<QuickCreateValues>({
    resolver: zodResolver(quickCreateSchema),
    defaultValues: {
      name: "",
      url: "",
      headlineSelector: "",
      subheadlineSelector: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: QuickCreateValues) => {
      const res = await apiRequest("POST", "/api/campaigns", {
        name: data.name,
        url: data.url,
        headlineSelector: data.headlineSelector || null,
        subheadlineSelector: data.subheadlineSelector || null,
      });
      return res.json();
    },
    onSuccess: (campaign) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign created", description: "Your new campaign is ready." });
      form.reset();
      onClose();
      onSuccess(campaign.id);
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^\d+:\s*/, "");
      toast({ title: "Error creating campaign", description: msg, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-quick-create">
        <DialogHeader>
          <DialogTitle>Quick Create</DialogTitle>
          <DialogDescription>
            Set up an A/B test campaign manually without scanning your page.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Homepage Headlines Q2"
                      data-testid="input-campaign-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Page URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://yoursite.com/landing"
                      data-testid="input-campaign-url"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="headlineSelector"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Headline CSS selector <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl>
                    <Input
                      placeholder="h1, .hero-title"
                      data-testid="input-campaign-headline-selector"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    CSS selector for the headline element. Defaults to h1.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subheadlineSelector"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub-headline CSS selector <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl>
                    <Input
                      placeholder="h2, .hero-subtitle"
                      data-testid="input-campaign-subheadline-selector"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    CSS selector for the sub-headline element. Defaults to h2.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-2 justify-end pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                data-testid="button-cancel-quick-create"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                data-testid="button-submit-quick-create"
              >
                {mutation.isPending ? "Creating…" : "Create campaign"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// CAMPAIGN WIZARD — STEP INDICATOR
// ============================================================

function StepIndicator({ current, total }: { current: number; total: number }) {
  const steps = [
    { n: 1, label: "URL" },
    { n: 2, label: "Sections" },
    { n: 3, label: "Create" },
    { n: 4, label: "Pixel" },
    { n: 5, label: "Go Live" },
  ];
  return (
    <div className="flex items-start mb-8 w-full">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                s.n < current
                  ? "bg-primary text-primary-foreground"
                  : s.n === current
                  ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s.n < current ? <Check className="w-3.5 h-3.5" /> : s.n}
            </div>
            <span
              className={`text-[10px] font-medium leading-none whitespace-nowrap hidden sm:block ${
                s.n === current ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px flex-1 mt-3.5 mx-1.5 transition-colors ${s.n < current ? "bg-primary" : "bg-border"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ============================================================
// SECTION CARD (Step 2)
// ============================================================

function SectionCard({
  section,
  selected,
  onToggle,
}: {
  section: ScannedSection;
  selected: boolean;
  onToggle: () => void;
}) {
  const config = getCategoryConfig(section.category);
  const Icon = config.icon;
  const [showFullText, setShowFullText] = useState(false);

  const isBodyCopy = section.category === "body_copy" || section.category === "hero_journey";
  // Word count from plain text (strip HTML tags)
  const wordCount = section.currentText
    ? section.currentText.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length
    : 0;
  const previewText = section.currentText
    ? section.currentText.replace(/<[^>]*>/g, " ").trim()
    : "";

  return (
    <div
      className={`relative flex gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-border/80 hover:bg-muted/30"
      }`}
      onClick={onToggle}
      data-testid={`section-card-${section.id}`}
    >
      {/* Priority badge */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        {section.testPriority <= 2 && (
          <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
        )}
        <span className="text-xs text-muted-foreground">#{section.testPriority}</span>
      </div>

      {/* Checkbox */}
      <div className="mt-0.5 shrink-0">
        <div
          className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            selected ? "bg-primary border-primary" : "border-input"
          }`}
        >
          {selected && <Check className="w-3 h-3 text-primary-foreground" />}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-10">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-semibold">{section.label}</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium ${config.color}`}>
            <Icon className="w-3 h-3" />
            {config.label}
          </span>
          {/* Test method label */}
          {section.testMethod === "text_swap" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" data-testid={`badge-method-${section.id}`}>
              <Type className="w-3 h-3" />
              Text test
            </span>
          )}
          {section.testMethod === "html_swap" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20" data-testid={`badge-method-${section.id}`}>
              <FileText className="w-3 h-3" />
              HTML test
            </span>
          )}
          {section.testMethod === "visibility_toggle" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" data-testid={`badge-method-${section.id}`}>
              <Eye className="w-3 h-3" />
              Show/Hide test
            </span>
          )}
          {section.testMethod === "reorder" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" data-testid={`badge-method-${section.id}`}>
              <ArrowUpDown className="w-3 h-3" />
              Order test
            </span>
          )}
          {section.testMethod === "not_testable" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium bg-muted text-muted-foreground border-border" data-testid={`badge-method-${section.id}`}>
              <ImageIcon className="w-3 h-3" />
              Preview only
            </span>
          )}
          {/* Word count badge for body copy sections */}
          {isBodyCopy && wordCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border font-medium bg-muted text-muted-foreground border-border" data-testid={`badge-wordcount-${section.id}`}>
              ~{wordCount} words
            </span>
          )}
        </div>
        {section.purpose && (
          <p className="text-xs text-muted-foreground mb-1.5 leading-relaxed">{section.purpose}</p>
        )}
        {section.testMethod === "not_testable" && (
          <p className="text-xs text-muted-foreground/70 italic mb-1.5">
            This section contains visual content that can't be A/B tested directly.
          </p>
        )}
        {section.currentText && (
          <div className="mt-1" data-testid={`text-current-${section.id}`}>
            {isBodyCopy ? (
              <>
                <p className="text-xs text-foreground/70 bg-muted/50 rounded px-2 py-1 font-mono">
                  "{showFullText
                    ? previewText
                    : (previewText.length > 150 ? previewText.slice(0, 150) + "…" : previewText)}"
                </p>
                {previewText.length > 150 && (
                  <button
                    className="text-xs text-primary hover:underline mt-1 flex items-center gap-0.5"
                    onClick={(e) => { e.stopPropagation(); setShowFullText((v) => !v); }}
                    data-testid={`button-expand-text-${section.id}`}
                  >
                    {showFullText ? (
                      <><ChevronUp className="w-3 h-3" />Hide full text</>
                    ) : (
                      <><ChevronDown className="w-3 h-3" />Show full text</>
                    )}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-foreground/70 bg-muted/50 rounded px-2 py-1 font-mono truncate">
                "{section.currentText.length > 80 ? section.currentText.slice(0, 80) + "…" : section.currentText}"
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1.5 font-mono opacity-60 truncate">
          {section.selector}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// CAMPAIGN WIZARD (full-page, 3 steps)
// ============================================================

function CampaignWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [campaignName, setCampaignName] = useState("");
  const [campaignType, setCampaignType] = useState<"purchase" | "lead_gen">("purchase");
  const [creating, setCreating] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Pixel verification state (steps 4-5)
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);
  const [pixelVerified, setPixelVerified] = useState(false);
  const [pixelVerifying, setPixelVerifying] = useState(false);
  const [pixelError, setPixelError] = useState("");
  const [conversionUrl, setConversionUrl] = useState("");
  const [convPixelVerified, setConvPixelVerified] = useState(false);
  const [convPixelVerifying, setConvPixelVerifying] = useState(false);
  const [convPixelError, setConvPixelError] = useState("");
  const [pixelCopied, setPixelCopied] = useState(false);
  const [convPixelCopied, setConvPixelCopied] = useState(false);

  const resetWizard = useCallback(() => {
    setStep(1);
    setUrl("");
    setUrlError("");
    setScanning(false);
    setScanResult(null);
    setScanError("");
    setSelectedSections(new Set());
    setCampaignName("");
    setCampaignType("purchase");
    setCreating(false);
    setCreatedCampaignId(null);
    setPixelVerified(false);
    setPixelVerifying(false);
    setPixelError("");
    setConversionUrl("");
    setConvPixelVerified(false);
    setConvPixelVerifying(false);
    setConvPixelError("");
  }, []);

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  // Step 1: Scan page
  const handleScan = async () => {
    setUrlError("");
    setScanError("");

    if (!url.trim()) { setUrlError("Please enter a URL"); return; }
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
      setUrl(normalizedUrl);
    }
    try { new URL(normalizedUrl); } catch { setUrlError("Please enter a valid URL"); return; }

    setScanning(true);
    try {
      // Start async scan job — returns immediately with a jobId
      const startRes = await apiRequest("POST", "/api/scan-page", { url: normalizedUrl });
      const { jobId, error: startError } = await startRes.json();
      if (startError) throw new Error(startError);
      if (!jobId) throw new Error("Failed to start scan");

      // Manus is an async agent that can take several minutes — give it up to 5 min.
      // All other providers get the standard 90s window.
      const isManus = user?.llmProvider === "manus";
      const maxAttempts = isManus ? 150 : 45; // 150×2s = 5min, 45×2s = 90s
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await apiRequest("GET", `/api/scan-status/${jobId}`);
        if (pollRes.status === 404) {
          // Job not found — likely server restart lost the in-memory job.
          // For Manus we wait a bit longer before giving up.
          if (isManus && i < maxAttempts - 1) continue;
          throw new Error("Scan job was lost — the server may have restarted. Please try again.");
        }
        const poll = await pollRes.json();
        if (poll.status === "error") throw new Error(poll.error || "Scan failed");
        if (poll.status === "done" && poll.result) {
          const data = poll.result;
          setScanResult(data);
          const defaultSelected = new Set<string>(
            data.sections
              .filter((s: ScannedSection) => s.category === "headline" || s.testPriority === 1)
              .map((s: ScannedSection) => s.id)
          );
          if (defaultSelected.size === 0 && data.sections.length > 0) defaultSelected.add(data.sections[0].id);
          setSelectedSections(defaultSelected);
          setCampaignName(data.pageName || "New Campaign");
          setStep(2);
          return;
        }
        // still pending — keep polling
      }
      throw new Error(
        isManus
          ? "Manus scan timed out after 5 minutes. The task may still be running — try refreshing in a moment."
          : "Scan timed out after 90 seconds. Try Quick Create instead."
      );
    } catch (err: any) {
      const msg = err.message?.replace(/^\d+:\s*/, "") || "Failed to scan page";
      setScanError(msg);
    } finally {
      setScanning(false);
    }
  };

  // Step 2: Toggle section selection
  const toggleSection = (sectionId: string) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!scanResult) return;
    setSelectedSections(new Set(scanResult.sections.map((s) => s.id)));
  };

  const deselectAll = () => {
    setSelectedSections(new Set());
  };

  // Step 3: Create campaign + sections + control variants
  const handleCreate = async () => {
    if (!campaignName.trim()) return;
    setCreating(true);
    try {
      // 1. Create campaign
      const campaignRes = await apiRequest("POST", "/api/campaigns", {
        name: campaignName.trim(),
        url: url,
        campaignType: campaignType,
      });
      if (!campaignRes.ok) {
        const err = await campaignRes.json();
        throw new Error(err.error || "Failed to create campaign");
      }
      const campaign = await campaignRes.json();

      // 2. Create test sections + control variants for each selected section
      const selected = scanResult?.sections.filter((s) => selectedSections.has(s.id)) || [];
      for (const section of selected) {
        // Create the test section
        await apiRequest("POST", `/api/campaigns/${campaign.id}/sections`, {
          sectionId: section.id,
          label: section.label,
          purpose: section.purpose || null,
          selector: section.selector,
          category: section.category,
          currentText: section.currentText || null,
          testPriority: section.testPriority,
          testMethod: section.testMethod || "text_swap",
          isActive: section.testPriority === 1, // activate highest priority section by default
        });

        // Create control variant for this section (if there's current text)
        if (section.currentText) {
          await apiRequest("POST", `/api/campaigns/${campaign.id}/variants`, {
            type: section.category,
            text: section.currentText,
            isControl: true,
            isActive: true,
            persuasionTags: null,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setCreatedCampaignId(campaign.id);
      setStep(4); // Advance to pixel installation step
    } catch (err: any) {
      const msg = err.message?.replace(/^\d+:\s*/, "") || "Failed to create campaign";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
        data-testid="wizard-overlay"
      />

      {/* Panel */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center sm:items-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative w-full max-w-2xl bg-background border border-border rounded-xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          data-testid="wizard-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <ScanLine className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold" data-testid="wizard-title">New Campaign</h2>
                <p className="text-xs text-muted-foreground">
                  {step === 1 && "Scan your page to detect testable sections"}
                  {step === 2 && "Choose which sections to test"}
                  {step === 3 && "Name your campaign and launch"}
                  {step === 4 && "Install the tracking pixel on your page"}
                  {step === 5 && "Install the conversion pixel on your thank-you page"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="shrink-0"
              data-testid="button-close-wizard"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <StepIndicator current={step} total={5} />

            {/* ---- STEP 1: Enter URL ---- */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Enter your page URL</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    We'll analyze your page and identify every section that could be A/B tested.
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="https://yourpage.com/landing"
                        value={url}
                        onChange={(e) => { setUrl(e.target.value); setUrlError(""); setScanError(""); }}
                        onKeyDown={(e) => e.key === "Enter" && handleScan()}
                        disabled={scanning}
                        data-testid="input-scan-url"
                        autoFocus
                      />
                    </div>
                    <Button
                      onClick={handleScan}
                      disabled={scanning || !url.trim()}
                      data-testid="button-scan-page"
                    >
                      {scanning ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Scanning…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Scan Page
                        </>
                      )}
                    </Button>
                  </div>
                  {urlError && (
                    <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {urlError}
                    </p>
                  )}
                </div>

                {/* Scanning animation */}
                {scanning && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="scanning-state">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full border-2 border-primary/20 animate-ping absolute inset-0" />
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center relative">
                        <ScanLine className="w-6 h-6 text-primary" />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Analyzing your page structure…</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {user?.llmProvider === "manus"
                          ? "Manus is working extra hard on your behalf — this may take a few minutes."
                          : "Identifying testable sections with AI"
                        }
                      </p>
                    </div>
                  </div>
                )}

                {/* Scan error */}
                {scanError && !scanning && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4" data-testid="scan-error">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-destructive">Scan failed</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{scanError}</p>
                        {scanError.toLowerCase().includes("settings") && (
                          <Link href="/settings">
                            <Button variant="ghost" size="sm" className="px-0 h-auto text-xs mt-1 text-primary underline-offset-4 hover:underline">
                              Go to Settings →
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* What happens next */}
                {!scanning && !scanError && (
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">What happens next</p>
                    <ul className="space-y-1.5">
                      {[
                        "AI reads your page and detects every testable section",
                        "You choose which sections to include in this campaign",
                        "Control variants are auto-created from your current copy",
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                            {i + 1}
                          </div>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ---- STEP 2: Review Sections ---- */}
            {step === 2 && scanResult && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold" data-testid="scan-page-name">{scanResult.pageName}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs" data-testid="scan-page-type">
                        {scanResult.pageType.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {scanResult.sections.length} sections detected
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={selectAll}
                      className="text-xs h-7"
                      data-testid="button-select-all"
                    >
                      <CheckSquare className="w-3.5 h-3.5 mr-1" />
                      All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={deselectAll}
                      className="text-xs h-7"
                      data-testid="button-deselect-all"
                    >
                      <Square className="w-3.5 h-3.5 mr-1" />
                      None
                    </Button>
                  </div>
                </div>

                <div className="space-y-2" data-testid="sections-list">
                  {scanResult.sections.map((section) => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      selected={selectedSections.has(section.id)}
                      onToggle={() => toggleSection(section.id)}
                    />
                  ))}
                </div>

                {selectedSections.size === 0 && (
                  <div className="text-center py-4 text-xs text-muted-foreground" data-testid="no-sections-warning">
                    <AlertCircle className="w-4 h-4 mx-auto mb-1 text-amber-500" />
                    Select at least one section to continue
                  </div>
                )}
              </div>
            )}

            {/* ---- STEP 3: Name & Create ---- */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Name your campaign</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    The name was auto-filled from your page. Edit if needed.
                  </p>
                  <Input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Campaign name"
                    data-testid="input-campaign-name-wizard"
                    autoFocus
                  />
                </div>

                {/* Campaign Type */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Campaign Type</Label>
                  <div className="flex gap-2">
                    <button
                      className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                        campaignType === "purchase" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
                      }`}
                      onClick={() => setCampaignType("purchase")}
                      data-testid="button-campaign-type-purchase"
                    >
                      <div className="text-sm font-medium">Purchase Page</div>
                      <div className="text-xs text-muted-foreground">Track sales, revenue, and conversion value</div>
                    </button>
                    <button
                      className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                        campaignType === "lead_gen" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
                      }`}
                      onClick={() => setCampaignType("lead_gen")}
                      data-testid="button-campaign-type-lead-gen"
                    >
                      <div className="text-sm font-medium">Lead Generation</div>
                      <div className="text-xs text-muted-foreground">Track opt-ins, registrations, and lead capture</div>
                    </button>
                  </div>
                </div>

                {/* Summary */}
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign Summary</p>
                  <div className="flex items-start gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Page URL</p>
                      <p className="text-xs font-medium truncate">{url}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Testable sections</p>
                      <p className="text-xs font-medium">
                        {scanResult?.sections.length || 0} section{(scanResult?.sections.length || 0) !== 1 ? "s" : ""} ready to test
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {scanResult?.sections
                          .map((s) => {
                            const config = getCategoryConfig(s.category);
                            return (
                              <span
                                key={s.id}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border ${config.color}`}
                              >
                                {s.label}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <FlaskConical className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Control variants</p>
                      <p className="text-xs font-medium">Auto-created from your current copy</p>
                    </div>
                  </div>
                </div>

                {/* Autopilot promo */}
                {user?.plan !== "autopilot" && (
                  <div className="rounded-lg border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Rocket className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Want this to run on autopilot?</p>
                        <p className="text-xs text-muted-foreground">Let AI continuously optimize all {scanResult?.sections.length || 0} sections</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Autopilot starts with your highest-impact section, runs the test to statistical significance, 
                      locks in the winner, then automatically moves to the next section. Your page keeps getting better 
                      while you focus on your business.
                    </p>
                    <div className="flex items-center gap-3">
                      <Link href="/billing">
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                          <Rocket className="w-3 h-3" />
                          Upgrade to Autopilot — $299/mo
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}

                {user?.plan === "autopilot" && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Rocket className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold text-primary">Autopilot available</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      After creating this campaign, you can enable Autopilot from the campaign dashboard 
                      to automatically test and optimize all {scanResult?.sections.length || 0} sections sequentially.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ---- STEP 4: Install Tracking Pixel ---- */}
            {step === 4 && createdCampaignId && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Install the tracking pixel</h3>
                  <p className="text-xs text-muted-foreground">
                    Add this script tag to your landing page's <code className="bg-muted px-1 py-0.5 rounded">&lt;head&gt;</code> or just before <code className="bg-muted px-1 py-0.5 rounded">&lt;/body&gt;</code>.
                    This enables A/B testing and behavioral tracking.
                  </p>
                </div>

                <div className="relative">
                  <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto text-foreground">
{`<script src="https://api.siteamoeba.com/api/widget/script/${createdCampaignId}"></script>`}
                  </pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2"
                    onClick={() => {
                      navigator.clipboard.writeText(`<script src="https://api.siteamoeba.com/api/widget/script/${createdCampaignId}"></script>`);
                      setPixelCopied(true);
                      setTimeout(() => setPixelCopied(false), 2000);
                    }}
                  >
                    {pixelCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-semibold">After installing, click Verify to confirm</p>
                  <p className="text-xs text-muted-foreground">
                    We'll check <span className="font-medium text-foreground">{url}</span> for the tracking script.
                  </p>

                  {pixelVerified && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="w-4 h-4" />
                      <span className="text-sm font-medium">Pixel verified on your page</span>
                    </div>
                  )}
                  {pixelError && (
                    <p className="text-xs text-red-500">{pixelError}</p>
                  )}
                </div>
              </div>
            )}

            {/* ---- STEP 5: Install Conversion Pixel ---- */}
            {step === 5 && createdCampaignId && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Install the conversion pixel</h3>
                  <p className="text-xs text-muted-foreground">
                    Paste this on your thank-you or order confirmation page. It fires when a visitor converts,
                    connecting the sale back to the variant they saw.
                  </p>
                </div>

                <div className="relative">
                  <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto text-foreground whitespace-pre-wrap">
{`<!-- SiteAmoeba Conversion Pixel -->
<script>
(function(){
  var s = ["local","Storage"].join("");
  var vid = window[s].getItem("sa_vid");
  if (vid) {
    var amount = window.sa_revenue || 0;
    var img = new Image();
    img.src = "https://api.siteamoeba.com/api/widget/convert?vid=" + vid + "&cid=${createdCampaignId}&revenue=" + amount;
  }
})();
</script>`}
                  </pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2"
                    onClick={() => {
                      const code = `<!-- SiteAmoeba Conversion Pixel -->\n<script>\n(function(){\n  var s = ["local","Storage"].join("");\n  var vid = window[s].getItem("sa_vid");\n  if (vid) {\n    var amount = window.sa_revenue || 0;\n    var img = new Image();\n    img.src = "https://api.siteamoeba.com/api/widget/convert?vid=" + vid + "&cid=${createdCampaignId}&revenue=" + amount;\n  }\n})();\n</script>`;
                      navigator.clipboard.writeText(code);
                      setConvPixelCopied(true);
                      setTimeout(() => setConvPixelCopied(false), 2000);
                    }}
                  >
                    {convPixelCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Set <code className="bg-muted px-1 py-0.5 rounded text-foreground">window.sa_revenue = 27.00</code> before this script to track the actual transaction amount.
                </p>

                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-semibold">Enter your thank-you page URL</p>
                  <Input
                    value={conversionUrl}
                    onChange={(e) => setConversionUrl(e.target.value)}
                    placeholder="https://yoursite.com/thank-you"
                    data-testid="input-conversion-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    After installing the snippet above, we'll verify it on this page.
                  </p>

                  {convPixelVerified && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="w-4 h-4" />
                      <span className="text-sm font-medium">Conversion pixel verified</span>
                    </div>
                  )}
                  {convPixelError && (
                    <p className="text-xs text-red-500">{convPixelError}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border shrink-0 bg-background">
            <div>
              {step === 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { handleClose(); setShowQuickCreate(true); }}
                  className="text-xs text-muted-foreground"
                  data-testid="button-quick-create"
                >
                  Quick create (manual)
                </Button>
              )}
              {step > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep((s) => s - 1)}
                  disabled={creating}
                  data-testid="button-back"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={handleClose}
                disabled={creating}
                data-testid="button-cancel-wizard"
              >
                Cancel
              </Button>

              {step === 1 && (
                <Button
                  onClick={handleScan}
                  disabled={scanning || !url.trim()}
                  data-testid="button-next-step1"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Scanning…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Scan Page
                    </>
                  )}
                </Button>
              )}

              {step === 2 && (
                <Button
                  onClick={() => setStep(3)}
                  data-testid="button-next-step2"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}

              {step === 3 && (
                <Button
                  onClick={handleCreate}
                  disabled={creating || !campaignName.trim()}
                  data-testid="button-create-campaign"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Create Campaign
                    </>
                  )}
                </Button>
              )}

              {step === 4 && (
                <Button
                  onClick={async () => {
                    if (pixelVerified) { setStep(5); return; }
                    setPixelVerifying(true);
                    setPixelError("");
                    try {
                      const res = await apiRequest("POST", `/api/campaigns/${createdCampaignId}/verify-pixel`, { type: "tracking" });
                      const data = await res.json();
                      if (data.verified) {
                        setPixelVerified(true);
                        setTimeout(() => setStep(5), 1000);
                      } else {
                        setPixelError(data.error || "Pixel not found on your page. Make sure you added the script and saved/published your page.");
                      }
                    } catch {
                      setPixelError("Failed to check your page. Try again.");
                    } finally {
                      setPixelVerifying(false);
                    }
                  }}
                  disabled={pixelVerifying}
                  data-testid="button-verify-pixel"
                >
                  {pixelVerifying ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying…</>
                  ) : pixelVerified ? (
                    <><Check className="w-4 h-4 mr-2" />Verified — Continue</>
                  ) : (
                    <><Search className="w-4 h-4 mr-2" />Verify Pixel</>
                  )}
                </Button>
              )}

              {step === 5 && (
                <Button
                  onClick={async () => {
                    if (convPixelVerified) {
                      // All done — navigate to campaign
                      toast({ title: "Setup complete!", description: "Both pixels verified. Your campaign is live." });
                      handleClose();
                      navigate(`/campaigns/${createdCampaignId}`);
                      return;
                    }
                    if (!conversionUrl.trim()) {
                      setConvPixelError("Please enter your thank-you page URL");
                      return;
                    }
                    setConvPixelVerifying(true);
                    setConvPixelError("");
                    try {
                      const res = await apiRequest("POST", `/api/campaigns/${createdCampaignId}/verify-pixel`, { type: "conversion", url: conversionUrl.trim() });
                      const data = await res.json();
                      if (data.verified) {
                        setConvPixelVerified(true);
                        setTimeout(() => {
                          toast({ title: "Setup complete!", description: "Both pixels verified. Your campaign is live." });
                          handleClose();
                          navigate(`/campaigns/${createdCampaignId}`);
                        }, 1500);
                      } else {
                        setConvPixelError(data.error || "Conversion pixel not found. Make sure you added the script to your thank-you page and it's published.");
                      }
                    } catch {
                      setConvPixelError("Failed to check your page. Try again.");
                    } finally {
                      setConvPixelVerifying(false);
                    }
                  }}
                  disabled={convPixelVerifying || (!conversionUrl.trim() && !convPixelVerified)}
                  data-testid="button-verify-conversion-pixel"
                >
                  {convPixelVerifying ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying…</>
                  ) : convPixelVerified ? (
                    <><Check className="w-4 h-4 mr-2" />Complete Setup</>
                  ) : (
                    <><Search className="w-4 h-4 mr-2" />Verify Conversion Pixel</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick create fallback */}
      <QuickCreateDialog
        open={showQuickCreate}
        onClose={() => setShowQuickCreate(false)}
        onSuccess={(id) => navigate(`/campaigns/${id}`)}
      />
    </>
  );
}

// ============================================================
// DASHBOARD STATS KPI CARD
// ============================================================

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  subtext,
  testId,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  subtext?: string;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold tabular-nums" data-testid={`${testId}-value`}>{value}</p>
            {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
          </div>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// WIN/LOSS TIMELINE
// ============================================================

function ActiveTestsPanel({ tests }: { tests: DashboardStats['activeTests'] }) {
  const [, navigate] = useLocation();

  if (!tests || tests.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground"
        data-testid="empty-active-tests"
      >
        <FlaskConical className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No active tests running</p>
        <p className="text-xs mt-1">Create a campaign and start testing to see live results</p>
      </div>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    collecting: { label: 'Collecting data', color: 'text-muted-foreground', icon: Users },
    testing: { label: 'Testing', color: 'text-blue-600 dark:text-blue-400', icon: FlaskConical },
    promising: { label: 'Promising', color: 'text-amber-600 dark:text-amber-400', icon: TrendingUpIcon },
    winner: { label: 'Winner found', color: 'text-emerald-600 dark:text-emerald-400', icon: Trophy },
  };

  return (
    <div className="divide-y divide-border" data-testid="active-tests-panel">
      {tests.map((test, idx) => {
        const cfg = statusConfig[test.status] || statusConfig.testing;
        const StatusIcon = cfg.icon;
        return (
          <div
            key={idx}
            className="py-3 px-1 cursor-pointer hover:bg-muted/50 rounded-md transition-colors"
            onClick={() => navigate(`/campaigns/${test.campaignId}`)}
            data-testid={`active-test-${idx}`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${cfg.color}`} />
                <span className="text-sm font-medium truncate">{test.campaignName}</span>
              </div>
              <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
            </div>
            <div className="flex items-center justify-between pl-5.5">
              <span className="text-xs text-muted-foreground capitalize">{test.sectionLabel}</span>
              <div className="flex items-center gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">{test.visitors} visitors</span>
                {test.visitors >= 10 && (
                  <span className={test.lift > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : test.lift < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}>
                    {test.lift > 0 ? '+' : ''}{test.lift}% lift
                  </span>
                )}
                {test.confidence > 0 && (
                  <span className="text-muted-foreground">{test.confidence}% conf.</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

// ── Onboarding Modal for new free users ──
function OnboardingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-onboarding">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            Welcome to SiteAmoeba
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            You're on the <strong>Free plan</strong> — which means you can use your own AI API keys for unlimited testing at no cost.
          </p>
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">To get started:</p>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</div>
              <div className="text-sm text-muted-foreground">
                Go to <strong>Settings</strong> and add your AI API key from any supported provider: OpenAI, Anthropic, Google, Mistral, xAI, or Meta.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</div>
              <div className="text-sm text-muted-foreground">
                Come back here and click <strong>"New Campaign"</strong> to scan your first page.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</div>
              <div className="text-sm text-muted-foreground">
                The AI will identify testable sections and generate optimized variants — your first test can be live in under 5 minutes.
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1"
              onClick={() => { onClose(); navigate("/settings"); }}
              data-testid="button-onboarding-settings"
            >
              <Settings className="w-4 h-4 mr-2" />
              Go to Settings
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              data-testid="button-onboarding-dismiss"
            >
              I'll do this later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CampaignsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { toast } = useToast();

  const { data: campaigns, isLoading } = useQuery<CampaignWithStats[]>({
    queryKey: ["/api/campaigns", statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns?status=${statusFilter}`);
      return res.json();
    },
    enabled: isAuthenticated,
  });

  // Always fetch archived count for tab label
  const { data: archivedCampaigns } = useQuery<CampaignWithStats[]>({
    queryKey: ["/api/campaigns", "archived"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns?status=archived`);
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const { data: dashStats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    enabled: isAuthenticated,
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (campaignId: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/unarchive`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Campaign unarchived", description: "Campaign is now active again." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to unarchive", description: err.message, variant: "destructive" });
    },
  });

  // Show onboarding for new free users without API keys
  const needsOnboarding = !authLoading && isAuthenticated && user
    && user.plan === "free"
    && !user.llmProvider
    && campaigns !== undefined
    && campaigns.length === 0;

  // Auto-show onboarding once when conditions met
  const [onboardingShownOnce, setOnboardingShownOnce] = useState(false);
  if (needsOnboarding && !showOnboarding && !onboardingShownOnce) {
    setShowOnboarding(true);
    setOnboardingShownOnce(true);
  }

  // Redirect if not authenticated
  if (!authLoading && !isAuthenticated) {
    navigate("/auth");
    return null;
  }

  const archivedCount = archivedCampaigns?.length ?? 0;

  // Win rate color
  const winRateColor = (dashStats?.winRate ?? 0) >= 50
    ? 'bg-emerald-500/10 text-emerald-600'
    : (dashStats?.winRate ?? 0) >= 30
    ? 'bg-amber-500/10 text-amber-600'
    : 'bg-rose-500/10 text-rose-600';

  return (
    <div className="flex flex-col h-full">
      {/* Onboarding modal for new free users */}
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />

      {/* Page header */}
      <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your A/B testing intelligence center
          </p>
        </div>
        <Button
          onClick={() => setWizardOpen(true)}
          data-testid="button-new-campaign"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="dashboard-kpi-row">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-5 pb-5"><Skeleton className="h-14 w-full" /></CardContent></Card>
            ))
          ) : (
            <>
              <KpiCard
                label="Active Campaigns"
                value={dashStats?.activeCampaigns ?? 0}
                icon={Activity}
                color="bg-blue-500/10 text-blue-600"
                subtext={`${dashStats?.archivedCampaigns ?? 0} archived`}
                testId="kpi-active-campaigns"
              />
              <KpiCard
                label="Tests Completed"
                value={dashStats?.testsCompleted ?? 0}
                icon={CheckCircle2}
                color="bg-violet-500/10 text-violet-600"
                subtext={`${dashStats?.testsWon ?? 0} won · ${dashStats?.testsLost ?? 0} lost`}
                testId="kpi-tests-completed"
              />
              <KpiCard
                label="Win Rate"
                value={`${dashStats?.winRate?.toFixed(1) ?? '0.0'}%`}
                icon={Trophy}
                color={winRateColor}
                subtext="challenger beat control"
                testId="kpi-win-rate"
              />
              <KpiCard
                label="Projected 30-Day Gain"
                value={`$${(dashStats?.projectedMonthlyGain ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                icon={TrendingUpIcon}
                color="bg-emerald-500/10 text-emerald-600"
                subtext="from winning variants"
                testId="kpi-monthly-gain"
              />
            </>
          )}
        </div>

        {/* Active Tests */}
        <Card data-testid="card-active-tests">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-muted-foreground" />
              Active Tests
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <ActiveTestsPanel tests={dashStats?.activeTests ?? []} />
            )}
          </CardContent>
        </Card>

        {/* Campaign list with Active/Archived toggle */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <Tabs
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'active' | 'archived')}
              data-testid="tabs-campaign-filter"
            >
              <TabsList>
                <TabsTrigger value="active" data-testid="tab-active">Active</TabsTrigger>
                <TabsTrigger value="archived" data-testid="tab-archived">
                  Archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <CampaignCardSkeleton key={i} />
              ))}
            </div>
          ) : campaigns && campaigns.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="campaign-grid">
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onUnarchive={(id) => unarchiveMutation.mutate(id)}
                />
              ))}
            </div>
          ) : statusFilter === 'archived' ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground"
              data-testid="empty-archived"
            >
              <Archive className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No archived campaigns</p>
            </div>
          ) : (
            <EmptyState onNew={() => setWizardOpen(true)} />
          )}
        </div>
      </div>

      <CampaignWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
