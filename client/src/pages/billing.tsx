import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, CreditCard, ExternalLink, Zap, Brain, Rocket, Crown, CircleCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// New plan data with updated pricing structure
const NEW_PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    betaPrice: 0,
    icon: Zap,
    tagline: "BYOK — bring your own AI key",
    highlight: false,
    badge: null as string | null,
    features: [
      "BYOK — connect your own AI key",
      "Unlimited campaigns & visitors",
      "Headlines & subheadlines testing",
      "AI variant generation (your key)",
      "Analytics dashboard",
      "Embed widget & conversion pixel",
      "Behavioral tracking",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 47,
    betaPrice: 23.50,
    icon: Brain,
    tagline: "Brain-powered testing",
    highlight: false,
    badge: "Beta — 50% off" as string | null,
    features: [
      "Everything in Free",
      "Brain access — AI trained on real tests",
      "1,000 AI credits/month",
      "All page sections (CTAs, social proof, body copy)",
      "Brain Chat for guided optimization",
      "Daily observations",
      "3 concurrent tests",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: 97,
    betaPrice: 48.50,
    icon: Crown,
    tagline: "Scale your testing program",
    highlight: false,
    badge: "Beta — 50% off" as string | null,
    features: [
      "Everything in Pro",
      "2,400 AI credits/month",
      "Multi-seat team access",
      "Advanced analytics & CSV exports",
      "Custom webhook integrations",
      "5 concurrent tests",
    ],
  },
  {
    id: "autopilot",
    name: "Autopilot",
    price: 299,
    betaPrice: 149.50,
    icon: Rocket,
    tagline: "Full autonomous optimization",
    highlight: true,
    badge: "Most Popular — 50% off",
    features: [
      "Everything in Business",
      "6,000 AI credits/month",
      "Autonomous page optimization — no manual work",
      "Continuous multi-section testing",
      "AI-driven winner promotion",
      "Unlimited concurrent tests",
    ],
  },
];

