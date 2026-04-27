import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  LayoutGrid,
  Plus,
  CreditCard,
  Settings,
  LogOut,
  Globe,
  Users,
  Brain,
  Sparkles,
  ChevronRight,
  MessageSquarePlus,
  Gift,
  Zap,
  Lightbulb,
  BarChart3,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CampaignWithStats {
  id: number;
  name: string;
  url: string;
  isActive: boolean;
  totalVisitors: number;
  conversionRate: number;
  variantCount: number;
}

function SiteAmoebaLogo() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        aria-label="SiteAmoeba logo mark"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Organic amoeba shape */}
        <path
          d="M14 3C10 3 5 5.5 4 10C3 14 5 17 7 19C9 21.5 8 24 11 25.5C14 27 17.5 26 20 24C22.5 22 24.5 20 25 17C25.5 14 24 11 22 9C20 7 18 3 14 3Z"
          fill="hsl(160 84% 36%)"
          opacity="0.15"
        />
        <path
          d="M14 3C10 3 5 5.5 4 10C3 14 5 17 7 19C9 21.5 8 24 11 25.5C14 27 17.5 26 20 24C22.5 22 24.5 20 25 17C25.5 14 24 11 22 9C20 7 18 3 14 3Z"
          stroke="hsl(160 84% 36%)"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Inner amoeba (pseudo-nucleus) */}
        <ellipse cx="13" cy="13.5" rx="4.5" ry="4" fill="hsl(160 84% 36%)" opacity="0.35" />
        {/* Highlight dot */}
        <circle cx="15.5" cy="11.5" r="1.5" fill="hsl(160 84% 36%)" />
      </svg>
      <span className="font-semibold text-sm tracking-tight text-foreground">
        SiteAmoeba
      </span>
    </div>
  );
}

