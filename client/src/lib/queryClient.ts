import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getCurrentSession, onAuthChange } from "@/lib/supabase";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Read the Supabase access token straight from the auth module. Going
// through React state (a useEffect that mirrors the token into a local
// variable) creates a window where the token has been emitted by GoTrue
// but the effect has not yet run, so the next apiRequest fires without
// an Authorization header and the server replies 401. Reading the
// module's source of truth eliminates that race.
function currentAccessToken(): string | null {
  return getCurrentSession()?.accessToken ?? null;
}

// Kept exported so call sites that previously pushed the token in (e.g.
// AuthGate) keep compiling. The function is now a no-op for token
// storage and only nudges react-query to refetch when auth changes.
export function setAuthAccessToken(_token: string | null) {
  queueMicrotask(() => {
    queryClient.invalidateQueries();
  });
}

// Refetch on every auth-state transition so authenticated views pick up
// data and signed-out views drop it.
onAuthChange(() => {
  queueMicrotask(() => {
    queryClient.invalidateQueries();
  });
});

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = currentAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
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
  const headers = authHeaders(data ? { "Content-Type": "application/json" } : undefined);
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
      headers: authHeaders(),
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
