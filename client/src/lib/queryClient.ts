import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// JWT token persistence via URL hash parameter
// We can't use localStorage/sessionStorage/cookies in the sandboxed iframe,
// so we store the token in a hash param that survives page refreshes.
let authToken: string | null = null;

function getTokenFromHash(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setTokenInHash(token: string | null) {
  const hash = window.location.hash;
  // Remove existing token param
  let cleanHash = hash.replace(/([?&])token=[^&]*/g, "").replace(/\?$/, "");
  if (token) {
    const separator = cleanHash.includes("?") ? "&" : "?";
    cleanHash = cleanHash + separator + "token=" + encodeURIComponent(token);
  }
  // Use replaceState to avoid adding to browser history
  window.history.replaceState(null, "", cleanHash || "#/");
}

// Initialize from hash on load
authToken = getTokenFromHash();

export function setAuthToken(token: string | null) {
  authToken = token;
  setTokenInHash(token);
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
