import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn, setAuthToken } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface AuthResponse {
  user: Omit<User, "passwordHash">;
}

export function useAuth() {
  const { data, isLoading } = useQuery<AuthResponse | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      // Clear JWT token, set auth to null, then clear cache
      setAuthToken(null);
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
      window.location.hash = "#/auth";
    },
  });

  return {
    user: data?.user ?? null,
    isLoading,
    isAuthenticated: !!data?.user,
    logout: logoutMutation.mutate,
  };
}
