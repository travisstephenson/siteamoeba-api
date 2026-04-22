import { QueryClient, QueryFunction } from "@tanstack/react-query";

// API base URL resolution.
//
//   1. If the placeholder __PORT_5000__ has been substituted at deploy time
//      (Perplexity iframe preview), use that.
//   2. If we're running on the staging host, point at staging-api.siteamoeba.com
//      so staging never writes to production.
//   3. Otherwise default to production api.siteamoeba.com.
//
// This matches the APP_ENV=staging environment variable on the staging service
// so a single deploy can serve both staging and production without rebuild-time
// branching.
function resolveApiBase(): string {
  const port5000 = "__PORT_5000__";
  if (!port5000.startsWith("__")) return port5000;
  if (typeof window !== "undefined" && window.location) {
    const h = window.location.hostname;
    if (h.includes("staging-api.siteamoeba.com") || h.includes("staging.siteamoeba.com")) {
      return "https://staging-api.siteamoeba.com";
    }
  }
  return "https://api.siteamoeba.com";
}
export const API_BASE = resolveApiBase();

// JWT token persistence — stored in localStorage on the real domain (app.siteamoeba.com).
// Falls back to URL hash param for the Perplexity iframe preview (where localStorage is blocked).
const LS_KEY = "sa_auth_token";
let authToken: string | null = null;

function canUseLocalStorage(): boolean {
  try {
    localStorage.setItem("__sa_test__", "1");
    localStorage.removeItem("__sa_test__");
    return true;
  } catch {
    return false;
  }
}

function getTokenFromStorage(): string | null {
  // 1. URL query string (admin impersonation — one-time, immediately cleaned)
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get("token");
  if (urlToken) {
    const cleanUrl = window.location.pathname + (window.location.hash || "#/");
    window.history.replaceState(null, "", cleanUrl);
    return decodeURIComponent(urlToken);
  }
  // 2. localStorage (persists across refreshes on the real domain)
  if (canUseLocalStorage()) {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) return stored;
  }
  // 3. Hash-embedded token (fallback for sandboxed iframe)
  const hash = window.location.hash;
  const match = hash.match(/[?&]token=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

function persistToken(token: string | null) {
  if (canUseLocalStorage()) {
    if (token) {
      localStorage.setItem(LS_KEY, token);
    } else {
      localStorage.removeItem(LS_KEY);
    }
  }
  // Also clean any token from the hash (was used by old login flow)
  const hash = window.location.hash;
  if (hash.includes("token=")) {
    const cleanHash = hash.replace(/([?&])token=[^&]*/g, "").replace(/\?$/, "");
    window.history.replaceState(null, "", cleanHash || "#/");
  }
}

// Initialize on load
authToken = getTokenFromStorage();

export function setAuthToken(token: string | null) {
  authToken = token;
  persistToken(token);
}

export function getAuthToken(): string | null {
  return authToken;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    // If the response is HTML (e.g. a Cloudflare error page), don't dump it raw
    if (contentType.includes("text/html")) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(`${res.status}: Service temporarily unreachable — please try again in a moment.`);
      }
      throw new Error(`${res.status}: Unexpected server response. The service may be temporarily unavailable.`);
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: getAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
