import { useState, useCallback } from "react";
import { Gift, Copy, Check, Users, DollarSign, TrendingUp, ExternalLink, Share2, Trophy, Download, ArrowUpRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  pro: "Pro",
  business: "Business",
  autopilot: "Autopilot",
};

const PLAN_COLORS: Record<string, string> = {
  free: "secondary",
  pro: "default",
  business: "default",
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

// ---- Win types ----
interface Win {
  id: number;
  campaignId: number;
  campaignName: string;
  pageUrl: string;
  sectionType: string;
  winnerText: string;
  loserText: string;
  winnerConversionRate: number;
  loserConversionRate: number;
  liftPercent: number;
  winnerStrategy: string | null;
  loserStrategy: string | null;
  sampleSize: number;
  confidence: number;
  lesson: string | null;
  createdAt: string;
}

const SECTION_LABELS: Record<string, string> = {
  headline: "Headline",
  subheadline: "Subheadline",
  cta: "CTA",
  body_copy: "Body Copy",
  hero_journey: "Hero Journey",
  social_proof: "Social Proof",
  testimonials: "Testimonials",
  pricing: "Pricing",
  guarantee: "Guarantee",
  faq: "FAQ",
};

const STRATEGY_LABELS: Record<string, string> = {
  transformation: "Transformation",
  how_to: "How-To",
  social_proof: "Social Proof",
  urgency: "Urgency",
  loss_aversion: "Loss Aversion",
  contrarian: "Contrarian",
  feature_benefit: "Feature/Benefit",
  curiosity: "Curiosity",
  problem_agitation: "Problem Agitation",
  authority: "Authority",
};

// Generate shareable winner image
async function generateWinImage(win: Win): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // Background
  const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, '#0d1117');
  grad.addColorStop(0.5, '#0f1a2e');
  grad.addColorStop(1, '#0a1628');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1080);

  // Glow
  const glowGrad = ctx.createRadialGradient(540, 300, 0, 540, 300, 400);
  glowGrad.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
  glowGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, 1080, 1080);

  // Trophy
  ctx.font = '72px serif';
  ctx.textAlign = 'center';
  ctx.fillText('\uD83C\uDFC6', 540, 160);

  // Lift
  ctx.font = 'bold 120px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText(`+${win.liftPercent.toFixed(1)}%`, 540, 310);

  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('CONVERSION LIFT', 540, 360);

  // Divider
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(200, 400); ctx.lineTo(880, 400); ctx.stroke();

  // Stats labels
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('VISITORS', 320, 460);
  ctx.fillText('WINNER CVR', 540, 460);
  ctx.fillText('CONFIDENCE', 760, 460);

  // Stats values
  ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${win.sampleSize.toLocaleString()}`, 320, 510);
  ctx.fillStyle = '#10b981';
  ctx.fillText(`${(win.winnerConversionRate * 100).toFixed(1)}%`, 540, 510);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${win.confidence.toFixed(0)}%`, 760, 510);

  // Winning copy label
  ctx.font = '600 20px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('WINNING VARIANT', 540, 590);

  // Word-wrap winning text
  const cleanText = win.winnerText.replace(/<[^>]*>/g, '');
  const winText = '"' + (cleanText.slice(0, 100) + (cleanText.length > 100 ? '...' : '')) + '"';
  ctx.font = 'italic 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const words = winText.split(' ');
  let line = '';
  let y = 640;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > 780 && line) {
      ctx.fillText(line.trim(), 540, y);
      line = word + ' ';
      y += 34;
      if (y > 730) break;
    } else {
      line = test;
    }
  }
  if (line && y <= 730) ctx.fillText(line.trim(), 540, y);

  // Campaign name
  ctx.font = '500 20px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const campName = win.campaignName.length > 50 ? win.campaignName.slice(0, 50) + '...' : win.campaignName;
  ctx.fillText(campName, 540, 820);

  // Branding
  ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText('SiteAmoeba', 540, 920);
  ctx.font = '500 18px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('AI-Powered A/B Testing', 540, 955);
  ctx.font = '500 16px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
  ctx.fillText('siteamoeba.com', 540, 1000);

  return canvas.toDataURL('image/png');
}

