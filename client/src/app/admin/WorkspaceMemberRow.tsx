import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { BriefcaseBusiness, Check, Loader2, RefreshCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { Id, PersistedPositionProfile, PositionProfile, User } from "@/app/types";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { titleCase } from "@/app/lib/task-text";
import { isActiveUser } from "@/app/lib/permissions";
import { MEMBER_ROLE_OPTIONS, MEMBER_STATUS_OPTIONS } from "@/app/admin/WorkspaceMembersPanel";

export default function WorkspaceMemberRow({
  user,
  users,
  currentUserId,
  canManage,
  positionProfiles,
}: {
  user: User;
  users: User[];
  currentUserId: Id;
  canManage: boolean;
  positionProfiles: PositionProfile[];
}) {
  const [fullName, setFullName] = useState(user.name);
  const [role, setRole] = useState<(typeof MEMBER_ROLE_OPTIONS)[number]>(
    MEMBER_ROLE_OPTIONS.includes(user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
      ? (user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
      : "member",
  );
  const [persona, setPersona] = useState(user.persona || "operator");
  const [managerId, setManagerId] = useState(user.managerId ? String(user.managerId) : "");
  const [canAssign, setCanAssign] = useState(Boolean(user.canAssign));
  const [status, setStatus] = useState<(typeof MEMBER_STATUS_OPTIONS)[number]>(user.status ?? "active");
  const [profileId, setProfileId] = useState("");
  const [lastAccessLink, setLastAccessLink] = useState("");
  const savedProfiles = positionProfiles
    .filter((profile) => profile.persisted)
    .filter((profile) => {
      if (!profile.currentOwnerId || String(profile.currentOwnerId) === String(user.id)) return true;
      const owner = users.find((candidate) => String(candidate.id) === String(profile.currentOwnerId));
      return owner?.status === "inactive";
    });
  const managerOptions = users.filter(
    (candidate) =>
      isActiveUser(candidate) &&
      ["owner", "admin", "manager"].includes(candidate.role) &&
      String(candidate.id) !== String(user.id),
  );
  const isSelf = String(user.id) === String(currentUserId);
  const copyAccessLink = async (value: string) => {
    setLastAccessLink(value);
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Link copied", description: "Send it to the user through your preferred channel." });
    } catch {
      toast({ title: "Access link ready", description: "Copy the link from the member row." });
    }
  };
  const saveMember = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/members/${encodeURIComponent(String(user.id))}`, {
        fullName: fullName.trim(),
        role,
        persona: persona.trim() || "operator",
        managerId: managerId || null,
        canAssign,
        status,
      });
      return await res.json();
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Member updated", description: `${fullName.trim() || user.name} was saved.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update member",
        description: apiErrorMessage(error, "Check role/status rules and try again."),
        variant: "destructive",
      });
    },
  });
  const accessAction = useMutation({
    mutationFn: async (action: "invite" | "reset-access" | "remove-access") => {
      const res = await apiRequest("POST", `/api/admin/members/${encodeURIComponent(String(user.id))}/${action}`);
      return {
        action,
        result: (await res.json()) as { ok: boolean; message?: string; actionLink?: string },
      };
    },
    onSuccess: async ({ action, result }) => {
      await invalidateWorkspace();
      if (result.actionLink) {
        await copyAccessLink(result.actionLink);
        return;
      }
      toast({
        title: action === "remove-access" ? "Access removed" : "Access updated",
        description: result.message ?? "Member access was updated.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update access",
        description: apiErrorMessage(error, "Check Supabase service role configuration and try again."),
        variant: "destructive",
      });
    },
  });
  const assignPositionProfile = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("Choose a Position Profile.");
      const profile = savedProfiles.find((item) => item.id === profileId);
      const res = await apiRequest("POST", "/api/position-profiles/assign", {
        profileId,
        fromUserId: profile?.currentOwnerId ?? user.id,
        toUserId: user.id,
        mode: "transfer",
        profileTitle: profile?.title ?? "Position Profile",
      });
      return (await res.json()) as { ok: boolean; updated: number; profile?: PersistedPositionProfile | null };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({ title: "Profile assigned", description: `${result.profile?.title ?? "Position Profile"} is now assigned to ${fullName.trim() || user.name}.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not assign profile",
        description: apiErrorMessage(error, "Confirm the profile is saved and try again."),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setFullName(user.name);
    setRole(
      MEMBER_ROLE_OPTIONS.includes(user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
        ? (user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
        : "member",
    );
    setPersona(user.persona || "operator");
    setManagerId(user.managerId ? String(user.managerId) : "");
    setCanAssign(Boolean(user.canAssign));
    setStatus(user.status ?? "active");
  }, [user.id, user.name, user.role, user.persona, user.managerId, user.canAssign, user.status]);

  return (
    <div className="grid gap-2 border-b border-border/60 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`ui-label ${status === "inactive" ? "text-muted-foreground" : ""}`}>{status}</span>
          <span className="ui-label">{titleCase(user.role || "member")}</span>
        </div>
      </div>
      {canManage && (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1.2fr_.85fr_.9fr_.9fr_.7fr_auto] sm:items-center">
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              aria-label={`${user.name} name`}
              className="h-9"
              data-testid={`input-member-row-name-${user.id}`}
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as (typeof MEMBER_ROLE_OPTIONS)[number])}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              disabled={isSelf && role === "owner"}
              aria-label={`${user.name} role`}
              data-testid={`select-member-row-role-${user.id}`}
            >
              {MEMBER_ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
            <select
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              aria-label={`${user.name} manager`}
              data-testid={`select-member-row-manager-${user.id}`}
            >
              <option value="">No manager</option>
              {managerOptions.map((candidate) => (
                <option key={String(candidate.id)} value={String(candidate.id)}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <Input
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              aria-label={`${user.name} persona`}
              className="h-9"
              data-testid={`input-member-row-persona-${user.id}`}
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof MEMBER_STATUS_OPTIONS)[number])}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              disabled={isSelf}
              aria-label={`${user.name} status`}
              data-testid={`select-member-row-status-${user.id}`}
            >
              {MEMBER_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={canAssign}
                  onChange={(event) => setCanAssign(event.target.checked)}
                  aria-label={`${user.name} can assign`}
                />
                Assign
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => saveMember.mutate()}
                disabled={saveMember.isPending || fullName.trim().length < 2}
                data-testid={`button-member-row-save-${user.id}`}
              >
                {saveMember.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save
              </Button>
            </div>
          </div>
          <div className="grid gap-2 rounded-md bg-muted/35 px-2 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <select
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              aria-label={`Assign Position Profile to ${user.name}`}
              data-testid={`select-member-row-position-profile-${user.id}`}
            >
              <option value="">Assign Position Profile</option>
              {savedProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => assignPositionProfile.mutate()}
              disabled={!profileId || assignPositionProfile.isPending || user.status === "inactive"}
              data-testid={`button-member-row-assign-profile-${user.id}`}
            >
              {assignPositionProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <BriefcaseBusiness className="size-4" />}
              Assign profile
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => accessAction.mutate("invite")}
              disabled={accessAction.isPending || user.status === "inactive"}
              data-testid={`button-member-row-invite-${user.id}`}
            >
              {accessAction.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Invite link
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => accessAction.mutate("reset-access")}
              disabled={accessAction.isPending || user.status === "inactive"}
              data-testid={`button-member-row-reset-${user.id}`}
            >
              {accessAction.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              Reset access
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => accessAction.mutate("remove-access")}
              disabled={accessAction.isPending || user.status === "inactive" || isSelf}
              data-testid={`button-member-row-remove-access-${user.id}`}
            >
              {accessAction.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Remove access
            </Button>
          </div>
          {lastAccessLink && (
            <div className="grid gap-2 rounded-md border border-dashed border-border px-2 py-2 sm:grid-cols-[1fr_auto]">
              <Input readOnly value={lastAccessLink} className="h-9 text-xs" aria-label={`${user.name} access link`} />
              <Button type="button" size="sm" variant="outline" onClick={() => copyAccessLink(lastAccessLink)}>
                Copy link
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
