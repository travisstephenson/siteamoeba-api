import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import {
  Users,
  TrendingUp,
  DollarSign,
  Percent,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  Monitor,
  Smartphone,
  Globe,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============ COLOR PALETTE ============
const SOURCE_COLORS: Record<string, string> = {
  "Facebook Ads": "#1877F2",
  "Instagram Ads": "#E4405F",
  "Instagram Organic": "#C13584",
  "Email": "#10B981",
  "Google Organic": "#4285F4",
  "YouTube": "#FF0000",
  "Direct": "#6B7280",
  "Audience Network": "#8B5CF6",
  "Unknown": "#9CA3AF",
};

const DEVICE_COLORS: Record<string, string> = {
  "Desktop Mac": "#3B82F6",
  "MacBook": "#3B82F6",
  "desktop": "#3B82F6",
  "Desktop": "#3B82F6",
  "Windows": "#8B5CF6",
  "iOS": "#EC4899",
  "iPhone": "#EC4899",
  "iphone": "#EC4899",
  "Android": "#10B981",
  "android": "#10B981",
  "mobile": "#F59E0B",
  "Mobile": "#F59E0B",
  "tablet": "#14B8A6",
  "Tablet": "#14B8A6",
  "Unknown": "#9CA3AF",
};

function getSourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? "#9CA3AF";
}

function getDeviceColor(device: string): string {
  // Try exact match first, then case-insensitive
  if (DEVICE_COLORS[device]) return DEVICE_COLORS[device];
  const key = Object.keys(DEVICE_COLORS).find(
    (k) => k.toLowerCase() === device.toLowerCase()
  );
  return key ? DEVICE_COLORS[key] : "#9CA3AF";
}

function getDeviceIcon(device: string) {
  const d = device.toLowerCase();
  if (d.includes("mobile") || d.includes("iphone") || d.includes("android") || d === "ios") {
    return <Smartphone className="w-3.5 h-3.5" />;
  }
  if (d.includes("desktop") || d.includes("mac") || d.includes("windows")) {
    return <Monitor className="w-3.5 h-3.5" />;
  }
  return <Globe className="w-3.5 h-3.5" />;
}

