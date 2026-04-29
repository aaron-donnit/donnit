import { useEffect, useState } from "react";
import { KeyRound, Loader2, LogIn, LogOut, UserPlus, Workflow, Sparkles } from "lucide-react";
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
  requestPasswordRecovery,
  updatePasswordWithRecovery,
  getPendingRecovery,
  clearPendingRecovery,
  type RecoveryTokens,
} from "@/lib/supabase";
import { apiRequest, setAuthAccessToken } from "@/lib/queryClient";

type Mode = "signin" | "signup" | "forgot" | "reset";

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
  const [recovery, setRecovery] = useState<RecoveryTokens | null>(() => getPendingRecovery());
  const [mode, setMode] = useState<Mode>(() => (getPendingRecovery() ? "reset" : "signin"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabaseConfig.configured) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const session = await signUpWithPassword(email, password);
        if (!session) {
          setInfo("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      } else if (mode === "forgot") {
        await requestPasswordRecovery(email);
        setInfo("If an account exists for that email, a password reset link is on its way. Check your inbox.");
      } else if (mode === "reset") {
        if (!recovery) {
          throw new Error("Recovery link expired. Request a new password reset email.");
        }
        if (password.length < 6) {
          throw new Error("Use at least 6 characters for your new password.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        await updatePasswordWithRecovery(recovery.accessToken, password);
        clearPendingRecovery();
        setRecovery(null);
        setPassword("");
        setConfirmPassword("");
        setInfo("Password updated. Sign in with your new password.");
        setMode("signin");
      } else {
        await signInWithPassword(email, password);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Authentication failed.";
      // Nudge toward the right action when GoTrue tells us the account
      // already exists or the sign-in failed for a reason that "forgot
      // password" usually solves.
      const lower = message.toLowerCase();
      if (mode === "signup" && (lower.includes("already") || lower.includes("registered"))) {
        setError(`${message} Try signing in or use "Forgot password?" to recover access.`);
      } else if (mode === "signin" && lower.includes("invalid")) {
        setError(`${message} If you have forgotten your password, use the link below to reset it.`);
      } else {
        setError(message);
      }
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
    const headerCopy =
      mode === "signin"
        ? "Sign in to your workspace"
        : mode === "signup"
        ? "Create your Donnit account"
        : mode === "forgot"
        ? "Reset your password"
        : "Choose a new password";
    const submitLabel =
      mode === "signin"
        ? "Sign in"
        : mode === "signup"
        ? "Create account"
        : mode === "forgot"
        ? "Send reset link"
        : "Update password";
    const SubmitIcon =
      mode === "signin" ? LogIn : mode === "signup" ? UserPlus : KeyRound;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" data-testid="card-auth">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Sparkles className="size-6 text-primary" />
              <div>
                <CardTitle>Donnit</CardTitle>
                <CardDescription>{headerCopy}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit} data-testid="form-auth">
              {mode !== "reset" && (
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
              )}
              {(mode === "signin" || mode === "signup") && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="auth-password">Password</Label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => switchMode("forgot")}
                        data-testid="button-auth-forgot"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
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
              )}
              {mode === "reset" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-new-password">New password</Label>
                    <Input
                      id="auth-new-password"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-auth-new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-confirm-password">Confirm new password</Label>
                    <Input
                      id="auth-confirm-password"
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      data-testid="input-auth-confirm-password"
                    />
                  </div>
                </>
              )}
              {info && (
                <p
                  className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary"
                  data-testid="text-auth-info"
                >
                  {info}
                </p>
              )}
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-auth-error">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-full" data-testid="button-auth-submit">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <SubmitIcon className="size-4" />}
                {submitLabel}
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {mode === "signin" && (
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => switchMode("signup")}
                    data-testid="button-auth-toggle"
                  >
                    Need an account? Sign up
                  </button>
                )}
                {mode === "signup" && (
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => switchMode("signin")}
                    data-testid="button-auth-toggle"
                  >
                    Have an account? Sign in
                  </button>
                )}
                {(mode === "forgot" || mode === "reset") && (
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => switchMode("signin")}
                    data-testid="button-auth-back"
                  >
                    Back to sign in
                  </button>
                )}
                <Badge variant="outline" className="font-normal">Supabase Auth</Badge>
              </div>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {mode === "reset"
                  ? "Pick a strong password. After updating, sign in again to continue."
                  : mode === "forgot"
                  ? "We'll email you a secure link. Open it on this device to set a new password."
                  : "This preview keeps your session only in page memory, so reloading or closing the tab will sign you out."}
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
