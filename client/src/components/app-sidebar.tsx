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

      {/* Brain promo — above footer nav */}
      {isAuthenticated && (
        <div className="pt-3">
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
                <span className="text-sm">Referrals</span>
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