export default function BillingPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);

  // After Stripe checkout redirect: detect success param, sync subscription, refresh user
  useEffect(() => {
    const hash = window.location.hash || "";
    const isSuccess = hash.includes("success=true");
    const isCanceled = hash.includes("canceled=true");
    if (isSuccess) {
      setCheckoutSuccess(true);
      // Call sync endpoint to verify Stripe subscription and upgrade plan
      apiRequest("POST", "/api/billing/sync").then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }).catch(() => {});
      // Clean URL
      window.history.replaceState(null, "", "/#/billing");
    }
    if (isCanceled) {
      toast({ title: "Checkout canceled", description: "No charges were made." });
      window.history.replaceState(null, "", "/#/billing");
    }
  }, []);

  if (!authLoading && !isAuthenticated) {
    navigate("/auth");
    return null;
  }

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { plan: planId });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Checkout failed",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Portal error",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const currentPlan = user?.plan ?? "free";
  const creditsUsed = user?.creditsUsed ?? 0;
  const creditsLimit = user?.creditsLimit ?? 0;
  const creditsPct = creditsLimit > 0 ? Math.min(100, (creditsUsed / creditsLimit) * 100) : 0;
  const creditsRemaining = Math.max(creditsLimit - creditsUsed, 0);
  const isLow = creditsLimit > 0 && creditsPct >= 80;
  const isExhausted = creditsLimit > 0 && creditsPct >= 100;
  const isFree = currentPlan === "free";

  return (
    <div className="flex flex-col h-full">
      {/* Success banner after checkout */}
      {checkoutSuccess && (
        <div className="bg-green-50 dark:bg-green-950/20 border-b border-green-200 dark:border-green-800 px-6 py-3 flex items-center gap-2">
          <CircleCheck className="w-4 h-4 text-green-600" />
          <p className="text-sm text-green-800 dark:text-green-200 font-medium">Payment successful. Your plan has been upgraded.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border">
        <div>
          <h1 className="text-lg font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your plan and usage</p>
        </div>
        {currentPlan !== "free" && (
          <Button
            variant="outline"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            data-testid="button-manage-billing"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {portalMutation.isPending ? "Redirecting…" : "Manage Billing"}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Current plan card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                Current Plan
              </CardTitle>
              <Badge
                variant="default"
                className="capitalize"
                data-testid="badge-current-plan"
              >
                {currentPlan}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isFree ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">BYOK Mode</span>
                </div>
                <p className="text-xs text-muted-foreground">You're using your own AI API keys — unlimited usage at no cost. Upgrade to access the Brain and get AI credits for generation and analysis.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground font-medium">AI Credits</span>
                    <span className={`tabular-nums font-bold ${isExhausted ? 'text-destructive' : isLow ? 'text-amber-500' : 'text-foreground'}`} data-testid="text-credits-usage">
                      {creditsUsed.toLocaleString()} / {creditsLimit.toLocaleString()} used
                    </span>
                  </div>
                  <Progress
                    value={creditsPct}
                    className={`h-2.5 ${isExhausted ? '[&>div]:bg-destructive' : isLow ? '[&>div]:bg-amber-500' : ''}`}
                    data-testid="progress-credits"
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">{creditsRemaining.toLocaleString()} credits remaining</span>
                    <span className="text-xs text-muted-foreground">Resets monthly</span>
                  </div>
                </div>
                {isExhausted && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                    <Zap className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-destructive">Credits exhausted</p>
                      <p className="text-xs text-muted-foreground mt-0.5">AI generation and observations are paused. Upgrade your plan to continue.</p>
                    </div>
                  </div>
                )}
                {isLow && !isExhausted && (
                  <p className="text-xs text-amber-500 flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Running low on credits. Consider upgrading for more.
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-muted-foreground">Credits used</div>
                <div className="font-semibold tabular-nums" data-testid="text-credits-used">{creditsUsed}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Credits limit</div>
                <div className="font-semibold tabular-nums" data-testid="text-credits-limit">{creditsLimit}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Plan comparison */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Choose a plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {NEW_PLANS.map((plan) => {
              const isCurrent = plan.id === currentPlan;
              const PlanIcon = plan.icon;
              return (
                <div
                  key={plan.id}
                  className="relative"
                  data-testid={`card-plan-${plan.id}`}
                >
                  {/* Autopilot gradient border wrapper */}
                  {plan.highlight ? (
                    <div
                      className="rounded-xl p-[2px]"
                      style={{
                        background: "linear-gradient(135deg, hsl(160 84% 36%) 0%, hsl(152 76% 50%) 100%)",
                      }}
                    >
                      <Card className="rounded-[10px] h-full">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <PlanIcon className="w-4 h-4" style={{ color: "hsl(160 84% 36%)" }} />
                              <CardTitle className="text-sm font-semibold">{plan.name}</CardTitle>
                            </div>
                            <div className="flex items-center gap-1">
                              {isCurrent && (
                                <Badge variant="default" className="text-xs" data-testid={`badge-plan-current-${plan.id}`}>
                                  Current
                                </Badge>
                              )}
                              {plan.badge && !isCurrent && (
                                <Badge
                                  className="text-xs"
                                  style={{ background: "hsl(160 84% 36%)", color: "white" }}
                                >
                                  {plan.badge}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <CardDescription className="text-xs">{plan.tagline}</CardDescription>
                          <div className="mt-1">
                            {plan.betaPrice > 0 ? (
                              <div>
                                <span className="text-xl font-bold tabular-nums">
                                  ${plan.betaPrice}
                                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                                </span>
                                <span className="text-xs text-muted-foreground line-through ml-2">${plan.price}/mo</span>
                              </div>
                            ) : (
                              <span className="text-xl font-bold tabular-nums">
                                ${plan.price}
                                <span className="text-xs font-normal text-muted-foreground">/mo</span>
                              </span>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <ul className="space-y-1.5">
                            {plan.features.map((feature) => (
                              <li key={feature} className="flex items-start gap-2 text-xs">
                                <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                          <Button
                            className="w-full"
                            variant={isCurrent ? "outline" : "default"}
                            disabled={isCurrent || checkoutMutation.isPending}
                            onClick={() => !isCurrent && checkoutMutation.mutate(plan.id)}
                            data-testid={`button-plan-${plan.id}`}
                            style={isCurrent ? {} : { background: "hsl(160 84% 36%)" }}
                          >
                            {isCurrent
                              ? "Current plan"
                              : checkoutMutation.isPending
                              ? "Redirecting…"
                              : "Upgrade"}
                          </Button>
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <Card className={isCurrent ? "ring-2 ring-primary h-full" : "h-full"}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5">
                            <PlanIcon className="w-4 h-4 text-muted-foreground" />
                            <CardTitle className="text-sm font-semibold">{plan.name}</CardTitle>
                          </div>
                          {isCurrent && (
                            <Badge variant="default" className="text-xs" data-testid={`badge-plan-current-${plan.id}`}>
                              Current
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs">{plan.tagline}</CardDescription>
                        <div className="mt-1">
                          {plan.price === 0 ? (
                            <span className="text-xl font-bold">Free</span>
                          ) : (
                            <div>
                              <span className="text-xl font-bold tabular-nums">
                                ${plan.betaPrice}
                                <span className="text-xs font-normal text-muted-foreground">/mo</span>
                              </span>
                              <span className="text-xs text-muted-foreground line-through ml-2">${plan.price}/mo</span>
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <ul className="space-y-1.5">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2 text-xs">
                              <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                        {plan.price === 0 ? (
                          <Button
                            variant="outline"
                            className="w-full"
                            disabled={isCurrent}
                            data-testid={`button-plan-${plan.id}`}
                          >
                            {isCurrent ? "Current plan" : "Downgrade"}
                          </Button>
                        ) : (
                          <Button
                            className="w-full"
                            variant={isCurrent ? "outline" : "default"}
                            disabled={isCurrent || checkoutMutation.isPending}
                            onClick={() => checkoutMutation.mutate(plan.id)}
                            data-testid={`button-plan-${plan.id}`}
                          >
                            {isCurrent
                              ? "Current plan"
                              : checkoutMutation.isPending
                              ? "Redirecting…"
                              : "Upgrade"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