// ---- Win Card ----
function WinCard({ win }: { win: Win }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const cleanWinner = win.winnerText.replace(/<[^>]*>/g, '');
  const cleanLoser = win.loserText.replace(/<[^>]*>/g, '');
  const date = new Date(win.createdAt);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const dataUrl = await generateWinImage(win);
      const link = document.createElement('a');
      link.download = `siteamoeba-win-${win.liftPercent.toFixed(0)}pct-lift.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast({ title: "Error generating image", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="overflow-hidden" data-testid={`card-win-${win.id}`}>
      {/* Green accent top bar */}
      <div className="h-1" style={{ background: 'linear-gradient(90deg, hsl(160 84% 36%), hsl(160 84% 50%))' }} />
      <CardContent className="pt-4 pb-4 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg" style={{ background: 'hsl(160 84% 36% / 0.12)' }}>
              <Trophy className="w-4 h-4" style={{ color: 'hsl(45 90% 55%)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" data-testid={`text-win-campaign-${win.id}`}>
                {win.campaignName}
              </p>
              <p className="text-xs text-muted-foreground">
                {SECTION_LABELS[win.sectionType] || win.sectionType} &middot; {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold tabular-nums" style={{ color: 'hsl(160 84% 36%)' }}>
              +{win.liftPercent.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">lift</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border p-2">
            <p className="text-sm font-bold tabular-nums">{win.sampleSize.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Visitors</p>
          </div>
          <div className="rounded-lg border p-2" style={{ borderColor: 'hsl(160 84% 36% / 0.3)', background: 'hsl(160 84% 36% / 0.05)' }}>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'hsl(160 84% 36%)' }}>
              {(win.winnerConversionRate * 100).toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">Winner CVR</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-sm font-bold tabular-nums">{win.confidence.toFixed(0)}%</p>
            <p className="text-[10px] text-muted-foreground">Confidence</p>
          </div>
        </div>

        {/* Winner vs Loser */}
        <div className="space-y-2">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Trophy className="w-3 h-3" style={{ color: 'hsl(160 84% 36%)' }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Winner</span>
              {win.winnerStrategy && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 ml-auto">
                  {STRATEGY_LABELS[win.winnerStrategy] || win.winnerStrategy}
                </Badge>
              )}
            </div>
            <p className="text-xs leading-relaxed italic text-foreground">
              &ldquo;{cleanWinner.slice(0, 150)}{cleanWinner.length > 150 ? '...' : ''}&rdquo;
            </p>
          </div>
          <div className="rounded-lg border px-3 py-2 opacity-60">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Control</span>
              {win.loserStrategy && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 ml-auto">
                  {STRATEGY_LABELS[win.loserStrategy] || win.loserStrategy}
                </Badge>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              &ldquo;{cleanLoser.slice(0, 120)}{cleanLoser.length > 120 ? '...' : ''}&rdquo;
            </p>
          </div>
        </div>

        {/* Lesson (if available) */}
        {win.lesson && (
          <details className="group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Sparkles className="w-3 h-3" />
              <span>AI Insight</span>
            </summary>
            <p className="text-xs text-muted-foreground leading-relaxed mt-2 pl-5">
              {win.lesson}
            </p>
          </details>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={handleDownload}
            disabled={downloading}
            data-testid={`button-download-win-${win.id}`}
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Generating...' : 'Download Image'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Wins Library ----
function WinsLibrary() {
  const { data: wins, isLoading } = useQuery<Win[]>({
    queryKey: ["/api/wins"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wins");
      if (!res.ok) throw new Error("Failed to load wins");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
      </div>
    );
  }

  if (!wins || wins.length === 0) {
    return (
      <div className="text-center py-16 rounded-xl border border-dashed" data-testid="empty-wins">
        <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" style={{ color: 'hsl(45 90% 55%)' }} />
        <p className="text-sm font-medium text-muted-foreground">No wins yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
          When you declare a winning variant on any campaign, it'll appear here with a shareable results image.
        </p>
      </div>
    );
  }

  // Aggregate stats
  const totalLifts = wins.length;
  const avgLift = wins.reduce((sum, w) => sum + w.liftPercent, 0) / wins.length;
  const totalVisitorsTested = wins.reduce((sum, w) => sum + w.sampleSize, 0);

  return (
    <div className="space-y-6">
      {/* Aggregate stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Trophy}
          label="Tests Won"
          value={totalLifts}
          iconColor="hsl(45 90% 55%)"
          subtext="Declared winners with positive lift"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg. Lift"
          value={`+${avgLift.toFixed(1)}%`}
          iconColor="hsl(160 84% 36%)"
          subtext="Average conversion lift across wins"
        />
        <StatCard
          icon={Users}
          label="Visitors Tested"
          value={totalVisitorsTested.toLocaleString()}
          iconColor="hsl(220 80% 55%)"
          subtext="Total sample size across all tests"
        />
      </div>

      {/* Win cards */}
      <div className="space-y-4">
        {wins.map(win => <WinCard key={win.id} win={win} />)}
      </div>
    </div>
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
      <div className="max-w-3xl mx-auto w-full px-6 py-8 space-y-6">
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
            <h1 className="text-lg font-semibold">Referrals & Wins</h1>
            <p className="text-sm text-muted-foreground">
              Share your wins and earn from referrals.
            </p>
          </div>
        </div>

        <Tabs defaultValue="wins" className="w-full">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="wins" className="gap-1.5" data-testid="tab-wins">
              <Trophy className="w-3.5 h-3.5" />
              Wins Library
            </TabsTrigger>
            <TabsTrigger value="referrals" className="gap-1.5" data-testid="tab-referrals">
              <Gift className="w-3.5 h-3.5" />
              Referral Program
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wins" className="mt-6">
            <WinsLibrary />
          </TabsContent>

          <TabsContent value="referrals" className="mt-6 space-y-8">

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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
