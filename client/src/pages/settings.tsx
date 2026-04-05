import { useState } from "react";
import { useLocation } from "wouter";
import { User as UserIcon, Mail, Calendar, CreditCard, Trash2, Sparkles, Eye, EyeOff, Check, FlaskConical, Coins, MessageSquarePlus, Plug, CheckCircle2, AlertTriangle } from "lucide-react";
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
import { apiRequest } from "@/lib/queryClient";
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
};

function AIConfigCard({ currentProvider }: { currentProvider?: string | null }) {
  const { toast } = useToast();
  const [provider, setProvider] = useState(currentProvider || "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

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
            </SelectContent>
          </Select>
        </div>

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

function StripeConnectCard() {
  const { toast } = useToast();
  const [stripeKey, setStripeKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const { data: stripeStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    connected: boolean;
    accountId?: string;
    recentCharges?: number;
    connectedAt?: string;
  }>({
    queryKey: ["/api/settings/stripe-status"],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/connect-stripe", {
        stripeSecretKey: stripeKey,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to connect Stripe");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setStripeKey("");
      toast({
        title: "Stripe connected",
        description: data.accountName ? `Connected to ${data.accountName}` : "Stripe account connected successfully",
      });
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plug className="w-4 h-4" />
          Integrations
        </CardTitle>
        <CardDescription className="text-xs">
          Connect external services to automatically sync transaction data across all your campaigns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stripe Connect */}
        <div className="rounded-md border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#635bff]" />
            <span className="text-sm font-medium">Stripe</span>
            {isConnected && (
              <Badge variant="secondary" className="text-xs gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </Badge>
            )}
          </div>

          {statusLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : isConnected ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground space-y-1">
                {stripeStatus?.accountId && (
                  <p data-testid="text-stripe-account-id">Account: <span className="font-mono">{stripeStatus.accountId}</span></p>
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="button-disconnect-stripe"
                className="text-destructive hover:text-destructive"
              >
                {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="stripe-secret-key" className="text-xs font-medium">Stripe Secret Key</Label>
                <div className="relative">
                  <Input
                    id="stripe-secret-key"
                    type={showKey ? "text" : "password"}
                    placeholder="sk_live_..."
                    value={stripeKey}
                    onChange={(e) => setStripeKey(e.target.value)}
                    className="pr-10 h-9 font-mono text-xs"
                    data-testid="input-stripe-secret-key"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    data-testid="button-toggle-stripe-key-visibility"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Your key is encrypted and only used to read transaction data.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => connectMutation.mutate()}
                disabled={!stripeKey || connectMutation.isPending}
                data-testid="button-connect-stripe"
                className="gap-1.5"
              >
                {connectMutation.isPending ? "Connecting..." : "Connect Stripe"}
              </Button>
            </div>
          )}
        </div>
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

        {/* Integrations (Stripe) */}
        <StripeConnectCard />

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
