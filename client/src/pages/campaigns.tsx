import { useState, useCallback } from "react";
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
}

interface ScannedSection {
  id: string;
  label: string;
  purpose: string;
  selector: string;
  currentText: string;
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
    { n: 1, label: "Enter URL" },
    { n: 2, label: "Review Sections" },
    { n: 3, label: "Name & Create" },
  ];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
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
              className={`text-xs font-medium hidden sm:block ${
                s.n === current ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px w-8 sm:w-16 mx-2 transition-colors ${s.n < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
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
          <p className="text-xs text-foreground/70 bg-muted/50 rounded px-2 py-1 font-mono truncate" data-testid={`text-current-${section.id}`}>
            "{section.currentText.length > 80 ? section.currentText.slice(0, 80) + "…" : section.currentText}"
          </p>
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
  const [creating, setCreating] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  const resetWizard = useCallback(() => {
    setStep(1);
    setUrl("");
    setUrlError("");
    setScanning(false);
    setScanResult(null);
    setScanError("");
    setSelectedSections(new Set());
    setCampaignName("");
    setCreating(false);
  }, []);

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  // Step 1: Scan page
  const handleScan = async () => {
    setUrlError("");
    setScanError("");

    // Basic URL validation
    if (!url.trim()) {
      setUrlError("Please enter a URL");
      return;
    }
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
      setUrl(normalizedUrl);
    }
    try {
      new URL(normalizedUrl);
    } catch {
      setUrlError("Please enter a valid URL");
      return;
    }

    setScanning(true);
    try {
      const res = await apiRequest("POST", "/api/scan-page", { url: normalizedUrl });
      const data = await res.json();
      setScanResult(data);
      // Default: select headline sections (category === 'headline' or first section)
      const defaultSelected = new Set<string>(
        data.sections
          .filter((s: ScannedSection) => s.category === "headline" || s.testPriority === 1)
          .map((s: ScannedSection) => s.id)
      );
      if (defaultSelected.size === 0 && data.sections.length > 0) {
        defaultSelected.add(data.sections[0].id);
      }
      setSelectedSections(defaultSelected);
      setCampaignName(data.pageName || "New Campaign");
      setStep(2);
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
      toast({
        title: "Campaign created!",
        description: `Testing ${selected.length} section${selected.length !== 1 ? "s" : ""} on your page.`,
      });
      handleClose();
      navigate(`/campaigns/${campaign.id}`);
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
            <StepIndicator current={step} total={3} />

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
                        Identifying testable sections with AI
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

function WinLossTimeline({ wins, losses }: {
  wins: DashboardStats['recentWins'];
  losses: DashboardStats['recentLosses'];
}) {
  // Merge wins and losses into one sorted list (most recent first)
  const all = [
    ...wins.map(w => ({ ...w, isWin: true })),
    ...losses.map(l => ({ ...l, isWin: false })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  if (all.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground"
        data-testid="empty-win-loss-timeline"
      >
        <BarChart3 className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">Complete your first A/B test to see results here</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border" data-testid="win-loss-timeline">
      {all.map((item, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between py-2.5 px-1 gap-3"
          data-testid={`timeline-row-${idx}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {item.isWin ? (
              <Trophy className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            )}
            <div className="min-w-0">
              <span className="text-sm font-medium truncate block">{item.campaignName}</span>
              <span className="text-xs text-muted-foreground capitalize">{item.section}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`text-sm font-semibold tabular-nums ${
                item.isWin ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
              data-testid={`timeline-lift-${idx}`}
            >
              {item.isWin ? '+' : ''}{item.lift.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground w-20 text-right">{item.date}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function CampaignsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
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

        {/* Win/Loss Timeline */}
        <Card data-testid="card-win-loss-timeline">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Recent Test Results
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <WinLossTimeline
                wins={dashStats?.recentWins ?? []}
                losses={dashStats?.recentLosses ?? []}
              />
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
