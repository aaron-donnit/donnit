import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfig } from "@/lib/supabase";

export type DonnitSessionState = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  accessToken: string | null;
};

export function useSession(): DonnitSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(supabaseConfig.configured);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    configured: supabaseConfig.configured,
    loading,
    session,
    accessToken: session?.access_token ?? null,
  };
}