// ---- BYOK Spend Widget (sidebar) ----
// Shows free-plan users their estimated API spend this month + a comparison
// against the Pro plan price. Resolves Malik's feature request:
// "Show how much I've spent with my API. Could easily show how much more
// valuable it is to switch to using the brain."
function BYOKSpendWidget() {
  const { data } = useQuery<{ monthKey: string; costUsd: number; calls: number }>({
    queryKey: ["/api/me/byok-spend"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/me/byok-spend");
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const cost = data?.costUsd ?? 0;
  const calls = data?.calls ?? 0;
  const proPlanPrice = 29; // matches the Pro plan price
  const wouldSave = cost > proPlanPrice;

  return (
    <div className="mx-3 mb-1 px-3 py-2 rounded-lg bg-muted/40 border border-border/50" data-testid="widget-byok-spend">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">API spend (BYOK)</span>
        </div>
        <span className="text-[11px] font-bold tabular-nums text-foreground">
          ${cost.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{calls.toLocaleString()} calls this month</span>
        <span className="opacity-60">est.</span>
      </div>
      {wouldSave ? (
        <div className="mt-1.5 rounded-md bg-primary/10 border border-primary/20 px-2 py-1.5">
          <p className="text-[10px] text-primary font-medium leading-tight">
            Pro plan ($29) would save you ${(cost - proPlanPrice).toFixed(2)} this month.{" "}
            <Link href="/billing" className="underline font-semibold">Upgrade</Link>
          </p>
        </div>
      ) : cost > 0 ? (
        <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
          Pro plan ($29) starts saving once you cross that.
        </p>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground leading-snug">Using your own AI keys.</p>
      )}
    </div>
  );
}

// ---- Credit Usage Widget (sidebar) ----
function CreditUsageWidget({ user }: { user: { plan: string; creditsUsed: number; creditsLimit: number } }) {
  const isFree = user.plan === "free";
  const used = user.creditsUsed || 0;
  const limit = user.creditsLimit || 0;
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const remaining = Math.max(limit - used, 0);
  const isLow = limit > 0 && pct >= 80;
  const isExhausted = limit > 0 && pct >= 100;

  if (isFree) {
    return <BYOKSpendWidget />;
  }

  return (
    <div className="mx-3 mb-1 px-3 py-2 rounded-lg bg-muted/40 border border-border/50" data-testid="widget-usage-credits">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Zap className="w-3 h-3" />
          AI Credits
        </span>
        <span className={`text-[11px] font-bold tabular-nums ${isExhausted ? 'text-destructive' : isLow ? 'text-amber-500' : 'text-foreground'}`}>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isExhausted ? 'bg-destructive' : isLow ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isLow && (
        <div className="mt-1.5">
          {isExhausted ? (
            <Link href="/billing">
              <Button size="sm" variant="destructive" className="h-5 text-[10px] w-full" data-testid="button-credits-upgrade">
                Credits exhausted — Upgrade
              </Button>
            </Link>
          ) : (
            <p className="text-[10px] text-amber-500 font-medium">
              {remaining.toLocaleString()} credits remaining
              {' · '}
              <Link href="/billing" className="underline">Upgrade</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Brain promo card (sidebar) ----
function BrainPromoCard({ plan }: { plan: string }) {
  const isPaid = plan !== "free";

  if (isPaid) {
    return (
      <div
        className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40"
        data-testid="badge-brain-active"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
          <Brain className="w-3 h-3" />
          Brain Active
        </span>
      </div>
    );
  }

  return (
    <div
      className="mx-3 mb-2 rounded-lg p-3 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, hsl(160 84% 36% / 0.08) 0%, hsl(152 76% 45% / 0.06) 100%)",
        border: "1px solid hsl(160 84% 36% / 0.20)",
      }}
      data-testid="card-brain-promo"
    >
      {/* Subtle gradient shimmer */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: "radial-gradient(ellipse at top right, hsl(152 76% 45% / 0.15), transparent 70%)",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-1.5 mb-1">
          <Brain className="w-3.5 h-3.5" style={{ color: "hsl(160 84% 36%)" }} />
          <span className="text-xs font-semibold text-foreground">Unlock the Brain</span>
        </div>
        <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
          AI-powered by 2,847+ real tests
        </p>
        <Link href="/billing">
          <Button
            size="sm"
            className="h-6 text-xs w-full gap-1"
            style={{
              background: "hsl(160 84% 36%)",
              color: "white",
            }}
            data-testid="button-brain-upgrade"
          >
            Upgrade
            <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ---- Feedback Dialog ----
function FeedbackDialog({ open, onOpenChange, campaigns }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: CampaignWithStats[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/feedback", {
        category,
        message,
        campaignId: campaignId ? parseInt(campaignId) : undefined,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit feedback");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      toast({ title: "Feedback sent! We'll review it shortly." });
      setCategory("");
      setCampaignId("");
      setMessage("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = category && message.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-feedback">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquarePlus className="w-4 h-4" />
            Send Feedback
          </DialogTitle>
          <DialogDescription className="text-xs">
            Bug reports, feature ideas, and Brain quality feedback all help us improve.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="feedback-category" className="text-xs font-medium">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                id="feedback-category"
                className="h-9"
                data-testid="select-feedback-category"
              >
                <SelectValue placeholder="What kind of feedback is this?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">Bug Report</SelectItem>
                <SelectItem value="feature_request">Feature Request</SelectItem>
                <SelectItem value="brain_quality">Brain Quality Issue</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Related campaign (optional) */}
          {campaigns.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="feedback-campaign" className="text-xs font-medium">
                Related campaign <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger
                  id="feedback-campaign"
                  className="h-9"
                  data-testid="select-feedback-campaign"
                >
                  <SelectValue placeholder="Select a campaign..." />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="feedback-message" className="text-xs font-medium">Message</Label>
            <Textarea
              id="feedback-message"
              placeholder="What's on your mind? Bug reports, feature ideas, and Brain quality feedback all help us improve."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="resize-none text-sm"
              data-testid="textarea-feedback-message"
            />
            {message.trim().length > 0 && message.trim().length < 10 && (
              <p className="text-xs text-muted-foreground">At least 10 characters required.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-feedback-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
              data-testid="button-feedback-submit"
            >
              {mutation.isPending ? "Sending..." : "Send feedback"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppSidebar() {
  const { logout, isAuthenticated, user } = useAuth();
  const [location] = useLocation();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const { data: campaigns = [] } = useQuery<CampaignWithStats[]>({
    queryKey: ["/api/campaigns"],
    enabled: isAuthenticated,
  });

  const { data: anomalyCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ["/api/campaigns/anomaly-counts"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/campaigns/anomaly-counts");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 60000,
  });

  return (
    <>
    <Sidebar>
      <SidebarHeader className="py-4 px-3">
        <SiteAmoebaLogo />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {/* Campaigns section */}
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5" />
              Campaigns
            </span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Campaign list */}
              {campaigns.map((campaign) => (
                <SidebarMenuItem key={campaign.id} data-testid={`nav-campaign-${campaign.id}`}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === `/campaigns/${campaign.id}`}
                  >
                    <Link href={`/campaigns/${campaign.id}`}>
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: campaign.isActive
                            ? "hsl(160 84% 36%)"
                            : "hsl(220 8% 60%)",
                        }}
                      />
                      <span className="flex-1 truncate text-sm">{campaign.name}</span>
                      {(anomalyCounts[campaign.id] ?? 0) > 0 && (
                        <span
                          className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-400"
                          title={`${anomalyCounts[campaign.id]} new insight${anomalyCounts[campaign.id] !== 1 ? "s" : ""}`}
                          data-testid={`dot-anomaly-${campaign.id}`}
                        />
                      )}
                      <Badge
                        variant="secondary"
                        className="text-xs font-mono tabular-nums ml-auto"
                        data-testid={`badge-visitors-${campaign.id}`}
                      >
                        <Users className="w-2.5 h-2.5 mr-1" />
                        {(campaign.totalVisitors ?? 0).toLocaleString()}
                      </Badge>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Traffic Intelligence link */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/traffic"}>
                  <Link href="/traffic" data-testid="link-traffic">
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-sm">Traffic</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* New Campaign link */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/" data-testid="link-new-campaign">
                    <Plus className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground text-sm">New Campaign</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      {/* Credit usage + Brain promo — above footer nav */}
      {isAuthenticated && user && (
        <div className="pt-3 space-y-1">
          <CreditUsageWidget user={user as any} />
          <BrainPromoCard plan={user?.plan ?? "free"} />
        </div>
      )}

      {/* Footer nav */}
      <SidebarFooter className="pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location === "/billing"}>
              <Link href="/billing" data-testid="link-billing">
                <CreditCard className="w-4 h-4" />
                <span className="text-sm">Billing</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location === "/referrals"}>
              <Link href="/referrals" data-testid="link-referrals">
                <Gift className="w-4 h-4" />
                <span className="text-sm">Referrals & Wins</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location === "/settings"}>
              <Link href="/settings" data-testid="link-settings">
                <Settings className="w-4 h-4" />
                <span className="text-sm">Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setFeedbackOpen(true)}
              data-testid="button-send-feedback"
              className="cursor-pointer"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span className="text-sm">Send Feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => logout()}
              data-testid="button-logout"
              className="cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm">Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
    <FeedbackDialog
      open={feedbackOpen}
      onOpenChange={setFeedbackOpen}
      campaigns={campaigns}
    />
    </>
  );
}
