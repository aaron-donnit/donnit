import { useEffect, useState } from "react";
import { Loader2, LogIn, LogOut, UserPlus, Workflow, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/useSession";
import {
  signInWithPassword,
  signUpWithPassword,
  signOut as supabaseSignOut,
  supabaseConfig,
} from "@/lib/supabase";
import { apiRequest, setAuthAccessToken } from "@/lib/queryClient";

type Mode = "signin" | "signup";

type AuthShellProps = {
  children: (ctx: AuthedContext) => React.ReactNode;
};

export type AuthedContext = {
  authenticated: boolean;
  email: string | null;
  signOut: () => Promise<void>;
};

export function AuthGate({ children }: AuthShellProps) {
  const { configured, loading, session, accessToken } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<"unknown" | "checking" | "needed" | "done" | "error">("unknown");

  useEffect(() => {
    setAuthAccessToken(accessToken);
  }, [accessToken]);

  // After signin/signup, ensure the user has a profile + default org.
  useEffect(() => {
    let cancelled = false;
    if (!session?.accessToken) {
      setBootstrapStatus("unknown");
      return;
    }
    (async () => {
      setBootstrapStatus("checking");
      try {
        const me = await apiRequest("GET", "/api/auth/me").then((r) => r.json());
        if (cancelled) return;
        if (me?.bootstrapped) {
          setBootstrapStatus("done");
          return;
        }
        setBootstrapStatus("needed");
      } catch {
        if (!cancelled) setBootstrapStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  async function handleBootstrap() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/auth/bootstrap", {
        fullName: fullName || undefined,
        orgName: orgName || undefined,
      });
      setBootstrapStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create your workspace.");
      setBootstrapStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabaseConfig.configured) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const session = await signUpWithPassword(email, password);
        if (!session) {
          setError("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      } else {
        await signInWithPassword(email, password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabaseSignOut();
  }

  // Demo mode — Supabase env vars not set. Render the existing app with
  // unauthenticated/demo data and a banner explaining how to enable auth.
  if (!configured) {
    return (
      <>{children({ authenticated: false, email: null, signOut })}</>
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" data-testid="card-auth">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Sparkles className="size-6 text-primary" />
              <div>
                <CardTitle>Donnit</CardTitle>
                <CardDescription>
                  {mode === "signin" ? "Sign in to your workspace" : "Create your Donnit account"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit} data-testid="form-auth">
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-auth-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-auth-password"
                />
              </div>
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-auth-error">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-full" data-testid="button-auth-submit">
                {busy ? <Loader2 className="size-4 animate-spin" /> : mode === "signin" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  data-testid="button-auth-toggle"
                >
                  {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
                </button>
                <Badge variant="outline" className="font-normal">Supabase Auth</Badge>
              </div>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                This preview keeps your session only in page memory, so reloading or closing the tab will sign you out.
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (bootstrapStatus === "checking" || bootstrapStatus === "unknown") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (bootstrapStatus === "needed" || bootstrapStatus === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" data-testid="card-bootstrap">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Workflow className="size-6 text-primary" />
              <div>
                <CardTitle>Set up your workspace</CardTitle>
                <CardDescription>One step before you can start delegating tasks.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bootstrap-name">Your name</Label>
              <Input
                id="bootstrap-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={session.user.email ?? ""}
                data-testid="input-bootstrap-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bootstrap-org">Organization name</Label>
              <Input
                id="bootstrap-org"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="My workspace"
                data-testid="input-bootstrap-org"
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}
            <Button onClick={handleBootstrap} disabled={busy} className="w-full" data-testid="button-bootstrap-submit">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}
              Create workspace
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="w-full" data-testid="button-bootstrap-signout">
              <LogOut className="size-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <>{children({ authenticated: true, email: session.user.email ?? null, signOut })}</>;
}

export function _supabaseConfigured() {
  return supabaseConfig.configured;
}
