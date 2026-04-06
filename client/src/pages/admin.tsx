import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
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
  Shield, RefreshCw, PlusCircle, Lock, X, Eye, ExternalLink,
  CheckCircle, XCircle, AlertCircle, Info, Share2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  totalUsers: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  paidUsers: number;
  freeUsers: number;
  trialUsers: number;
  planBreakdown: Record<string, number>;
  activeCampaigns: number;
  activeTests: number;
  visitorsLast30Days: number;
  totalRevenue: number;
}

interface AdminUser {
  id: number;
  email: string;
  name: string;
  plan: string;
  creditsUsed: number;
  creditsLimit: number;
  createdAt: string;
  isAdmin: number;
  trialEndsAt: string | null;
  accountStatus: string;
  adminNotes: string | null;
  referralCode: string | null;
  referredBy: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  activeCampaigns: number;
  activeTests: number;
  totalVisitors: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function planBadge(plan: string) {
  const config: Record<string, { label: string; className: string }> = {
    free: { label: "Free", className: "bg-muted text-muted-foreground" },
    pro: { label: "Pro", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    business: { label: "Business", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
    autopilot: { label: "Autopilot", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  };
  const c = config[plan] || config.free;
  return <Badge className={`text-xs ${c.className}`}>{c.label}</Badge>;
}

function statusBadge(status: string) {
  const config: Record<string, { label: string; icon: any; className: string }> = {
    active: { label: "Active", icon: CheckCircle, className: "text-emerald-600 dark:text-emerald-400" },
    suspended: { label: "Suspended", icon: AlertCircle, className: "text-amber-600 dark:text-amber-400" },
    cancelled: { label: "Cancelled", icon: XCircle, className: "text-rose-600 dark:text-rose-400" },
  };
  const c = config[status] || config.active;
  const Icon = c.icon;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${c.className}`}>
      <Icon className="w-3 h-3" /> {c.label}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

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

// ─── User Card / Detail Sheet ──────────────────────────────────────────────────

function UserDetailSheet({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const [addCreditsAmount, setAddCreditsAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/users", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/users/${userId}`);
      return res.json();
    },
    enabled: !!userId,
    onSuccess: (d) => setNotes(d.adminNotes || ""),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId] });
      toast({ title: "Updated" });
    },
  });

  const addCreditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/add-credits`, {
        amount: parseInt(addCreditsAmount),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId] });
      setAddCreditsAmount("");
      toast({ title: "Credits added" });
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/impersonate`, {});
      return res.json();
    },
    onSuccess: (data) => {
      // Open the app with the impersonation token in a new tab
      // The app reads ?token= from the hash on load
      const url = `${window.location.origin}/#/?token=${encodeURIComponent(data.token)}`;
      window.open(url, "_blank");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowDeleteConfirm(false);
      onClose();
      toast({ title: "Account cancelled" });
    },
  });

  return (
    <Sheet open={!!userId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[480px] sm:w-[520px] overflow-y-auto" data-testid="user-detail-sheet">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            User Profile
          </SheetTitle>
        </SheetHeader>

        {isLoading || !user ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
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
                {user.isAdmin ? " · Admin" : ""}
              </p>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/50 rounded-lg py-2.5 px-2">
                <p className="text-base font-bold">{user.activeCampaigns}</p>
                <p className="text-xs text-muted-foreground">Campaigns</p>
              </div>
              <div className="bg-muted/50 rounded-lg py-2.5 px-2">
                <p className="text-base font-bold">{user.totalVisitors}</p>
                <p className="text-xs text-muted-foreground">Visitors</p>
              </div>
              <div className="bg-muted/50 rounded-lg py-2.5 px-2">
                <p className="text-base font-bold">{user.creditsUsed ?? 0}/{user.creditsLimit ?? 0}</p>
                <p className="text-xs text-muted-foreground">Credits</p>
              </div>
            </div>

            {/* Change plan */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Plan</p>
              <div className="flex gap-2">
                <Select
                  value={editingPlan ?? user.plan}
                  onValueChange={setEditingPlan}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="pro">Pro ($47/mo)</SelectItem>
                    <SelectItem value="business">Business ($97/mo)</SelectItem>
                    <SelectItem value="autopilot">Autopilot ($299/mo)</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!editingPlan || editingPlan === user.plan || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ plan: editingPlan })}
                >
                  Save
                </Button>
              </div>
            </div>

            {/* Add credits */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Add Credits</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Amount"
                  value={addCreditsAmount}
                  onChange={(e) => setAddCreditsAmount(e.target.value)}
                  className="flex-1"
                  data-testid="input-add-credits"
                />
                <Button
                  size="sm"
                  onClick={() => addCreditsMutation.mutate()}
                  disabled={!addCreditsAmount || addCreditsMutation.isPending}
                  data-testid="button-add-credits-confirm"
                >
                  <PlusCircle className="w-3.5 h-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {/* Account status */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Account Status</p>
              <div className="flex gap-2">
                {["active", "suspended"].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={user.accountStatus === s ? "default" : "outline"}
                    onClick={() => updateMutation.mutate({ accountStatus: s })}
                    disabled={updateMutation.isPending}
                    className="capitalize"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            {/* Admin notes */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Internal Notes</p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes visible only to admins..."
                rows={3}
                data-testid="input-admin-notes"
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5"
                onClick={() => updateMutation.mutate({ adminNotes: notes })}
                disabled={updateMutation.isPending}
              >
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

            {/* Referral info */}
            {user.referralCode && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Referral</p>
                <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 text-sm">
                  <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-mono">{user.referralCode}</span>
                  {user.referrals?.length > 0 && (
                    <Badge variant="outline" className="ml-auto text-xs">{user.referrals.length} referrals</Badge>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="border-t pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => impersonateMutation.mutate()}
                disabled={impersonateMutation.isPending}
                data-testid="button-impersonate"
              >
                <LogIn className="w-4 h-4" />
                {impersonateMutation.isPending ? "Opening..." : "Log In As User"}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Opens a 2-hour session as this user in a new tab
              </p>
              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="button-cancel-account"
              >
                <Trash2 className="w-4 h-4" />
                Cancel Account
              </Button>
            </div>

            {/* Delete confirm */}
            <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel this account?</DialogTitle>
                  <DialogDescription>
                    This will mark the account as cancelled. The user's data is preserved but they won't be able to log in. This can be reversed by setting status to Active.
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
  const [form, setForm] = useState({ email: "", password: "", name: "", plan: "free" });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/users", form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User created" });
      setForm({ email: "", password: "", name: "", plan: "free" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-create-user">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
            data-testid="input-new-user-email"
          />
          <Input
            placeholder="Full Name (optional)"
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
          />
          <Input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
            data-testid="input-new-user-password"
          />
          <Select value={form.plan} onValueChange={(v) => setForm(f => ({ ...f, plan: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="business">Business</SelectItem>
              <SelectItem value="autopilot">Autopilot</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.email || !form.password || createMutation.isPending}
            data-testid="button-create-user-confirm"
          >
            {createMutation.isPending ? "Creating..." : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/stats");
      return res.json();
    },
  });

  const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/users");
      return res.json();
    },
  });

  const { data: referralData } = useQuery<any>({
    queryKey: ["/api/admin/referrals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/referrals");
      return res.json();
    },
  });

  // Guard: redirect non-admins
  if (!authLoading && user && !(user as any).isAdmin) {
    navigate("/");
    return null;
  }

  // Filter users
  const filteredUsers = (users || []).filter((u) => {
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
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-lg font-bold">Admin Panel</h1>
              <p className="text-xs text-muted-foreground">SiteAmoeba internal control center</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Back to App
            </Button>
            <Button size="sm" onClick={() => setShowCreateUser(true)} data-testid="button-create-user">
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />
              New User
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Overview stats */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {statsLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />) : <>
              <StatCard label="Total Users" value={stats?.totalUsers ?? 0} sub={`+${stats?.newUsersThisWeek ?? 0} this week`} icon={Users} color="text-blue-500" />
              <StatCard label="Paid Users" value={stats?.paidUsers ?? 0} sub={`${stats?.freeUsers ?? 0} free`} icon={CreditCard} color="text-emerald-500" />
              <StatCard label="Trial Users" value={stats?.trialUsers ?? 0} icon={Activity} color="text-amber-500" />
              <StatCard label="Active Tests" value={stats?.activeTests ?? 0} sub={`${stats?.activeCampaigns ?? 0} campaigns`} icon={FlaskConical} color="text-purple-500" />
              <StatCard label="Visitors (30d)" value={(stats?.visitorsLast30Days ?? 0).toLocaleString()} icon={TrendingUp} color="text-teal-500" />
            </>}
          </div>

          {/* Plan breakdown */}
          {stats && (
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(stats.planBreakdown).map(([plan, count]) => (
                <div key={plan} className="flex items-center gap-1.5 bg-muted/60 rounded-full px-3 py-1">
                  {planBadge(plan)}
                  <span className="text-xs font-semibold">{count}</span>
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

          {/* ─── Users Tab ─── */}
          <TabsContent value="users" className="mt-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by email or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-users"
                />
              </div>
              <Select value={filterPlan} onValueChange={setFilterPlan}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All plans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plans</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="autopilot">Autopilot</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground self-center ml-1">
                {filteredUsers.length} of {users?.length ?? 0} users
              </p>
            </div>

            {/* Users table */}
            <Card>
              <div className="divide-y divide-border">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>User</span>
                  <span className="text-center w-20">Plan</span>
                  <span className="text-center w-20">Credits</span>
                  <span className="text-center w-20">Campaigns</span>
                  <span className="text-center w-20">Status</span>
                  <span className="w-6" />
                </div>

                {usersLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-4 py-3">
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No users match your filters
                  </div>
                ) : (
                  filteredUsers.map((u) => (
                    <div
                      key={u.id}
                      className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-3 items-center cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => setSelectedUserId(u.id)}
                      data-testid={`user-row-${u.id}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {u.name || u.email}
                          {u.isAdmin ? <span className="ml-1.5 text-xs text-amber-500">(admin)</span> : null}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <p className="text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="w-20 flex justify-center">{planBadge(u.plan)}</div>
                      <div className="w-20 text-center">
                        <span className="text-xs tabular-nums">{u.creditsUsed}/{u.creditsLimit}</span>
                      </div>
                      <div className="w-20 text-center">
                        <span className="text-xs">{u.activeCampaigns} active</span>
                      </div>
                      <div className="w-20 flex justify-center">{statusBadge(u.accountStatus)}</div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>

          {/* ─── Referrals Tab ─── */}
          <TabsContent value="referrals" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Leaderboard */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Referral Leaderboard</h3>
                <Card>
                  <div className="divide-y">
                    {!referralData?.leaderboard?.length ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No referrals yet
                      </div>
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

              {/* All referrals */}
              <div>
                <h3 className="text-sm font-semibold mb-3">All Referrals</h3>
                <Card>
                  <div className="divide-y">
                    {!referralData?.referrals?.length ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No referrals yet
                      </div>
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

          {/* ─── Enterprise Tab ─── */}
          <TabsContent value="enterprise" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="font-semibold text-base mb-1.5">Enterprise Accounts</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Enterprise account management will be available once the first enterprise client is onboarded.
                  This section will include data isolation controls, one-way Brain access, custom pricing, and dedicated account management.
                </p>
                <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm mx-auto text-left">
                  {["Data isolation", "Custom Brain access", "White-label options", "SLA monitoring", "Dedicated support", "$50K+/year minimum"].map((f) => (
                    <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* User Detail Sheet */}
      <UserDetailSheet userId={selectedUserId} onClose={() => setSelectedUserId(null)} />

      {/* Create User Dialog */}
      <CreateUserDialog open={showCreateUser} onClose={() => setShowCreateUser(false)} />
    </div>
  );
}
