/**
 * Admin Panel — completely separate from the user-facing app.
 * - Has its own login form (credentials come from env vars on the server)
 * - Uses adminToken stored in memory (never mixed with user auth)
 * - No link exists in the user-facing sidebar
 * - Users have no idea this exists
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, CreditCard, FlaskConical, Activity, TrendingUp,
  LogIn, UserPlus, Trash2, Search, ChevronRight, Building2,
  Shield, PlusCircle, ExternalLink, CheckCircle, XCircle,
  AlertCircle, Share2, Eye, EyeOff,
} from "lucide-react";

// ─── Admin token (in-memory, separate from user auth) ─────────────────────────

let adminToken: string | null = null;

function getAdminToken() { return adminToken; }
function setAdminToken(t: string | null) { adminToken = t; }

async function adminFetch(path: string, opts: RequestInit = {}) {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    setAdminToken(null);
    throw new Error("Session expired");
  }
  return res;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function planBadge(plan: string) {
  const config: Record<string, { label: string; className: string }> = {
    free:      { label: "Free",       className: "bg-muted text-muted-foreground" },
    pro:       { label: "Pro",        className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    business:  { label: "Business",   className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
    autopilot: { label: "Autopilot",  className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  };
  const c = config[plan] || config.free;
  return <Badge className={`text-xs ${c.className}`}>{c.label}</Badge>;
}

function statusBadge(status: string) {
  const config: Record<string, { label: string; icon: any; className: string }> = {
    active:    { label: "Active",     icon: CheckCircle,  className: "text-emerald-600 dark:text-emerald-400" },
    suspended: { label: "Suspended",  icon: AlertCircle,  className: "text-amber-600 dark:text-amber-400" },
    cancelled: { label: "Cancelled",  icon: XCircle,      className: "text-rose-600 dark:text-rose-400" },
  };
  const c = config[status] || config.active;
  const Icon = c.icon;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${c.className}`}>
      <Icon className="w-3 h-3" /> {c.label}
    </span>
  );
}

function StatCard({ label, value, sub, icon: Icon, color = "text-muted-foreground" }: {
  label: string; value: string | number; sub?: string; icon: any; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <Icon className={`w-5 h-5 mt-1 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Admin Login Screen ───────────────────────────────────────────────────────

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid credentials");
        return;
      }
      setAdminToken(data.token);
      onSuccess();
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Shield className="w-6 h-6 text-primary" />
          <span className="text-xl font-bold">SiteAmoeba Admin</span>
        </div>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@siteamoeba.com"
                  autoComplete="email"
                  required
                  data-testid="input-admin-email"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    autoComplete="current-password"
                    required
                    className="pr-9"
                    data-testid="input-admin-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(s => !s)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="admin-login-error">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-admin-login">
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── User Detail Sheet ────────────────────────────────────────────────────────

function UserDetailSheet({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const adminQC = useQueryClient();
  const [addCreditsAmount, setAddCreditsAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["admin-user", userId],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}`);
      const d = await res.json();
      setNotes(d.adminNotes || "");
      return d;
    },
    enabled: !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      adminQC.invalidateQueries({ queryKey: ["admin-users"] });
      adminQC.invalidateQueries({ queryKey: ["admin-user", userId] });
      toast({ title: "Updated" });
    },
  });

  const addCreditsMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/add-credits`, {
        method: "POST",
        body: JSON.stringify({ amount: parseInt(addCreditsAmount) }),
      });
      return res.json();
    },
    onSuccess: () => {
      adminQC.invalidateQueries({ queryKey: ["admin-user", userId] });
      adminQC.invalidateQueries({ queryKey: ["admin-users"] });
      setAddCreditsAmount("");
      toast({ title: `${addCreditsAmount} credits added` });
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}/impersonate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return res.json();
    },
    onSuccess: (data) => {
      // Open the app as this user in a new tab — token goes in hash
      window.open(`${window.location.origin}/#/?token=${encodeURIComponent(data.token)}`, "_blank");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      adminQC.invalidateQueries({ queryKey: ["admin-users"] });
      setShowDeleteConfirm(false);
      onClose();
      toast({ title: "Account cancelled" });
    },
  });

  return (
    <Sheet open={!!userId} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-[480px] sm:w-[520px] overflow-y-auto" data-testid="user-detail-sheet">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" /> User Profile
          </SheetTitle>
        </SheetHeader>

        {isLoading || !user ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="space-y-6">
            {/* Identity */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-base">{user.name || "—"}</h3>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {planBadge(user.plan)}
                  {statusBadge(user.accountStatus)}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Joined {new Date(user.createdAt).toLocaleDateString()} · ID #{user.id}
              </p>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Campaigns", value: user.activeCampaigns },
                { label: "Visitors", value: user.totalVisitors },
                { label: "Credits", value: `${user.creditsUsed ?? 0}/${user.creditsLimit ?? 0}` },
              ].map(s => (
                <div key={s.label} className="bg-muted/50 rounded-lg py-2.5 px-2">
                  <p className="text-base font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Plan */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Plan</p>
              <div className="flex gap-2">
                <Select value={editingPlan ?? user.plan} onValueChange={setEditingPlan}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["free", "pro", "business", "autopilot"].map(p => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!editingPlan || editingPlan === user.plan || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ plan: editingPlan })}>
                  Save
                </Button>
              </div>
            </div>

            {/* Add credits */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Add Credits</p>
              <div className="flex gap-2">
                <Input type="number" placeholder="Amount" value={addCreditsAmount}
                  onChange={e => setAddCreditsAmount(e.target.value)} className="flex-1"
                  data-testid="input-add-credits" />
                <Button size="sm" onClick={() => addCreditsMutation.mutate()}
                  disabled={!addCreditsAmount || addCreditsMutation.isPending}
                  data-testid="button-add-credits-confirm">
                  <PlusCircle className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>
            </div>

            {/* Account status */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Account Status</p>
              <div className="flex gap-2">
                {["active", "suspended"].map(s => (
                  <Button key={s} size="sm" variant={user.accountStatus === s ? "default" : "outline"}
                    onClick={() => updateMutation.mutate({ accountStatus: s })}
                    disabled={updateMutation.isPending} className="capitalize">
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            {/* Admin notes */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Internal Notes</p>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes visible only to admins..." rows={3}
                data-testid="input-admin-notes" />
              <Button size="sm" variant="outline" className="mt-1.5"
                onClick={() => updateMutation.mutate({ adminNotes: notes })}
                disabled={updateMutation.isPending}>
                Save Notes
              </Button>
            </div>

            {/* Campaigns */}
            {user.campaigns?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Campaigns</p>
                <div className="space-y-1.5">
                  {user.campaigns.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between bg-muted/50 rounded px-3 py-2 text-sm">
                      <span className="truncate">{c.name}</span>
                      <Badge variant="outline" className="text-xs capitalize ml-2 shrink-0">{c.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Referral */}
            {user.referralCode && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Referral Code</p>
                <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 text-sm">
                  <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-mono">{user.referralCode}</span>
                  {user.referrals?.length > 0 && (
                    <Badge variant="outline" className="ml-auto text-xs">{user.referrals.length} referrals</Badge>
                  )}
                </div>
              </div>
            )}

            {/* Stripe */}
            {user.stripeCustomerId && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Stripe</p>
                <p className="text-xs font-mono text-muted-foreground bg-muted/50 rounded px-3 py-2">
                  {user.stripeCustomerId}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="border-t pt-4 space-y-2">
              <Button variant="outline" className="w-full gap-2"
                onClick={() => impersonateMutation.mutate()}
                disabled={impersonateMutation.isPending}
                data-testid="button-impersonate">
                <LogIn className="w-4 h-4" />
                {impersonateMutation.isPending ? "Opening..." : "Log In As User"}
              </Button>
              <p className="text-xs text-center text-muted-foreground">Opens a 2-hour session as this user in a new tab</p>
              <Button variant="destructive" className="w-full gap-2"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="button-cancel-account">
                <Trash2 className="w-4 h-4" /> Cancel Account
              </Button>
            </div>

            <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel this account?</DialogTitle>
                  <DialogDescription>
                    Marks the account as cancelled. Data is preserved but the user can't log in. Reversible by setting status to Active.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Back</Button>
                  <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? "Cancelling..." : "Cancel Account"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Create User Dialog ───────────────────────────────────────────────────────

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const adminQC = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", name: "", plan: "free" });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await adminFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      return res.json();
    },
    onSuccess: () => {
      adminQC.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "User created" });
      setForm({ email: "", password: "", name: "", plan: "free" });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent data-testid="dialog-create-user">
        <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-new-user-email" />
          <Input placeholder="Full Name (optional)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Input type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} data-testid="input-new-user-password" />
          <Select value={form.plan} onValueChange={v => setForm(f => ({ ...f, plan: v }))}>
            <SelectTrigger><SelectValue placeholder="Plan" /></SelectTrigger>
            <SelectContent>
              {["free", "pro", "business", "autopilot"].map(p => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()}
            disabled={!form.email || !form.password || createMutation.isPending}
            data-testid="button-create-user-confirm">
            {createMutation.isPending ? "Creating..." : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const { toast } = useToast();
  const adminQC = useQueryClient();
  const [loggedIn, setLoggedIn] = useState(!!getAdminToken());
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const handleLoginSuccess = useCallback(() => setLoggedIn(true), []);

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/stats");
      return res.json();
    },
    enabled: loggedIn,
  });

  const { data: users, isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/users");
      return res.json();
    },
    enabled: loggedIn,
  });

  const { data: referralData } = useQuery<any>({
    queryKey: ["admin-referrals"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/referrals");
      return res.json();
    },
    enabled: loggedIn,
  });

  if (!loggedIn) return <AdminLogin onSuccess={handleLoginSuccess} />;

  const filteredUsers = (users || []).filter(u => {
    const matchSearch = !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name || "").toLowerCase().includes(search.toLowerCase());
    const matchPlan = filterPlan === "all" || u.plan === filterPlan;
    const matchStatus = filterStatus === "all" || u.accountStatus === filterStatus;
    return matchSearch && matchPlan && matchStatus;
  });

  return (
    <div className="min-h-screen bg-background" data-testid="admin-page">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-base font-bold">SiteAmoeba Admin</h1>
              <p className="text-xs text-muted-foreground">Internal control center</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setAdminToken(null); setLoggedIn(false); }}>
              Sign Out
            </Button>
            <Button size="sm" onClick={() => setShowCreateUser(true)} data-testid="button-create-user">
              <UserPlus className="w-3.5 h-3.5 mr-1.5" /> New User
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Overview stats */}
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {statsLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />) : <>
              <StatCard label="Total Users" value={stats?.totalUsers ?? 0} sub={`+${stats?.newUsersThisWeek ?? 0} this week`} icon={Users} color="text-blue-500" />
              <StatCard label="Paid Users" value={stats?.paidUsers ?? 0} sub={`${stats?.freeUsers ?? 0} free`} icon={CreditCard} color="text-emerald-500" />
              <StatCard label="On Trial" value={stats?.trialUsers ?? 0} icon={Activity} color="text-amber-500" />
              <StatCard label="Active Tests" value={stats?.activeTests ?? 0} sub={`${stats?.activeCampaigns ?? 0} campaigns`} icon={FlaskConical} color="text-purple-500" />
              <StatCard label="Visitors (30d)" value={(stats?.visitorsLast30Days ?? 0).toLocaleString()} icon={TrendingUp} color="text-teal-500" />
            </>}
          </div>
          {stats && (
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(stats.planBreakdown).map(([plan, count]) => (
                <div key={plan} className="flex items-center gap-1.5 bg-muted/60 rounded-full px-3 py-1">
                  {planBadge(plan)}
                  <span className="text-xs font-semibold">{count as number}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="gap-1.5"><Users className="w-3.5 h-3.5" />Users</TabsTrigger>
            <TabsTrigger value="referrals" className="gap-1.5"><Share2 className="w-3.5 h-3.5" />Referrals</TabsTrigger>
            <TabsTrigger value="enterprise" className="gap-1.5"><Building2 className="w-3.5 h-3.5" />Enterprise</TabsTrigger>
          </TabsList>

          {/* Users */}
          <TabsContent value="users" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search by email or name..." value={search}
                  onChange={e => setSearch(e.target.value)} className="pl-9"
                  data-testid="input-search-users" />
              </div>
              <Select value={filterPlan} onValueChange={setFilterPlan}>
                <SelectTrigger className="w-36"><SelectValue placeholder="All plans" /></SelectTrigger>
                <SelectContent>
                  {["all", "free", "pro", "business", "autopilot"].map(p => (
                    <SelectItem key={p} value={p} className="capitalize">{p === "all" ? "All Plans" : p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  {[["all", "All Statuses"], ["active", "Active"], ["suspended", "Suspended"], ["cancelled", "Cancelled"]].map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground self-center ml-1">
                {filteredUsers.length} of {users?.length ?? 0}
              </p>
            </div>

            <Card>
              <div className="divide-y divide-border">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>User</span>
                  <span className="text-center w-20">Plan</span>
                  <span className="text-center w-20">Credits</span>
                  <span className="text-center w-20">Campaigns</span>
                  <span className="text-center w-20">Status</span>
                  <span className="w-4" />
                </div>
                {usersLoading ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="px-4 py-3"><Skeleton className="h-10 w-full" /></div>
                )) : filteredUsers.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">No users match your filters</div>
                ) : filteredUsers.map(u => (
                  <div key={u.id}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-3 items-center cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setSelectedUserId(u.id)}
                    data-testid={`user-row-${u.id}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name || u.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      <p className="text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="w-20 flex justify-center">{planBadge(u.plan)}</div>
                    <div className="w-20 text-center"><span className="text-xs tabular-nums">{u.creditsUsed}/{u.creditsLimit}</span></div>
                    <div className="w-20 text-center"><span className="text-xs">{u.activeCampaigns} active</span></div>
                    <div className="w-20 flex justify-center">{statusBadge(u.accountStatus)}</div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* Referrals */}
          <TabsContent value="referrals" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold mb-3">Leaderboard</h3>
                <Card>
                  <div className="divide-y">
                    {!referralData?.leaderboard?.length ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No referrals yet</div>
                    ) : referralData.leaderboard.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{r.name || r.email}</p>
                          <p className="text-xs text-muted-foreground">{r.email}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{r.total_referrals} referrals</p>
                          <p className="text-xs text-muted-foreground">{r.converted} converted</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-3">All Referrals</h3>
                <Card>
                  <div className="divide-y">
                    {!referralData?.referrals?.length ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No referrals yet</div>
                    ) : referralData.referrals.map((r: any, i: number) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">
                            <span className="font-medium">{r.referrer_name || r.referrer_email}</span>
                            <span className="text-muted-foreground mx-1.5">→</span>
                            <span>{r.referred_email}</span>
                          </div>
                          <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
                        </div>
                        {r.commission_amount > 0 && (
                          <p className="text-xs text-emerald-600 mt-0.5">${r.commission_amount} commission</p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Enterprise */}
          <TabsContent value="enterprise" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="font-semibold text-base mb-1.5">Enterprise Accounts</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Enterprise account management will be available once the first enterprise client is onboarded.
                </p>
                <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm mx-auto text-left">
                  {["Data isolation", "Custom Brain access", "White-label options", "SLA monitoring", "Dedicated support", "$50K+/year minimum"].map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" /> {f}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <UserDetailSheet userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      <CreateUserDialog open={showCreateUser} onClose={() => setShowCreateUser(false)} />
    </div>
  );
}