// ============ FORMATTERS ============
function fmtMoney(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPct(conv: number, vis: number): string {
  if (!vis) return "0.0%";
  return `${((conv / vis) * 100).toFixed(1)}%`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTime(ms: number): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ============ TYPES ============
interface SourceStat {
  source: string;
  visitors: number;
  conversions: number;
  revenue: number;
}

interface DeviceStat {
  device: string;
  visitors: number;
  conversions: number;
  revenue: number;
}

interface DailyTraffic {
  date: string;
  visitors: number;
  conversions: number;
  revenue: number;
}

interface CampaignStat {
  campaignId: number;
  campaignName: string;
  visitors: number;
  conversions: number;
  revenue: number;
}

interface TrafficOverview {
  sources: SourceStat[];
  deviceBreakdown: DeviceStat[];
  dailyTraffic: DailyTraffic[];
  topCampaigns: CampaignStat[];
  totalVisitors: number;
  totalConversions: number;
  totalRevenue: number;
}

interface JourneyStep {
  timestamp: string;
  source: string;
  campaignName: string;
  device: string;
  scrollDepth: number;
  timeOnPage: number;
  converted: boolean;
}

interface ConversionRecord {
  visitorId: number;
  email: string | null;
  amount: number;
  convertedAt: string;
  campaignName: string;
  source: string;
  device: string;
  firstSeen: string;
  daysToConvert: number;
  totalVisits: number;
  journey: JourneyStep[];
}

interface SourceDetailData {
  source: string;
  campaigns: CampaignStat[];
  utmCampaigns: { utmCampaign: string; visitors: number; conversions: number; revenue: number }[];
  deviceBreakdown: DeviceStat[];
  dailyTrend: DailyTraffic[];
}

// ============ KPI CARD ============
function KpiCard({
  label,
  value,
  sub,
  icon,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card data-testid={`card-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">{value}</p>
            )}
            {sub && !loading && (
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            )}
          </div>
          <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ CUSTOM TOOLTIP ============
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums text-foreground">
            {p.name === "Revenue"
              ? `$${parseFloat(p.value).toFixed(0)}`
              : fmtNum(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============ TRAFFIC OVER TIME ============
function TrafficOverTimeChart({ data, loading }: { data: DailyTraffic[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Traffic Over Time</CardTitle>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-primary rounded" />
              <span>Visitors</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-500 rounded" />
              <span>Conversions</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-2 pb-4">
        {loading ? (
          <Skeleton className="h-52 w-full" />
        ) : data.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
            No traffic data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="visitorGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(160 84% 36%)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="hsl(160 84% 36%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(v) => fmtDate(v)}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="visitors"
                name="Visitors"
                stroke="hsl(160 84% 36%)"
                strokeWidth={2}
                fill="url(#visitorGrad)"
              />
              <Area
                type="monotone"
                dataKey="conversions"
                name="Conversions"
                stroke="#10B981"
                strokeWidth={2}
                fill="url(#convGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ============ SOURCE DRILL-DOWN ROW ============
function SourceDrillDown({ source }: { source: string }) {
  const { data, isLoading } = useQuery<SourceDetailData>({
    queryKey: ["/api/traffic/source-detail", source],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/traffic/source-detail?source=${encodeURIComponent(source)}`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={5} className="py-3 px-4">
          <Skeleton className="h-24 w-full" />
        </td>
      </tr>
    );
  }

  if (!data || data.campaigns.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="py-3 px-4 text-sm text-muted-foreground">
          No campaign breakdown available
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={5} className="py-0">
        <div className="mx-6 my-3 rounded-lg border border-border bg-muted/30">
          <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
            Campaign breakdown
          </div>
          <table className="w-full text-sm">
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.campaignId} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2 text-xs text-foreground font-medium truncate max-w-xs">
                    {c.campaignName}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                    {fmtNum(c.visitors)} visitors
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                    {fmtPct(c.conversions, c.visitors)} CR
                  </td>
                  <td className="px-3 py-2 text-xs font-medium tabular-nums">
                    {fmtMoney(c.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

// ============ SOURCE ATTRIBUTION TABLE ============
function SourceAttributionTable({
  sources,
  loading,
}: {
  sources: SourceStat[];
  loading: boolean;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const maxVisitors = useMemo(
    () => Math.max(...sources.map((s) => s.visitors), 1),
    [sources]
  );

  const sorted = useMemo(
    () => [...sources].sort((a, b) => b.revenue - a.revenue),
    [sources]
  );

  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-sm font-semibold">Source Attribution</CardTitle>
        <p className="text-xs text-muted-foreground">Last 30 days · click a row to expand campaign detail</p>
      </CardHeader>
      <CardContent className="pt-0 px-0 pb-2">
        {loading ? (
          <div className="space-y-2 px-5 pb-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No traffic data yet
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border">
                <TableHead className="pl-5 text-xs font-medium">Source</TableHead>
                <TableHead className="text-xs font-medium text-right">Visitors</TableHead>
                <TableHead className="text-xs font-medium text-right">Conv Rate</TableHead>
                <TableHead className="text-xs font-medium text-right">Revenue</TableHead>
                <TableHead className="text-xs font-medium text-right pr-5">Rev / Visitor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <>
                  <TableRow
                    key={row.source}
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() =>
                      setExpandedRow(expandedRow === row.source ? null : row.source)
                    }
                    data-testid={`row-source-${row.source.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <TableCell className="pl-5 py-3">
                      <div className="flex items-center gap-2.5">
                        {expandedRow === row.source ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: getSourceColor(row.source) }}
                        />
                        <span className="font-medium text-sm">{row.source}</span>
                      </div>
                      {/* Relative bar */}
                      <div className="mt-1.5 ml-9 h-1 rounded-full bg-muted overflow-hidden w-40">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(row.visitors / maxVisitors) * 100}%`,
                            backgroundColor: getSourceColor(row.source),
                            opacity: 0.6,
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmtNum(row.visitors)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmtPct(row.conversions, row.visitors)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {fmtMoney(row.revenue)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums pr-5">
                      {row.visitors > 0
                        ? fmtMoney(row.revenue / row.visitors)
                        : "$0"}
                    </TableCell>
                  </TableRow>
                  {expandedRow === row.source && (
                    <SourceDrillDown source={row.source} />
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============ DEVICE BREAKDOWN ============
function DeviceBreakdown({
  devices,
  loading,
}: {
  devices: DeviceStat[];
  loading: boolean;
}) {
  const pieData = devices.map((d) => ({
    name: d.device,
    value: d.visitors,
    color: getDeviceColor(d.device),
  }));

  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-sm font-semibold">Device Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 px-5 pb-5">
        {loading ? (
          <div className="flex gap-6">
            <Skeleton className="h-40 w-40 rounded-full" />
            <div className="flex-1 space-y-2 pt-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          </div>
        ) : devices.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">No device data</div>
        ) : (
          <div className="flex gap-6 items-center">
            {/* Donut chart */}
            <div className="shrink-0">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0];
                      return (
                        <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
                          <p className="font-semibold">{d.name}</p>
                          <p className="text-muted-foreground">{fmtNum(d.value as number)} visitors</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="flex-1 min-w-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left pb-2 font-medium">Device</th>
                    <th className="text-right pb-2 font-medium">Visitors</th>
                    <th className="text-right pb-2 font-medium">CR</th>
                    <th className="text-right pb-2 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr
                      key={d.device}
                      className="border-b border-border/50 last:border-0"
                      data-testid={`row-device-${d.device.toLowerCase()}`}
                    >
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: getDeviceColor(d.device) }}
                          />
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {getDeviceIcon(d.device)}
                          </span>
                          <span className="font-medium">{d.device}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{fmtNum(d.visitors)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(d.conversions, d.visitors)}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{fmtMoney(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ JOURNEY TIMELINE ============
function JourneyTimeline({ journey }: { journey: JourneyStep[] }) {
  return (
    <div className="space-y-0 pl-2">
      {journey.map((step, i) => {
        const isLast = i === journey.length - 1;
        return (
          <div key={i} className="flex gap-3" data-testid={`step-journey-${i}`}>
            {/* Timeline spine */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10",
                  step.converted
                    ? "bg-emerald-500 text-white"
                    : "bg-muted border-2 border-border"
                )}
              >
                {step.converted ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                )}
              </div>
              {!isLast && <div className="w-0.5 h-full bg-border min-h-[32px]" />}
            </div>

            {/* Content */}
            <div className={cn("pb-5 min-w-0 flex-1", isLast && "pb-1")}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${getSourceColor(step.source)}20`,
                        color: getSourceColor(step.source),
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: getSourceColor(step.source) }}
                      />
                      {step.source}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {getDeviceIcon(step.device)}
                      {step.device}
                    </span>
                    {step.converted && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      >
                        Converted
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.campaignName}</p>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {fmtDateTime(step.timestamp)}
                </span>
              </div>

              <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                {step.scrollDepth > 0 && (
                  <span>Scroll {step.scrollDepth}%</span>
                )}
                {step.timeOnPage > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {fmtTime(step.timeOnPage)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ CONVERSION CARD ============
function ConversionCard({ record }: { record: ConversionRecord }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = record.email || `Visitor #${record.visitorId}`;

  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-colors"
      onClick={() => setExpanded(!expanded)}
      data-testid={`card-conversion-${record.visitorId}`}
    >
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{displayName}</span>
              <Badge
                variant="outline"
                className="text-xs px-1.5 py-0 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 tabular-nums"
              >
                ${record.amount.toFixed(2)}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span
                className="text-xs font-medium"
                style={{ color: getSourceColor(record.source) }}
              >
                {record.source}
              </span>
              <span className="text-xs text-muted-foreground">{record.campaignName}</span>
              <span className="text-xs text-muted-foreground">
                {record.totalVisits} visit{record.totalVisits !== 1 ? "s" : ""} · {record.daysToConvert}d
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground tabular-nums">
              {fmtDate(record.convertedAt)}
            </span>
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                <span>
                  {record.daysToConvert === 0
                    ? "Same-day conversion"
                    : `${record.daysToConvert} day${record.daysToConvert !== 1 ? "s" : ""} to convert`}
                </span>
              </div>
              <span>·</span>
              <span>{record.totalVisits} total visit{record.totalVisits !== 1 ? "s" : ""}</span>
            </div>
            <JourneyTimeline journey={record.journey} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ MAIN PAGE ============
export default function TrafficPage() {
  const {
    data: overview,
    isLoading: overviewLoading,
  } = useQuery<TrafficOverview>({
    queryKey: ["/api/traffic/overview"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/traffic/overview");
      return res.json();
    },
  });

  const {
    data: journeysData,
    isLoading: journeysLoading,
  } = useQuery<{ conversions: ConversionRecord[] }>({
    queryKey: ["/api/traffic/journeys"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/traffic/journeys");
      return res.json();
    },
  });

  const convRate = useMemo(() => {
    if (!overview?.totalVisitors) return "0.0%";
    return fmtPct(overview.totalConversions, overview.totalVisitors);
  }, [overview]);

  const conversions = journeysData?.conversions ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h1 className="text-xl font-bold tracking-tight">Traffic Intelligence</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Attribution tracking across all campaigns
            </p>
          </div>
          <Badge variant="secondary" className="text-xs px-2.5 py-1">
            Last 30 days
          </Badge>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-kpi-cards">
          <KpiCard
            label="Total Visitors"
            value={fmtNum(overview?.totalVisitors ?? 0)}
            icon={<Users className="w-4 h-4" />}
            loading={overviewLoading}
          />
          <KpiCard
            label="Conversions"
            value={fmtNum(overview?.totalConversions ?? 0)}
            icon={<TrendingUp className="w-4 h-4" />}
            loading={overviewLoading}
          />
          <KpiCard
            label="Revenue"
            value={fmtMoney(overview?.totalRevenue ?? 0)}
            icon={<DollarSign className="w-4 h-4" />}
            loading={overviewLoading}
          />
          <KpiCard
            label="Avg Conv Rate"
            value={convRate}
            icon={<Percent className="w-4 h-4" />}
            loading={overviewLoading}
          />
        </div>

        {/* Traffic Over Time */}
        <TrafficOverTimeChart
          data={overview?.dailyTraffic ?? []}
          loading={overviewLoading}
        />

        {/* Source Attribution + Device side by side on large screens */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <SourceAttributionTable
              sources={overview?.sources ?? []}
              loading={overviewLoading}
            />
          </div>
          <div className="xl:col-span-1">
            <DeviceBreakdown
              devices={overview?.deviceBreakdown ?? []}
              loading={overviewLoading}
            />
          </div>
        </div>

        <Separator />

        {/* Recent Conversions & Journeys */}
        <div data-testid="section-journeys">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Recent Conversions &amp; Journeys</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click any card to reveal the full visitor journey
            </p>
          </div>

          {journeysLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : conversions.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  No conversions recorded yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Journeys will appear here once visitors convert
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {conversions.slice(0, 20).map((c) => (
                <ConversionCard key={c.visitorId} record={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
