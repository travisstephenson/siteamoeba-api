import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { User as UserIcon, Mail, Calendar, CreditCard, Trash2, Sparkles, Eye, EyeOff, Check, FlaskConical, Coins, MessageSquarePlus, Plug, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Copy, Zap, Loader2, ShoppingBag, Building2, Webhook, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Feedback } from "@shared/schema";

import { Switch } from "@/components/ui/switch";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro — $47/mo",
  business: "Business — $97/mo",
  autopilot: "Autopilot — $299/mo",
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic / Claude",
  openai: "OpenAI / GPT",
  gemini: "Google Gemini",
  mistral: "Mistral AI",
  xai: "xAI / Grok",
  meta: "Meta / Llama (via Groq)",
  manus: "Manus (Autonomous Agent)",
};

function AIConfigCard({ currentProvider }: { currentProvider?: string | null }) {
  const { toast } = useToast();
  const [provider, setProvider] = useState(currentProvider || "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync provider state if the prop updates (e.g. after parent re-fetches user)
  useEffect(() => {
    if (currentProvider && !saved) setProvider(currentProvider);
  }, [currentProvider]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/llm", {
        provider,
        apiKey,
        model: model || undefined,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      setApiKey(""); // Clear key from UI after save
      // Refresh user data so the badge and parent state reflect the new provider
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "AI provider saved", description: `Now using ${PROVIDER_LABELS[provider] || provider}` });
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Error saving provider", description: err.message, variant: "destructive" });
    },
  });

  const canSave = provider && apiKey;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          AI Configuration
        </CardTitle>
        <CardDescription className="text-xs">
          Enter your API key to enable AI-powered variant generation. Your key is stored securely and only used to generate test variants.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentProvider && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary" data-testid="badge-llm-provider">
              {PROVIDER_LABELS[currentProvider] || currentProvider}
            </Badge>
            <span className="text-xs text-muted-foreground">currently configured</span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="ai-provider" className="text-xs font-medium">AI Provider</Label>
          <Select
            value={provider}
            onValueChange={setProvider}
          >
            <SelectTrigger id="ai-provider" data-testid="select-ai-provider" className="h-9">
              <SelectValue placeholder="Select a provider..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic / Claude</SelectItem>
              <SelectItem value="openai">OpenAI / GPT</SelectItem>
              <SelectItem value="gemini">Google Gemini</SelectItem>
              <SelectItem value="mistral">Mistral AI</SelectItem>
              <SelectItem value="xai">xAI / Grok</SelectItem>
              <SelectItem value="meta">Meta / Llama (via Groq)</SelectItem>
              <SelectItem value="manus">Manus (Autonomous Agent)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {provider === "manus" && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Manus is an autonomous agent — it plans and executes tasks independently rather than responding instantly. Brain Chat responses may take 1–5 minutes. Best suited for deep research and CRO reports.
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="ai-api-key" className="text-xs font-medium">API Key</Label>
          <div className="relative">
            <Input
              id="ai-api-key"
              type={showKey ? "text" : "password"}
              placeholder="Paste your API key here..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-10 h-9"
              data-testid="input-ai-api-key"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              data-testid="button-toggle-key-visibility"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Leave blank to keep your existing key.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-model" className="text-xs font-medium">Model Override <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="ai-model"
            type="text"
            placeholder="e.g. gpt-4o, claude-3-5-sonnet-20241022..."
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9"
            data-testid="input-ai-model"
          />
          <p className="text-xs text-muted-foreground">Leave blank to use the default model for the selected provider.</p>
        </div>

        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!canSave || mutation.isPending}
          data-testid="button-save-ai-config"
          className="gap-1.5"
        >
          {saved ? (
            <><Check className="w-3.5 h-3.5" /> Saved</>
          ) : mutation.isPending ? (
            "Saving..."
          ) : (
            <><Sparkles className="w-3.5 h-3.5" /> Save AI Configuration</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function TestingSettingsCard({ minVisitors, confidenceThreshold }: { minVisitors: number; confidenceThreshold: number }) {
  const { toast } = useToast();
  const [visitors, setVisitors] = useState(String(minVisitors));
  const [confidence, setConfidence] = useState(String(confidenceThreshold));
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/testing", {
        minVisitorsPerVariant: parseInt(visitors),
        winConfidenceThreshold: parseInt(confidence),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      toast({ title: "Testing settings saved" });
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Error saving settings", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FlaskConical className="w-4 h-4" />
          Statistical Significance Settings
        </CardTitle>
        <CardDescription className="text-xs">
          Control when a test variant is declared a winner. Higher thresholds require more data but give more reliable results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="min-visitors" className="text-xs font-medium">
            Minimum visitors per variant before declaring a winner
          </Label>
          <Input
            id="min-visitors"
            type="number"
            min="10"
            max="100000"
            value={visitors}
            onChange={(e) => setVisitors(e.target.value)}
            className="h-9 w-32"
            data-testid="input-min-visitors"
          />
          <p className="text-xs text-muted-foreground">
            Each variant must receive at least this many visitors before the test can be called. Recommended: 100–500 for most sites.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="win-confidence" className="text-xs font-medium">
            Confidence threshold to declare a winner
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="win-confidence"
              type="number"
              min="50"
              max="99"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              className="h-9 w-20"
              data-testid="input-win-confidence"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The statistical confidence level required. 95% is industry standard. Lower values call winners faster but with more risk of a false positive.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid="button-save-testing-settings"
          className="gap-1.5"
        >
          {saved ? (
            <><Check className="w-3.5 h-3.5" /> Saved</>
          ) : mutation.isPending ? (
            "Saving..."
          ) : (
            "Save settings"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function CreditOverageCard({ allowOverage, overageUsed }: { allowOverage: boolean; overageUsed: number }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(allowOverage);

  const mutation = useMutation({
    mutationFn: async (value: boolean) => {
      const res = await apiRequest("PATCH", "/api/settings/testing", {
        allowOverage: value,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: (_, value) => {
      setEnabled(value);
      toast({ title: value ? "Overage enabled" : "Overage disabled" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Coins className="w-4 h-4" />
          Credit Overage
        </CardTitle>
        <CardDescription className="text-xs">
          When you use all your included credits, allow tests and AI generation to continue running at the overage rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Allow credit overage</p>
            <p className="text-xs text-muted-foreground">
              When enabled, your tests won't pause if you run out of credits. Overage is billed at your plan's rate.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(value) => mutation.mutate(value)}
            data-testid="switch-allow-overage"
          />
        </div>

        {overageUsed > 0 && (
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">Overage credits used this period</p>
            <p className="text-lg font-bold tabular-nums">{overageUsed.toLocaleString()}</p>
          </div>
        )}

        <div className="rounded-md border border-border p-3 space-y-1">
          <p className="text-xs font-medium">Overage rates</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Pro plan</span><span className="font-mono">$0.10 / credit</span>
            <span>Business plan</span><span className="font-mono">$0.08 / credit</span>
            <span>Autopilot plan</span><span className="font-mono">$0.06 / credit</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Need consistently higher volume? Contact us about custom enterprise plans with bulk credit pricing.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature_request: "Feature Request",
  brain_quality: "Brain Quality",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewed: "Reviewed",
  planned: "Planned",
  resolved: "Resolved",
  declined: "Declined",
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "new": return "bg-secondary text-secondary-foreground";
    case "reviewed": return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "planned": return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "resolved": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "declined": return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    default: return "bg-secondary text-secondary-foreground";
  }
}

function YourFeedbackSection({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { data: items = [], isLoading } = useQuery<Feedback[]>({
    queryKey: ["/api/feedback"],
    enabled: isAuthenticated,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MessageSquarePlus className="w-4 h-4" />
          Your Feedback
        </CardTitle>
        <CardDescription className="text-xs">
          Feedback you've submitted. We review everything and update statuses as we act on them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No feedback submitted yet. Use the &quot;Send Feedback&quot; button in the sidebar to share your thoughts.</p>
        ) : (
          <div className="space-y-2" data-testid="list-feedback">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-border p-3 space-y-1.5"
                data-testid={`card-feedback-${item.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="text-xs"
                    data-testid={`badge-category-${item.id}`}
                  >
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </Badge>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                    data-testid={`badge-status-${item.id}`}
                  >
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums" data-testid={`text-date-${item.id}`}>
                    {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`text-message-${item.id}`}>
                  {item.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Integrations =====

const PROD_BASE = "https://api.siteamoeba.com";

function CopyButton({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      data-testid={testId}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

function UrlRow({ url, testId }: { url: string; testId?: string }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <code
        className="flex-1 bg-muted rounded-md px-3 py-2 text-xs font-mono text-foreground truncate"
        data-testid={testId}
      >
        {url}
      </code>
      <CopyButton text={url} testId={testId ? `button-copy-${testId}` : undefined} />
    </div>
  );
}

// ----- Stripe Integration -----
function StripeIntegration({ userId }: { userId?: number }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [stripeKey, setStripeKey] = useState("");

  const { data: stripeStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    connected: boolean;
    accountId?: string;
    recentCharges?: number;
    connectedAt?: string;
    connectAvailable?: boolean;
  }>({
    queryKey: ["/api/settings/stripe-status"],
  });

  // Detect stripe_connected=true from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeConnected = params.get("stripe_connected");
    const stripeError = params.get("stripe_error");
    if (stripeConnected === "true") {
      toast({ title: "Stripe connected!", description: "Your Stripe account has been linked successfully." });
      refetchStatus();
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname + window.location.hash.replace(/[?&]stripe_connected=true/, ""));
    } else if (stripeError) {
      toast({ title: "Stripe connection failed", description: decodeURIComponent(stripeError), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname + window.location.hash.replace(/[?&]stripe_error=[^&]*/, ""));
    }
  }, []);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/settings/stripe-connect-url");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to get OAuth URL");
      }
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: () => {
      // OAuth not configured — show fallback restricted key UI
      setShowFallback(true);
    },
  });

  const connectKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/connect-stripe", { stripeKey });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to connect");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Stripe connected!", description: "Your restricted API key has been saved and verified." });
      setStripeKey("");
      setShowFallback(false);
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/settings/stripe-status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const syncStripeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/stripe-sync", {});
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Sync failed"); }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: data.matched > 0 ? `Synced ${data.matched} new transaction${data.matched !== 1 ? 's' : ''}` : "Already up to date" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/stripe-status"] });
    },
    onError: (err: Error) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/disconnect-stripe", {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to disconnect");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Stripe disconnected" });
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isConnected = stripeStatus?.connected ?? false;

  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid="card-integration-stripe">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-expand-stripe"
      >
        <div className="w-8 h-8 rounded-md bg-[#635bff]/10 flex items-center justify-center shrink-0">
          <CreditCard className="w-4 h-4 text-[#635bff]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Stripe</p>
          <p className="text-xs text-muted-foreground">Sync payment data via OAuth or API key</p>
        </div>
        {statusLoading ? (
          <Skeleton className="h-5 w-20" />
        ) : isConnected ? (
          <Badge className="text-xs gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-100" data-testid="badge-stripe-connected">
            <CheckCircle2 className="w-3 h-3" />Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground" data-testid="badge-stripe-disconnected">Not connected</Badge>
        )}
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          {/* Webhook URL — always shown so user can set it up in Stripe */}
          {userId && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1.5">
              <p className="text-xs font-semibold">Stripe Webhook URL</p>
              <p className="text-[11px] text-muted-foreground">
                Add this in <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noreferrer" className="underline">Stripe Dashboard → Webhooks</a>.
                Listen for <code className="bg-muted px-0.5 rounded">checkout.session.completed</code> and <code className="bg-muted px-0.5 rounded">payment_intent.succeeded</code>.
                SiteAmoeba will automatically match every payment to the right visitor — no revenue amount needed in the pixel.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-[11px] bg-muted px-2 py-1 rounded flex-1 overflow-auto select-all whitespace-nowrap">
                  {getApiBaseUrl()}/api/webhooks/stripe/account/{userId}
                </code>
                <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs" onClick={() =>
                  navigator.clipboard.writeText(getApiBaseUrl() + "/api/webhooks/stripe/account/" + userId)
                }>Copy</Button>
              </div>
            </div>
          )}
          {statusLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : isConnected ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground space-y-1">
                {stripeStatus?.accountId && (
                  <p data-testid="text-stripe-account-id">Account ID: <span className="font-mono">{stripeStatus.accountId}</span></p>
                )}
                {stripeStatus?.recentCharges !== undefined && (
                  <p data-testid="text-stripe-recent-charges">
                    {stripeStatus.recentCharges} recent transaction{stripeStatus.recentCharges !== 1 ? "s" : ""} synced
                  </p>
                )}
                {stripeStatus?.connectedAt && (
                  <p>Connected {new Date(stripeStatus.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncStripeMutation.mutate()}
                  disabled={syncStripeMutation.isPending}
                  data-testid="button-sync-stripe"
                >
                  {syncStripeMutation.isPending ? "Syncing..." : syncStripeMutation.isSuccess ? `Synced ${(syncStripeMutation.data as any)?.matched ?? 0} new` : "Sync Now"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  data-testid="button-disconnect-stripe"
                  className="text-destructive hover:text-destructive"
                >
                  {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect Stripe"}
                </Button>
              </div>
            </div>
          ) : showFallback ? (
            <div className="space-y-3">
              <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-medium mb-1">Use a Restricted API Key</p>
                <p className="text-amber-700 dark:text-amber-400">Stripe Connect OAuth is not available. Use a restricted key instead:</p>
                <ol className="list-decimal list-inside mt-1.5 space-y-0.5">
                  <li>Go to <strong>Stripe Dashboard</strong> → Developers → API Keys</li>
                  <li>Click <strong>Create restricted key</strong></li>
                  <li>Grant <em>read-only</em> access to <strong>Charges</strong> and <strong>Customers</strong></li>
                  <li>Copy the key (starts with <code className="bg-amber-100 dark:bg-amber-800 rounded px-1">rk_live_</code> or <code className="bg-amber-100 dark:bg-amber-800 rounded px-1">rk_test_</code>)</li>
                </ol>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stripe-restricted-key" className="text-xs font-medium">Restricted API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="stripe-restricted-key"
                    type="password"
                    placeholder="rk_live_..."
                    value={stripeKey}
                    onChange={(e) => setStripeKey(e.target.value)}
                    className="h-9 text-xs flex-1 font-mono"
                    data-testid="input-stripe-restricted-key"
                  />
                  <Button
                    size="sm"
                    onClick={() => connectKeyMutation.mutate()}
                    disabled={!stripeKey || connectKeyMutation.isPending}
                    data-testid="button-connect-stripe-key"
                    className="gap-1.5 bg-[#635bff] hover:bg-[#5549e8] text-white shrink-0"
                  >
                    {connectKeyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Connect
                  </Button>
                </div>
              </div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setShowFallback(false)}
                data-testid="button-stripe-back-to-oauth"
              >
                ← Try OAuth instead
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Connect your Stripe account via OAuth to automatically sync charges and attribute revenue to your A/B test variants.
              </p>
              <Button
                size="sm"
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                data-testid="button-connect-stripe"
                className="gap-1.5 bg-[#635bff] hover:bg-[#5549e8] text-white"
              >
                {connectMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...</>
                ) : (
                  <><ExternalLink className="w-3.5 h-3.5" /> Connect with Stripe</>
                )}
              </Button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline block"
                onClick={() => setShowFallback(true)}
                data-testid="button-stripe-use-key-instead"
              >
                Use a restricted API key instead
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----- Shopify Integration -----
function ShopifyIntegration({ userId }: { userId?: number }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [storeUrl, setStoreUrl] = useState("");
  const [saved, setSaved] = useState(false);

  const webhookUrl = userId ? `${PROD_BASE}/api/webhooks/shopify/user/${userId}` : "";
  const isConnected = saved;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/shopify-store", { storeUrl });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      toast({ title: "Shopify store saved", description: "Webhook URL is ready to use." });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid="card-integration-shopify">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-expand-shopify"
      >
        <div className="w-8 h-8 rounded-md bg-[#96bf48]/10 flex items-center justify-center shrink-0">
          <ShoppingBag className="w-4 h-4 text-[#96bf48]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Shopify</p>
          <p className="text-xs text-muted-foreground">Track orders via webhook</p>
        </div>
        {isConnected ? (
          <Badge className="text-xs gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-100" data-testid="badge-shopify-connected">
            <CheckCircle2 className="w-3 h-3" />Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground" data-testid="badge-shopify-disconnected">Not connected</Badge>
        )}
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-border space-y-4">
          {userId && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Your webhook URL</p>
              <UrlRow url={webhookUrl} testId="shopify-webhook-url" />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="shopify-store-url" className="text-xs font-medium">Store URL <span className="text-muted-foreground">(optional — for your reference)</span></Label>
            <div className="flex gap-2">
              <Input
                id="shopify-store-url"
                placeholder="mystore.myshopify.com"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                className="h-9 text-xs flex-1"
                data-testid="input-shopify-store-url"
              />
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!storeUrl || saveMutation.isPending}
                data-testid="button-save-shopify"
                className="gap-1 bg-[#96bf48] hover:bg-[#7da33a] text-white"
              >
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save
              </Button>
            </div>
          </div>

          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Setup instructions</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to <strong className="text-foreground">Shopify Admin</strong> → Settings → Notifications</li>
              <li>Scroll to <strong className="text-foreground">Webhooks</strong> → Create webhook</li>
              <li>Set Event: <em>Order payment</em></li>
              <li>Paste the webhook URL above</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- GoHighLevel Integration -----
function GoHighLevelIntegration({ userId, webhookSecret }: { userId?: number; webhookSecret?: string | null }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [localSecret, setLocalSecret] = useState<string | null>(webhookSecret || null);
  const [generatingSecret, setGeneratingSecret] = useState(false);

  const webhookUrl = userId ? `${PROD_BASE}/api/webhooks/ghl/${userId}` : "";

  const handleGenerateSecret = async () => {
    setGeneratingSecret(true);
    try {
      const res = await apiRequest("POST", "/api/settings/generate-webhook-secret");
      if (!res.ok) throw new Error("Failed to generate secret");
      const data = await res.json();
      setLocalSecret(data.secret);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Webhook secret generated" });
    } catch {
      toast({ title: "Failed to generate secret", variant: "destructive" });
    } finally {
      setGeneratingSecret(false);
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid="card-integration-ghl">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-expand-ghl"
      >
        <div className="w-8 h-8 rounded-md bg-[#f97316]/10 flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-[#f97316]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">GoHighLevel</p>
          <p className="text-xs text-muted-foreground">CRM & pipeline webhook</p>
        </div>
        <Badge variant="outline" className="text-xs text-muted-foreground" data-testid="badge-ghl-status">Webhook</Badge>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-border space-y-4">
          {userId && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Webhook URL</p>
              <UrlRow url={webhookUrl} testId="ghl-webhook-url" />
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1">Webhook Secret <span className="text-xs">(send as <code className="bg-muted rounded px-1">x-webhook-secret</code> header)</span></p>
            {localSecret ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted rounded-md px-3 py-2 text-xs font-mono text-foreground truncate" data-testid="text-ghl-webhook-secret">{localSecret}</code>
                <CopyButton text={localSecret} testId="button-copy-ghl-secret" />
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                onClick={handleGenerateSecret}
                disabled={generatingSecret}
                data-testid="button-generate-ghl-secret"
              >
                {generatingSecret ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Generate Secret
              </Button>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Expected payload format</p>
            <div className="bg-muted rounded-md p-3">
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">{`{
  "event": "opportunity.won",
  "contact": { "email": "customer@example.com" },
  "opportunity": { "monetary_value": 297.00 }
}`}</pre>
            </div>
          </div>

          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Setup in GoHighLevel</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to <strong className="text-foreground">Settings</strong> → Webhooks → Add Webhook</li>
              <li>Set Event: <em>Contact created</em> or <em>Opportunity won</em></li>
              <li>Paste the webhook URL above</li>
              <li>Add header <code className="bg-muted rounded px-1">x-webhook-secret</code> with your secret</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Generic Webhook Integration -----
function GenericWebhookIntegration({ userId, webhookSecret }: { userId?: number; webhookSecret?: string | null }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [localSecret, setLocalSecret] = useState<string | null>(webhookSecret || null);
  const [generatingSecret, setGeneratingSecret] = useState(false);

  const webhookUrl = userId ? `${PROD_BASE}/api/webhooks/generic/user/${userId}` : "";

  const handleGenerateSecret = async () => {
    setGeneratingSecret(true);
    try {
      const res = await apiRequest("POST", "/api/settings/generate-webhook-secret");
      if (!res.ok) throw new Error("Failed to generate secret");
      const data = await res.json();
      setLocalSecret(data.secret);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Webhook secret generated" });
    } catch {
      toast({ title: "Failed to generate secret", variant: "destructive" });
    } finally {
      setGeneratingSecret(false);
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid="card-integration-generic">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-expand-generic-webhook"
      >
        <div className="w-8 h-8 rounded-md bg-sky-500/10 flex items-center justify-center shrink-0">
          <Webhook className="w-4 h-4 text-sky-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Generic Webhook</p>
          <p className="text-xs text-muted-foreground">Any platform via JSON POST</p>
        </div>
        <Badge variant="outline" className="text-xs text-muted-foreground" data-testid="badge-generic-status">Webhook</Badge>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-border space-y-4">
          {userId && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Webhook URL</p>
              <UrlRow url={webhookUrl} testId="generic-webhook-url" />
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1">Webhook Secret <span className="text-xs">(send as <code className="bg-muted rounded px-1">x-webhook-secret</code> header)</span></p>
            {localSecret ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted rounded-md px-3 py-2 text-xs font-mono text-foreground truncate" data-testid="text-generic-webhook-secret">{localSecret}</code>
                <CopyButton text={localSecret} testId="button-copy-generic-secret" />
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                onClick={handleGenerateSecret}
                disabled={generatingSecret}
                data-testid="button-generate-generic-secret"
              >
                {generatingSecret ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Generate Secret
              </Button>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">JSON payload format</p>
            <div className="bg-muted rounded-md p-3">
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">{`{
  "email": "customer@example.com",
  "amount": 97.00,
  "event_type": "purchase",
  "currency": "USD",
  "external_id": "order_123"
}`}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Whop Integration -----
function WhopIntegration({ userId }: { userId?: number }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const { data: whopStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    connected: boolean;
    connectedAt?: string;
  }>({
    queryKey: ["/api/settings/whop-status"],
  });

  const isConnected = whopStatus?.connected ?? false;

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/connect-whop", { apiKey });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to connect");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Whop connected!", description: "Your Whop API key has been saved and verified." });
      setApiKey("");
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/settings/whop-status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/disconnect-whop", {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to disconnect");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Whop disconnected" });
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid="card-integration-whop">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-expand-whop"
      >
        <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-purple-600 dark:text-purple-400">W</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Whop</p>
          <p className="text-xs text-muted-foreground">Track payments via webhook</p>
        </div>
        {statusLoading ? (
          <Skeleton className="h-5 w-20" />
        ) : isConnected ? (
          <Badge className="text-xs gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-100" data-testid="badge-whop-connected">
            <CheckCircle2 className="w-3 h-3" />Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground" data-testid="badge-whop-disconnected">Not connected</Badge>
        )}
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-border space-y-4">
          {statusLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : isConnected ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground space-y-1">
                {whopStatus?.connectedAt && (
                  <p>Connected {new Date(whopStatus.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Whop purchases are synced automatically and attributed to your campaigns.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="button-disconnect-whop"
                className="text-destructive hover:text-destructive"
              >
                {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect Whop"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="whop-api-key" className="text-xs font-medium">Company API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="whop-api-key"
                    type="password"
                    placeholder="whop_..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="h-9 text-xs flex-1 font-mono"
                    data-testid="input-whop-api-key"
                  />
                  <Button
                    size="sm"
                    onClick={() => connectMutation.mutate()}
                    disabled={!apiKey || connectMutation.isPending}
                    data-testid="button-connect-whop"
                    className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white shrink-0"
                  >
                    {connectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Connect
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your key from <strong className="text-foreground">Whop Dashboard</strong> → Developer → Company API Keys
                </p>
              </div>

              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                Once connected, SiteAmoeba automatically syncs your Whop purchases and attributes them to your campaigns — no webhook setup required.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IntegrationsCard({ userId, webhookSecret }: { userId?: number; webhookSecret?: string | null }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plug className="w-4 h-4" />
          Integrations
        </CardTitle>
        <CardDescription className="text-xs">
          Connect your payment and marketing platforms to track revenue across all campaigns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <StripeIntegration userId={userId} />
        <WhopIntegration userId={userId} />
        <ShopifyIntegration userId={userId} />
        <GoHighLevelIntegration userId={userId} webhookSecret={webhookSecret} />
        <GenericWebhookIntegration userId={userId} webhookSecret={webhookSecret} />
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  if (!authLoading && !isAuthenticated) {
    navigate("/auth");
    return null;
  }

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">

        {/* Account info card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <UserIcon className="w-4 h-4" />
              Account Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {authLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-5 w-44" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                    {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <div className="text-sm font-medium" data-testid="text-user-name">
                      {user?.name}
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="text-user-email">
                      {user?.email}
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span data-testid="text-settings-email">{user?.email}</span>
                  </div>
                  {memberSince && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      <span data-testid="text-member-since">Member since {memberSince}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Plan summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            {authLoading ? (
              <Skeleton className="h-6 w-40" />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Badge
                    variant="default"
                    className="capitalize mb-2"
                    data-testid="badge-settings-plan"
                  >
                    {user?.plan ?? "free"}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {PLAN_LABELS[user?.plan ?? "free"]}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="tabular-nums" data-testid="text-settings-campaigns-limit">
                      {user?.campaignsLimit ?? 1}
                    </span>{" "}
                    campaign{(user?.campaignsLimit ?? 1) !== 1 ? "s" : ""} &nbsp;·&nbsp;{" "}
                    <span className="tabular-nums">
                      {((user?.creditsLimit ?? 10) * 100).toLocaleString()}
                    </span>{" "}
                    visitors/mo
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/billing")}
                  data-testid="button-settings-upgrade"
                >
                  Manage plan
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Configuration */}
        <AIConfigCard currentProvider={(user as any)?.llmProvider} />

        {/* Integrations */}
        <IntegrationsCard
          userId={user?.id}
          webhookSecret={(user as any)?.webhookSecret}
        />

        {/* Testing Settings */}
        <TestingSettingsCard
          minVisitors={(user as any)?.minVisitorsPerVariant ?? 100}
          confidenceThreshold={(user as any)?.winConfidenceThreshold ?? 95}
        />

        {/* Credit Overage */}
        {(user?.plan && user.plan !== "free") && (
          <CreditOverageCard
            allowOverage={(user as any)?.allowOverage ?? false}
            overageUsed={(user as any)?.overageCreditsUsed ?? 0}
          />
        )}

        {/* Your Feedback */}
        <YourFeedbackSection isAuthenticated={isAuthenticated} />

        {/* Danger zone */}
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-destructive flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-xs">
              Permanently delete your account and all associated data. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              data-testid="button-delete-account"
              disabled
            >
              Delete account
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Contact support to delete your account.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
