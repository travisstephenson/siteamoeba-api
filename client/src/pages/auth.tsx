import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function SiteAmoebaLogo() {
  return (
    <div className="flex flex-col items-center gap-2 mb-6">
      <svg
        width="48"
        height="48"
        viewBox="0 0 28 28"
        fill="none"
        aria-label="SiteAmoeba logo mark"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M14 3C10 3 5 5.5 4 10C3 14 5 17 7 19C9 21.5 8 24 11 25.5C14 27 17.5 26 20 24C22.5 22 24.5 20 25 17C25.5 14 24 11 22 9C20 7 18 3 14 3Z"
          fill="hsl(160 84% 36%)"
          opacity="0.15"
        />
        <path
          d="M14 3C10 3 5 5.5 4 10C3 14 5 17 7 19C9 21.5 8 24 11 25.5C14 27 17.5 26 20 24C22.5 22 24.5 20 25 17C25.5 14 24 11 22 9C20 7 18 3 14 3Z"
          stroke="hsl(160 84% 36%)"
          strokeWidth="1.5"
          fill="none"
        />
        <ellipse cx="13" cy="13.5" rx="4.5" ry="4" fill="hsl(160 84% 36%)" opacity="0.35" />
        <circle cx="15.5" cy="11.5" r="1.5" fill="hsl(160 84% 36%)" />
      </svg>
      <span className="text-xl font-semibold tracking-tight text-foreground">SiteAmoeba</span>
      <span className="text-sm text-muted-foreground">A/B testing that converts</span>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      setError(null);
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: async (data: { user: any; token: string }) => {
      // Store token first
      setAuthToken(data.token);
      // Set auth data directly in cache (don't rely on refetch race)
      queryClient.setQueryData(["/api/auth/me"], { user: data.user });
      // Also invalidate to ensure fresh data, but don't wait for it
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      onSuccess();
    },
    onError: (err: Error) => {
      const msg = err.message.includes("401")
        ? "Invalid email or password"
        : err.message.replace(/^\d+:\s*/, "");
      setError(msg);
      toast({ title: "Login failed", description: msg, variant: "destructive" });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Client-side validation
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    mutation.mutate({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-login">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="input-login-email"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          placeholder="8+ characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="input-login-password"
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive" data-testid="login-error">
          {error}
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending}
        data-testid="button-login-submit"
      >
        {mutation.isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Capture referral code from URL: ?ref=xxxx or hash: #/?ref=xxxx
  const referralCode = (() => {
    try {
      // Check main URL params
      const params = new URLSearchParams(window.location.search);
      if (params.get("ref")) return params.get("ref");
      // Check hash params (for hash-based routing)
      const hashSearch = window.location.hash.split("?")[1];
      if (hashSearch) {
        const hashParams = new URLSearchParams(hashSearch);
        if (hashParams.get("ref")) return hashParams.get("ref");
      }
      return null;
    } catch { return null; }
  })();

  const mutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string; referralCode?: string }) => {
      setError(null);
      const res = await apiRequest("POST", "/api/auth/register", data);
      return res.json();
    },
    onSuccess: async (data: { user: any; token: string }) => {
      setAuthToken(data.token);
      queryClient.setQueryData(["/api/auth/me"], { user: data.user });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      onSuccess();
    },
    onError: (err: Error) => {
      const raw = err.message.replace(/^\d+:\s*/, "");
      let msg = raw;
      if (raw.includes("409") || raw.toLowerCase().includes("already")) {
        msg = "This email is already registered";
      }
      setError(msg);
      toast({ title: "Registration failed", description: msg, variant: "destructive" });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    mutation.mutate({ name, email, password, ...(referralCode ? { referralCode } : {}) });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-register">
      <div className="space-y-2">
        <Label htmlFor="register-name">Full name</Label>
        <Input
          id="register-name"
          type="text"
          placeholder="Jane Smith"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-register-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-email">Email</Label>
        <Input
          id="register-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="input-register-email"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">Password</Label>
        <Input
          id="register-password"
          type="password"
          placeholder="8+ characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="input-register-password"
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive" data-testid="register-error">
          {error}
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending}
        data-testid="button-register-submit"
      >
        {mutation.isPending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}

export default function AuthPage() {
  const [, navigate] = useLocation();

  const handleSuccess = () => {
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <SiteAmoebaLogo />
        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="login">
              <TabsList className="w-full mb-4" data-testid="tabs-auth">
                <TabsTrigger value="login" className="flex-1" data-testid="tab-login">
                  Sign in
                </TabsTrigger>
                <TabsTrigger value="register" className="flex-1" data-testid="tab-register">
                  Create account
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <LoginForm onSuccess={handleSuccess} />
              </TabsContent>

              <TabsContent value="register">
                <RegisterForm onSuccess={handleSuccess} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
