/**
 * FeedbackReplyBanner
 *
 * Shown on the campaigns dashboard when the user has an unread admin response
 * to feedback they submitted. Built May 4 2026 after Travis flagged that there
 * was no in-app surface telling users a reply had been sent.
 *
 * Renders nothing if there are no unread responses. Click anywhere on the card
 * jumps to /settings (where the existing feedback inbox already shows the
 * admin response in detail).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { MessageSquare, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface FeedbackItem {
  id: number;
  category: string;
  message: string;
  admin_response: string | null;
  response_read: boolean;
  responded_at: string | null;
}

export function FeedbackReplyBanner() {
  const { data = [] } = useQuery<FeedbackItem[]>({
    queryKey: ["/api/feedback/my"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/feedback/my");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const unread = data.filter(f => f.admin_response && !f.response_read);
  if (unread.length === 0) return null;

  // Show the most recent reply prominently; if there's more than one, mention the count.
  const latest = [...unread].sort((a, b) => (b.responded_at || "").localeCompare(a.responded_at || ""))[0];
  const additional = unread.length - 1;

  return (
    <Link href="/settings">
      <Card className="overflow-hidden border-blue-500/30 bg-gradient-to-br from-blue-500/[0.06] to-transparent cursor-pointer hover:border-blue-500/50 transition-colors mb-5">
        <div className="flex items-start gap-4 p-4">
          <div className="shrink-0 w-9 h-9 rounded-lg border border-blue-500/30 bg-blue-500/10 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                {unread.length === 1 ? "New reply to your feedback" : `${unread.length} new replies to your feedback`}
              </span>
              {latest.responded_at && (
                <span className="text-[11px] text-muted-foreground">
                  {new Date(latest.responded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground line-clamp-1">
              <span className="text-muted-foreground">Re:</span> {latest.message.slice(0, 80)}{latest.message.length > 80 ? "\u2026" : ""}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
              {(latest.admin_response || "").slice(0, 220)}{(latest.admin_response || "").length > 220 ? "\u2026" : ""}
            </p>
            {additional > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                + {additional} more repl{additional === 1 ? "y" : "ies"} waiting
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center text-blue-400">
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
