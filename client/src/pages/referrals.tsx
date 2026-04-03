import { useState } from "react";
import { Gift, Copy, Check, Users, DollarSign, TrendingUp, ExternalLink, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ReferralStats {
  referralCode: string;
  referralLink: string;
  totalReferred: number;
  activeReferrals: number;
  totalEarned: number;
  pendingEarnings: number;
  referrals: Array<{
    id: number;
    maskedEmail: string;
    plan: string;
    status: string;
    earned: number;
    expiresAt: string;
    createdAt: string;
  }>;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  growth: "Growth",
  scale: "Scale",
  autopilot: "Autopilot",
};

const PLAN_COLORS: Record<string, string> = {
  free: "secondary",
  starter: "outline",
  pro: "default",
  growth: "default",
  scale: "default",
  autopilot: "default",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied to clipboard!" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleCopy}
      data-testid="button-copy-referral-link"
      className="gap-1.5 shrink-0"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          Copy
        </>
      )}
    </Button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subtext?: string;
  iconColor?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ background: iconColor ? `${iconColor}15` : undefined }}
          >
            <Icon
              className="w-4 h-4"
              style={{ color: iconColor || "hsl(var(--muted-foreground))" }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p
              className="text-xl font-bold tabular-nums mt-0.5"
              data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {value}
            </p>
            {subtext && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReferralsPage() {
  const { data, isLoading } = useQuery<ReferralStats>({
    queryKey: ["/api/referral/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/referral/stats");
      if (!res.ok) throw new Error("Failed to load referral data");
      return res.json();
    },
  });

  const referralLink = data?.referralLink || "";
  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    "I use SiteAmoeba to run A/B tests on my landing pages. Sign up with my link and we both benefit!"
  )}&url=${encodeURIComponent(referralLink)}`;
  const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(referralLink)}`;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl"
            style={{
              background: "hsl(160 84% 36% / 0.12)",
              border: "1px solid hsl(160 84% 36% / 0.25)",
            }}
          >
            <Gift className="w-5 h-5" style={{ color: "hsl(160 84% 36%)" }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Referral Program</h1>
            <p className="text-sm text-muted-foreground">
              Earn 20% of every subscription payment for 1 year, per referral.
            </p>
          </div>
        </div>

        {/* Referral link gradient card */}
        <div
          className="rounded-xl p-5 relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, hsl(160 84% 36% / 0.12) 0%, hsl(200 80% 50% / 0.08) 100%)",
            border: "1px solid hsl(160 84% 36% / 0.25)",
          }}
          data-testid="card-referral-link"
        >
          {/* Subtle shimmer */}
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              background:
                "radial-gradient(ellipse at top left, hsl(160 84% 36% / 0.20), transparent 60%)",
            }}
          />
          <div className="relative space-y-3">
            <div className="flex items-center gap-2">
              <Gift
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(160 84% 36%)" }}
              />
              <span className="text-sm font-semibold">Your Referral Link</span>
            </div>

            {isLoading ? (
              <Skeleton className="h-9 w-full rounded-lg" />
            ) : (
              <div className="flex items-center gap-2 bg-background/70 rounded-lg px-3 py-2 border border-border/60">
                <span
                  className="text-sm font-mono text-muted-foreground flex-1 min-w-0 truncate"
                  data-testid="text-referral-link"
                >
                  {referralLink}
                </span>
                <CopyButton text={referralLink} />
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <span className="text-xs text-muted-foreground">Share on:</span>
              <a
                href={twitterShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-share-twitter"
              >
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 bg-background/70">
                  <ExternalLink className="w-3 h-3" />
                  X / Twitter
                </Button>
              </a>
              <a
                href={linkedinShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-share-linkedin"
              >
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 bg-background/70">
                  <Share2 className="w-3 h-3" />
                  LinkedIn
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={Users}
            label="People Referred"
            value={isLoading ? "—" : (data?.totalReferred ?? 0)}
            iconColor="hsl(220 80% 55%)"
            subtext="Total sign-ups via your link"
          />
          <StatCard
            icon={TrendingUp}
            label="Active Referrals"
            value={isLoading ? "—" : (data?.activeReferrals ?? 0)}
            iconColor="hsl(160 84% 36%)"
            subtext="Earning commission now"
          />
          <StatCard
            icon={DollarSign}
            label="Total Earned"
            value={isLoading ? "—" : `$${(data?.totalEarned ?? 0).toFixed(2)}`}
            iconColor="hsl(40 90% 50%)"
            subtext="Payouts via Stripe Connect (coming soon)"
          />
        </div>

        {/* How it works */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Gift className="w-4 h-4" style={{ color: "hsl(160 84% 36%)" }} />
              How It Works
            </CardTitle>
            <CardDescription className="text-xs">
              No cap on earnings — refer as many people as you like.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 pb-4">
            {[
              {
                step: "1",
                title: "Share your link",
                desc: "Send your unique referral link to anyone who might benefit from SiteAmoeba.",
              },
              {
                step: "2",
                title: "They sign up and use SiteAmoeba",
                desc: "When they register via your link, they're linked to your account.",
              },
              {
                step: "3",
                title: "You earn 20% for 1 year",
                desc: "You receive 20% of their subscription payments for 12 months after they sign up.",
              },
              {
                step: "4",
                title: "No cap on earnings",
                desc: (
                  <span>
                    Refer 10 Pro users and earn{" "}
                    <span className="font-semibold text-foreground">
                      ~$564/year
                    </span>
                    . Refer 10 Scale users and earn{" "}
                    <span className="font-semibold text-foreground">
                      ~$3,588/year
                    </span>
                    .
                  </span>
                ),
              },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 py-3">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                  style={{
                    background: "hsl(160 84% 36% / 0.15)",
                    color: "hsl(160 84% 36%)",
                  }}
                >
                  {item.step}
                </div>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Referral list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Your Referrals</CardTitle>
            <CardDescription className="text-xs">
              People who signed up via your link.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : !data?.referrals || data.referrals.length === 0 ? (
              <div
                className="text-center py-10 rounded-lg border border-dashed"
                data-testid="empty-referrals"
              >
                <Gift
                  className="w-8 h-8 mx-auto mb-3 opacity-30"
                  style={{ color: "hsl(160 84% 36%)" }}
                />
                <p className="text-sm font-medium text-muted-foreground">
                  No referrals yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Share your link to start earning!
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">User</TableHead>
                    <TableHead className="text-xs">Plan</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Your Earnings</TableHead>
                    <TableHead className="text-xs">Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.referrals.map((r) => (
                    <TableRow key={r.id} data-testid={`row-referral-${r.id}`}>
                      <TableCell className="text-xs font-mono">
                        {r.maskedEmail}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={(PLAN_COLORS[r.plan] || "secondary") as any}
                          className="text-xs capitalize"
                          data-testid={`badge-plan-${r.id}`}
                        >
                          {PLAN_LABELS[r.plan] || r.plan}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.status === "active" ? "default" : "secondary"}
                          className="text-xs capitalize"
                          style={
                            r.status === "active"
                              ? {
                                  background: "hsl(160 84% 36% / 0.15)",
                                  color: "hsl(160 84% 36%)",
                                  border: "1px solid hsl(160 84% 36% / 0.3)",
                                }
                              : undefined
                          }
                          data-testid={`badge-status-${r.id}`}
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-medium">
                        ${r.earned.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.expiresAt ? r.expiresAt.slice(0, 10) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Payout notice */}
        <div
          className="rounded-lg px-4 py-3 text-xs text-muted-foreground"
          style={{
            background: "hsl(var(--muted) / 0.5)",
            border: "1px solid hsl(var(--border))",
          }}
        >
          <strong className="text-foreground">Payouts:</strong> Commission is
          tracked now and will be paid out via Stripe Connect once it becomes
          available. Enterprise plan referrals are excluded.
        </div>
      </div>
    </div>
  );
}
