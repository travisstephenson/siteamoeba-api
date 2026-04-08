import React from "react";
import { AlertCircle, RefreshCw, LogIn, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ErrorInfo {
  componentStack: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function getErrorGuidance(error: Error | null): {
  title: string;
  message: string;
  action: string;
  actionFn: () => void;
  icon: React.ReactNode;
} {
  if (!error) return {
    title: "Something went wrong",
    message: "An unexpected error occurred. Try refreshing the page.",
    action: "Refresh page",
    actionFn: () => window.location.reload(),
    icon: <RefreshCw className="w-6 h-6 text-destructive" />,
  };

  const msg = error.message?.toLowerCase() || "";

  if (msg.includes("403") || msg.includes("campaign limit") || msg.includes("upgrade your plan") || msg.includes("credit limit")) {
    return {
      title: "Plan limit reached",
      message: "You\'ve hit a limit on your current plan. Upgrade to continue.",
      action: "Go to settings",
      actionFn: () => { window.location.hash = "/settings"; window.location.reload(); },
      icon: <AlertCircle className="w-6 h-6 text-amber-500" />,
    };
  }

  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("jwt expired") || msg.includes("invalid token")) {
    return {
      title: "Session expired",
      message: "Your session has expired. Please sign in again.",
      action: "Sign in",
      actionFn: () => { window.location.hash = "/auth"; window.location.reload(); },
      icon: <LogIn className="w-6 h-6 text-amber-500" />,
    };
  }

  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network")) {
    return {
      title: "Connection problem",
      message: "Can't reach the server. Check your internet connection and try again.",
      action: "Retry",
      actionFn: () => window.location.reload(),
      icon: <Wifi className="w-6 h-6 text-amber-500" />,
    };
  }

  if (msg.includes("500") || msg.includes("internal server")) {
    return {
      title: "Server error",
      message: "Something went wrong on our end. This has been noted. Please try refreshing.",
      action: "Refresh page",
      actionFn: () => window.location.reload(),
      icon: <AlertCircle className="w-6 h-6 text-destructive" />,
    };
  }

  return {
    title: "Something crashed",
    message: "An unexpected error occurred on this page. Refreshing usually fixes it.",
    action: "Refresh page",
    actionFn: () => window.location.reload(),
    icon: <AlertCircle className="w-6 h-6 text-destructive" />,
  };
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // Log to server for admin visibility
    try {
      fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          url: window.location.href,
          ts: new Date().toISOString(),
        }),
      }).catch(() => {}); // silent — don't throw if logging fails
    } catch {}
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const guidance = getErrorGuidance(this.state.error);

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              {guidance.icon}
              <div>
                <h1 className="text-xl font-semibold text-foreground mb-1">{guidance.title}</h1>
                <p className="text-sm text-muted-foreground">{guidance.message}</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={guidance.actionFn} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  {guidance.action}
                </Button>
                <Button variant="ghost" onClick={() => window.location.hash = "/"}>
                  Go home
                </Button>
              </div>
              {import.meta.env.DEV && this.state.error && (
                <details className="text-left w-full">
                  <summary className="text-xs text-muted-foreground cursor-pointer">Error details</summary>
                  <pre className="text-xs mt-2 p-2 bg-muted rounded overflow-auto max-h-40">
                    {this.state.error.message}
                    {"\n\n"}
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </details>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

// Global error/rejection capture — call once at app startup
export function initGlobalErrorCapture() {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason) || "Unhandled promise rejection";

    // Don't spam for cancelled requests or benign errors
    if (msg.includes("AbortError") || msg.includes("signal is aborted")) return;

    console.error("[SiteAmoeba] Unhandled rejection:", reason);

    // Post to server
    try {
      fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          stack: reason?.stack,
          type: "unhandledrejection",
          url: window.location.href,
          ts: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
  });

  window.addEventListener("error", (event) => {
    const msg = event.message || "Unknown error";
    if (msg.includes("ResizeObserver") || msg.includes("Non-Error")) return; // ignore benign browser noise

    console.error("[SiteAmoeba] Global error:", event.error);

    try {
      fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          stack: event.error?.stack,
          filename: event.filename,
          line: event.lineno,
          type: "window.onerror",
          url: window.location.href,
          ts: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
  });
}
