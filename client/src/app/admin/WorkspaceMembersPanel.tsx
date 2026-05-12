import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { Id, PositionProfile, User } from "@/app/types";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { titleCase } from "@/app/lib/task-text";
import { canManageWorkspaceMembers, isActiveUser } from "@/app/lib/permissions";
import WorkspaceMemberRow from "@/app/admin/WorkspaceMemberRow";

export const MEMBER_ROLE_OPTIONS = ["owner", "admin", "manager", "member", "viewer"] as const;
export const MEMBER_STATUS_OPTIONS = ["active", "inactive"] as const;

export default function WorkspaceMembersPanel({
  users,
  currentUser,
  currentUserId,
  positionProfiles,
}: {
  users: User[];
  currentUser: User | null;
  currentUserId: Id;
  positionProfiles: PositionProfile[];
}) {
  const canManage = canManageWorkspaceMembers(currentUser);
  const activeUsers = users.filter(isActiveUser);
  const managerOptions = activeUsers.filter((user) => ["owner", "admin", "manager"].includes(user.role));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof MEMBER_ROLE_OPTIONS)[number]>("member");
  const [persona, setPersona] = useState("operator");
  const [managerId, setManagerId] = useState("");
  const [canAssign, setCanAssign] = useState(false);
  const [positionProfileId, setPositionProfileId] = useState("");
  const availablePositionProfiles = positionProfiles
    .filter((profile) => profile.persisted)
    .filter((profile) => {
      if (!profile.currentOwnerId) return true;
      const owner = users.find((user) => String(user.id) === String(profile.currentOwnerId));
      return owner?.status === "inactive";
    });

  const addMember = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/members", {
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        persona: persona.trim() || "operator",
        managerId: managerId || null,
        canAssign,
        positionProfileId: positionProfileId || null,
      });
      return await res.json();
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Member added",
        description: "The user is staged in Donnit and can now receive assigned work.",
      });
      setFullName("");
      setEmail("");
      setRole("member");
      setPersona("operator");
      setManagerId("");
      setCanAssign(false);
      setPositionProfileId("");
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add member",
        description: apiErrorMessage(error, "Apply the member management migration and try again."),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium text-foreground">Members and access</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Stage users, reporting lines, and workspace permissions.
          </p>
        </div>
        <span className="ui-label">
          {activeUsers.length}/{users.length} active
        </span>
      </div>
      {canManage ? (
        <div className="grid gap-3 border-b border-border bg-muted/25 px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-full-name">Name</Label>
              <Input
                id="member-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Jordan Lee"
                data-testid="input-member-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jordan@company.com"
                data-testid="input-member-email"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="member-role">Role</Label>
              <select
                id="member-role"
                value={role}
                onChange={(event) => setRole(event.target.value as (typeof MEMBER_ROLE_OPTIONS)[number])}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                data-testid="select-member-role"
              >
                {MEMBER_ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {titleCase(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-manager">Manager</Label>
              <select
                id="member-manager"
                value={managerId}
                onChange={(event) => setManagerId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                data-testid="select-member-manager"
              >
                <option value="">No manager</option>
                {managerOptions.map((user) => (
                  <option key={String(user.id)} value={String(user.id)}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-persona">Persona</Label>
              <Input
                id="member-persona"
                value={persona}
                onChange={(event) => setPersona(event.target.value)}
                placeholder="operator"
                data-testid="input-member-persona"
              />
            </div>
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={canAssign}
                onChange={(event) => setCanAssign(event.target.checked)}
                data-testid="checkbox-member-can-assign"
              />
              Can assign
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-position-profile">Position Profile</Label>
            <select
              id="member-position-profile"
              value={positionProfileId}
              onChange={(event) => setPositionProfileId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              data-testid="select-member-position-profile"
            >
              <option value="">Choose available Position Profile</option>
              {availablePositionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              One active employee can own each Position Profile at a time.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => addMember.mutate()}
              disabled={addMember.isPending || fullName.trim().length < 2 || !email.includes("@") || (availablePositionProfiles.length > 0 && !positionProfileId)}
              data-testid="button-member-add"
            >
              {addMember.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Add member
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-b border-border px-3 py-3 text-sm text-muted-foreground">
          Only workspace owners and admins can change user access.
        </div>
      )}
      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {users.map((user) => (
          <WorkspaceMemberRow
            key={String(user.id)}
            user={user}
            users={users}
            currentUserId={currentUserId}
            canManage={canManage}
            positionProfiles={positionProfiles}
          />
        ))}
      </div>
    </div>
  );
}
