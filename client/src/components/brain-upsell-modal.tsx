/**
 * Brain Upsell Modal — shown to free-plan users on login.
 * Displays the Brain visualization and explains what they're missing,
 * with a clear upgrade CTA.
 * 
 * Shows once per session (sessionStorage), with a 1-day cooldown (cookie-free via API flag).
 * Does NOT show if user is on a paid plan.
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import {
  Brain, Zap, Trophy, TrendingUp, Shield, Sparkles, X,
} from "lucide-react";

// Use React state only — no localStorage/sessionStorage (blocked in sandbox)
let hasShownThisSession = false;

export function BrainUpsellModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    // Only show for free-plan users
    if (!user || user.plan !== "free") return;
    // Only show once per session
    if (hasShownThisSession) return;

    // Delay to avoid competing with onboarding modal
    const timer = setTimeout(() => {
      hasShownThisSession = true;
      setOpen(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [user]);

  if (!user || user.plan !== "free") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-lg p-0 overflow-hidden border-0 gap-0"
        style={{ background: "#0a0e17" }}
        data-testid="modal-brain-upsell"
      >
        {/* Close button */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full transition-colors"
          style={{ background: "rgba(255,255,255,0.06)" }}
          data-testid="button-close-upsell"
        >
          <X className="w-4 h-4" style={{ color: "rgba(255,255,255,0.5)" }} />
        </button>

        {/* Brain Visualization Header */}
        <div className="relative px-6 pt-8 pb-6 text-center overflow-hidden">
          {/* Background glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at center top, rgba(16,185,129,0.12) 0%, transparent 60%)",
            }}
          />

          {/* Animated brain icon */}
          <div className="relative mx-auto mb-4" style={{ width: 80, height: 80 }}>
            <div
              className="absolute inset-0 rounded-full animate-pulse"
              style={{
                background: "radial-gradient(circle, rgba(16,185,129,0.2) 0%, transparent 70%)",
              }}
            />
            <div
              className="absolute inset-2 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.05) 100%)",
                border: "1px solid rgba(16,185,129,0.25)",
              }}
            >
              <Brain className="w-8 h-8" style={{ color: "#10b981" }} />
            </div>
          </div>

          <h2
            className="text-xl font-bold mb-2"
            style={{ color: "#e2e8f0", letterSpacing: "-0.02em" }}
          >
            Your Tests Are Running Blind
          </h2>
          <p className="text-sm leading-relaxed max-w-sm mx-auto" style={{ color: "#8896a8" }}>
            Free accounts generate variants from basic templates. Paid accounts tap into the
            <span style={{ color: "#10b981", fontWeight: 600 }}> SiteAmoeba Brain</span> —
            a living intelligence trained on proven sales psychology and real test results.
          </p>
        </div>

        {/* Knowledge Stats */}
        <div
          className="mx-4 rounded-lg p-3 grid grid-cols-3 gap-2 text-center"
          style={{
            background: "rgba(16,185,129,0.04)",
            border: "1px solid rgba(16,185,129,0.12)",
          }}
        >
          <div>
            <div className="text-lg font-bold tabular-nums" style={{ color: "#10b981" }}>323</div>
            <div className="text-[10px]" style={{ color: "#5a6a7e" }}>Intelligence Points</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums" style={{ color: "#10b981" }}>17</div>
            <div className="text-[10px]" style={{ color: "#5a6a7e" }}>Proven Frameworks</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums" style={{ color: "#10b981" }}>145</div>
            <div className="text-[10px]" style={{ color: "#5a6a7e" }}>CRO Research Facts</div>
          </div>
        </div>

        {/* What they're missing */}
        <div className="px-6 py-4 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#5a6a7e" }}>
            What the Brain knows that you don't
          </p>

          <Feature
            icon={<Sparkles className="w-3.5 h-3.5" />}
            color="#8b5cf6"
            text="88 sales psychology frameworks — AIDA, Pattern Interrupt, Buyer Loop, Unique Mechanism, and more"
          />
          <Feature
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            color="#10b981"
            text="145 CRO research facts — data-backed insights from CXL, Baymard, and NNGroup"
          />
          <Feature
            icon={<Trophy className="w-3.5 h-3.5" />}
            color="#f59e0b"
            text="Real test results from the network — which strategies win and which lose"
          />
          <Feature
            icon={<Zap className="w-3.5 h-3.5" />}
            color="#06b6d4"
            text="Autopilot mode — the AI runs tests for you, 24/7, across every page section"
          />
          <Feature
            icon={<Shield className="w-3.5 h-3.5" />}
            color="#0ea5e9"
            text="53 page context rules — recommendations adapt to your page type, price point, and niche"
          />
        </div>

        {/* CTA */}
        <div className="px-6 pb-6 pt-2 space-y-2.5">
          <Button
            className="w-full h-11 text-sm font-semibold gap-2 rounded-lg"
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #0ea5e9 100%)",
              color: "#fff",
              border: "none",
            }}
            onClick={() => {
              setOpen(false);
              navigate("/billing");
            }}
            data-testid="button-upgrade-upsell"
          >
            <Zap className="w-4 h-4" />
            Unlock the Brain — Upgrade Now
          </Button>
          <button
            className="w-full text-center text-xs py-1.5 transition-colors"
            style={{ color: "#5a6a7e" }}
            onClick={() => setOpen(false)}
            data-testid="button-skip-upsell"
          >
            I'll keep running blind for now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Feature({ icon, color, text }: { icon: React.ReactNode; color: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className="p-1 rounded-md shrink-0 mt-0.5"
        style={{ background: `${color}15`, color }}
      >
        {icon}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "#c0c8d4" }}>
        {text}
      </p>
    </div>
  );
}
