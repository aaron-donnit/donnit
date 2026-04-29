import { useEffect, useState } from "react";
import {
  getCurrentSession,
  onAuthChange,
  supabaseConfig,
  type DonnitSession,
} from "@/lib/supabase";

export type DonnitSessionState = {
  configured: boolean;
  loading: boolean;
  session: DonnitSession | null;
  accessToken: string | null;
};

export function useSession(): DonnitSessionState {
  const [session, setSession] = useState<DonnitSession | null>(getCurrentSession());
  // Auth state lives in module memory, so there is nothing to load
  // asynchronously the way the supabase-js client did.
  const [loading] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((next) => {
      setSession(next);
    });
    return unsubscribe;
  }, []);

  return {
    configured: supabaseConfig.configured,
    loading,
    session,
    accessToken: session?.accessToken ?? null,
  };
}
