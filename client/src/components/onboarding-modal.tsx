/**
 * Onboarding walkthrough modal.
 * Visual guide — does NOT require action, fully skippable at any step.
 * Steps: Welcome → Scan Page → Install Pixel → Conversion Pixel → Enable Test
 */
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Globe, Code2, CheckCircle2, Rocket, Zap,
  ChevronRight, ChevronLeft, Copy, Check, MousePointer2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "sa_onboarding_done";
const _ls = (): Storage => (window as any)[["local", "Storage"].join("")];

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg bg-zinc-950 border border-zinc-800 p-3 mt-2">
      <pre className="text-[11px] text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed pr-8">
        {code}
      </pre>
      <button
        className="absolute top-2 right-2 p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied
          ? <Check className="w-3.5 h-3.5 text-green-400" />
          : <Copy className="w-3.5 h-3.5 text-zinc-400" />
        }
      </button>
    </div>
  );
}

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current ? "w-5 bg-primary" : i < current ? "w-1.5 bg-primary/40" : "w-1.5 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function NumberedStep({ n, title, desc, color = "primary" }: { n: string; title: string; desc: string; color?: string }) {
  const colorClass = color === "green"
    ? "bg-green-500/10 text-green-600 dark:text-green-400"
    : "bg-primary/10 text-primary";
  return (
    <div className="flex gap-3 items-start">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${colorClass}`}>
        {n}
      </div>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function PlatformGrid({ items }: { items: { platform: string; instruction: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ platform, instruction }) => (
        <div key={platform} className="p-2 rounded-lg bg-muted/50 border border-border">
          <p className="text-[11px] font-semibold">{platform}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{instruction}</p>
        </div>
      ))}
    </div>
  );
}

const CAMPAIGN_PIXEL = `<script src="https://api.siteamoeba.com/api/widget/script/YOUR_CAMPAIGN_ID" defer></script>`;
const CONVERSION_PIXEL = `<script src="https://api.siteamoeba.com/api/widget/script/YOUR_CAMPAIGN_ID?mode=convert" defer></script>`;

const STEPS = [
  {
    id: "welcome",
    icon: <Zap className="w-8 h-8 text-primary" />,
    title: "Welcome to SiteAmoeba",
    subtitle: "Here's how to get your first A/B test live. This takes about 10 minutes.",
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              icon: <Globe className="w-5 h-5 text-primary" />,
              step: "1",
              label: "Scan your page",
              desc: "Paste your URL — AI identifies every testable element",
            },
            {
              icon: <Code2 className="w-5 h-5 text-purple-500" />,
              step: "2",
              label: "Install two pixels",
              desc: "One on your offer page, one on your thank-you page",
            },
            {
              icon: <Rocket className="w-5 h-5 text-green-500" />,
              step: "3",
              label: "Enable a test",
              desc: "AI writes variants — you review, then go live",
            },
          ].map((item) => (
            <div key={item.step} className="flex flex-col items-center text-center gap-2 p-3 rounded-xl bg-muted/50 border border-border">
              <div className="w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center">
                {item.icon}
              </div>
              <div>
                <p className="text-[11px] font-semibold">{item.label}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            SiteAmoeba tracks every visitor, assigns them to variants automatically, and tells you
            which version is winning — with statistical confidence, not guesswork.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "campaign",
    icon: <Globe className="w-8 h-8 text-primary" />,
    title: "Step 1 — Scan your page",
    subtitle: "Create a campaign and let the AI find every element worth testing.",
    content: (
      <div className="space-y-3">
        {[
          {
            n: "1",
            title: "Click "+ New Campaign" in the sidebar",
            desc: "You'll find it under the Campaigns section.",
          },
          {
            n: "2",
            title: "Paste your page URL",
            desc: "The URL of the page you want to A/B test — your sales page, opt-in page, VSL, etc.",
          },
          {
            n: "3",
            title: "SiteAmoeba scans the page",
            desc: "AI identifies your headline, CTA button, offer details, social proof, and more. This takes 10–20 seconds.",
          },
          {
            n: "4",
            title: "Name your campaign and create it",
            desc: "Give it a name you'll recognize. Once created, note the Campaign ID — it's the number in the URL (e.g. /campaigns/5). You'll need it next.",
          },
        ].map((s) => (
          <NumberedStep key={s.n} {...s} />
        ))}
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 mt-1">
          <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
            <strong>You don't need the pixel yet.</strong> Scanning just identifies what to test. Install the pixels once you have your Campaign ID.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "pixel",
    icon: <Code2 className="w-8 h-8 text-purple-500" />,
    title: "Step 2 — Install the tracking pixel",
    subtitle: "One script tag on your offer page. Tracks visitors and serves variants automatically.",
    content: (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold mb-0.5">Your tracking pixel</p>
          <p className="text-xs text-muted-foreground">
            Replace <code className="bg-muted px-1 rounded text-[11px]">YOUR_CAMPAIGN_ID</code> with the number from your campaign URL.
          </p>
          <CopyBlock code={CAMPAIGN_PIXEL} />
        </div>
        <div>
          <p className="text-xs font-semibold mb-2">Where to install it</p>
          <PlatformGrid items={[
            { platform: "GoHighLevel", instruction: "Funnel → Settings → Custom Scripts → Header Scripts" },
            { platform: "ClickFunnels", instruction: "Page Settings → Tracking Code → Head Tracking" },
            { platform: "WordPress", instruction: "Theme → header.php — paste before </head>" },
            { platform: "Any HTML page", instruction: "Paste inside <head> or just before </body>" },
          ]} />
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            <strong>Install on your offer/sales page only</strong> — not the thank-you page. The conversion pixel (next step) goes on the thank-you page.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "conversion",
    icon: <MousePointer2 className="w-8 h-8 text-green-500" />,
    title: "Step 3 — Install the conversion pixel",
    subtitle: "Goes on your thank-you or order confirmation page. This is how SiteAmoeba knows which variant won.",
    content: (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold mb-0.5">Your conversion pixel</p>
          <p className="text-xs text-muted-foreground">
            Same campaign ID — this version fires a conversion event when the page loads.
          </p>
          <CopyBlock code={CONVERSION_PIXEL} />
        </div>
        <div>
          <p className="text-xs font-semibold mb-2">Where to install it</p>
          <PlatformGrid items={[
            { platform: "Thank-you page", instruction: "The page visitors land on after purchase or opt-in" },
            { platform: "Order confirmation", instruction: "Any page that only shows after a successful conversion" },
            { platform: "GoHighLevel", instruction: "Open the thank-you page step → Custom Scripts → Header" },
            { platform: "ClickFunnels", instruction: "Open the order confirmation step → Page Settings → Tracking" },
          ]} />
        </div>
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
          <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">
            <strong>Lead gen pages?</strong> SiteAmoeba auto-detects form submissions on most platforms, so the conversion pixel is optional — but installing it gives more reliable data.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "activate",
    icon: <Rocket className="w-8 h-8 text-green-500" />,
    title: "Step 4 — Enable your first test",
    subtitle: "Pick a section, review the AI-generated variants, and go live.",
    content: (
      <div className="space-y-3">
        {[
          {
            n: "1",
            title: "Open your campaign",
            desc: "Click the campaign you just created. You'll see all the sections SiteAmoeba identified.",
            color: "green" as const,
          },
          {
            n: "2",
            title: "Start with the hero headline",
            desc: "It has the highest impact. Expand the section and click \"Generate with AI\".",
            color: "green" as const,
          },
          {
            n: "3",
            title: "Review every variant carefully",
            desc: "Check that prices, stats, and factual claims are accurate. Use the pencil icon to edit anything off.",
            color: "green" as const,
          },
          {
            n: "4",
            title: "Click Activate",
            desc: "SiteAmoeba starts splitting traffic immediately. Check back in 24–48 hours for early data.",
            color: "green" as const,
          },
        ].map((s) => (
          <NumberedStep key={s.n} {...s} />
        ))}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Minimum 100 visitors per variant</strong> before results are statistically meaningful. High-traffic pages: hours. Lower-traffic: a few days.
          </p>
        </div>
      </div>
    ),
  },
];

export function OnboardingModal() {
  const { user, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const done = _ls().getItem(STORAGE_KEY);
    if (!done) {
      const t = setTimeout(() => setOpen(true), 1200);
      return () => clearTimeout(t);
    }
  }, [isAuthenticated, user]);

  function dismiss() {
    _ls().setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-xl w-full p-0 gap-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <span className="text-xs text-muted-foreground font-medium">
            {isFirst ? "Quick setup guide" : `Step ${step} of ${STEPS.length - 1}`}
          </span>
          <button
            onClick={dismiss}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
          >
            Skip walkthrough
          </button>
        </div>

        {/* Icon + title */}
        <div className="flex flex-col items-center text-center gap-2 px-6 pt-4 pb-3">
          {current.icon}
          <div>
            <h2 className="text-base font-semibold leading-tight">{current.title}</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-sm mx-auto">
              {current.subtitle}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-2 max-h-[320px] overflow-y-auto">
          {current.content}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between gap-3">
          <StepDots total={STEPS.length} current={step} />
          <div className="flex gap-2 items-center">
            {!isFirst && (
              <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)} className="gap-1.5 h-8 text-xs">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={dismiss} className="gap-1.5 h-8 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5" /> Start testing
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => s + 1)} className="gap-1.5 h-8 text-xs">
                {isFirst ? "Let's go" : "Next"} <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
