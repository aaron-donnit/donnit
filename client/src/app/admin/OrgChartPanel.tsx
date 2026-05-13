import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { Id, User } from "@/app/types";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { canManageWorkspaceMembers, isActiveUser } from "@/app/lib/permissions";
import { titleCase } from "@/app/lib/task-text";

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function memberKey(user: User) {
  return [user.email, user.name].map((value) => normalized(value)).filter(Boolean);
}

export default function OrgChartPanel({
  users,
  currentUser,
}: {
  users: User[];
  currentUser: User | null;
}) {
  const canManage = canManageWorkspaceMembers(currentUser);
  const activeUsers = users.filter(isActiveUser);
  const [importText, setImportText] = useState("");

  const userLookup = useMemo(() => {
    const map = new Map<string, User>();
    activeUsers.forEach((user) => {
      memberKey(user).forEach((key) => map.set(key, user));
    });
    return map;
  }, [activeUsers]);

  const directReportsFor = (managerId: Id | null) =>
    activeUsers.filter((user) => String(user.managerId ?? "") === String(managerId ?? ""));

  const isDescendant = (candidateId: Id, managerId: Id, seen = new Set<string>()): boolean => {
    const managerKey = String(managerId);
    if (seen.has(managerKey)) return false;
    const nextSeen = new Set(seen).add(managerKey);
    const children = directReportsFor(managerId);
    return children.some((child) => String(child.id) === String(candidateId) || isDescendant(candidateId, child.id, nextSeen));
  };

  const managerOptionsFor = (user: User) =>
    activeUsers.filter((candidate) => String(candidate.id) !== String(user.id) && !isDescendant(candidate.id, user.id));

  const roots = activeUsers.filter((user) => !user.managerId || !activeUsers.some((candidate) => String(candidate.id) === String(user.managerId)));
  const assignedCount = activeUsers.filter((user) => user.managerId).length;

  const saveReportingLine = async (input: { user: User; managerId: string | null }) => {
    const res = await apiRequest("PATCH", `/api/admin/members/${encodeURIComponent(String(input.user.id))}`, {
      fullName: input.user.name,
      role: input.user.role,
      persona: input.user.persona || "operator",
      managerId: input.managerId,
      canAssign: input.user.canAssign,
      status: input.user.status ?? "active",
    });
    return await res.json();
  };

  const updateManager = useMutation({
    mutationFn: saveReportingLine,
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Org chart updated", description: "The reporting line was saved." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update org chart",
        description: apiErrorMessage(error, "Check member management permissions and try again."),
        variant: "destructive",
      });
    },
  });

  const importOrgChart = useMutation({
    mutationFn: async () => {
      const rows = importText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s*(?:,|\t|->)\s*/).map((part) => part.trim()));
      if (rows.length === 0) throw new Error("Paste at least one employee and manager line.");
      const updates = rows.map(([employeeValue, managerValue]) => {
        const employee = userLookup.get(normalized(employeeValue ?? ""));
        const manager = managerValue ? userLookup.get(normalized(managerValue)) : null;
        if (!employee) throw new Error(`Could not match employee: ${employeeValue}`);
        if (managerValue && !manager) throw new Error(`Could not match manager: ${managerValue}`);
        if (manager && String(manager.id) === String(employee.id)) throw new Error(`${employee.name} cannot report to themselves.`);
        return { employee, managerId: manager ? String(manager.id) : null };
      });
      for (const update of updates) {
        await saveReportingLine({ user: update.employee, managerId: update.managerId });
      }
      return updates.length;
    },
    onSuccess: async (count) => {
      setImportText("");
      await invalidateWorkspace();
      toast({ title: "Org chart imported", description: `${count} reporting line${count === 1 ? "" : "s"} updated.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not import org chart",
        description: error instanceof Error ? error.message : "Use employee email, manager email on each line.",
        variant: "destructive",
      });
    },
  });

  const renderNode = (user: User, depth = 0, seen = new Set<string>()) => {
    const id = String(user.id);
    if (seen.has(id)) return null;
    const nextSeen = new Set(seen).add(id);
    const reports = directReportsFor(user.id);
    return (
      <div key={id} className={depth === 0 ? "rounded-md border border-border bg-background" : "border-l border-border pl-3"}>
        <div className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_220px] sm:items-center">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {titleCase(user.role || "member")} {reports.length > 0 ? `/ ${reports.length} direct report${reports.length === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <select
            value={String(user.managerId ?? "")}
            onChange={(event) => updateManager.mutate({ user, managerId: event.target.value || null })}
            disabled={!canManage || updateManager.isPending}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            aria-label={`${user.name} reports to`}
            data-testid={`select-org-manager-${user.id}`}
          >
            <option value="">No manager</option>
            {managerOptionsFor(user).map((candidate) => (
              <option key={String(candidate.id)} value={String(candidate.id)}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        {reports.length > 0 && <div className="space-y-2 px-3 pb-3">{reports.map((report) => renderNode(report, depth + 1, nextSeen))}</div>}
      </div>
    );
  };

  return (
    <div className="rounded-md border border-border" data-testid="panel-org-chart">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium text-foreground">Organizational chart</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reporting lines power the Team dropdown and manager visibility.
          </p>
        </div>
        <span className="ui-label">
          {assignedCount}/{activeUsers.length} assigned
        </span>
      </div>
      <div className="grid gap-3 px-3 py-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="ui-label">People</p>
            <p className="mt-1 text-sm font-medium text-foreground">{activeUsers.length}</p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="ui-label">Managers</p>
            <p className="mt-1 text-sm font-medium text-foreground">{activeUsers.filter((user) => directReportsFor(user.id).length > 0).length}</p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="ui-label">Unassigned</p>
            <p className="mt-1 text-sm font-medium text-foreground">{activeUsers.length - assignedCount}</p>
          </div>
        </div>

        <div className="space-y-2">
          {roots.length > 0 ? roots.map((user) => renderNode(user)) : (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              No active users are available for the org chart.
            </div>
          )}
        </div>

        {canManage && (
          <div className="rounded-md border border-dashed border-border bg-muted/25 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">Import reporting lines</p>
                <p className="mt-0.5 text-xs text-muted-foreground">One line per person: employee email, manager email. Leave manager blank for no manager.</p>
              </div>
              <Users className="size-4 text-muted-foreground" />
            </div>
            <Textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={"maya@company.com, nina@company.com\naaron@company.com,"}
              className="min-h-[86px] font-mono text-xs"
              data-testid="input-org-chart-import"
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => importOrgChart.mutate()}
                disabled={importOrgChart.isPending || updateManager.isPending || !importText.trim()}
                data-testid="button-org-chart-import"
              >
                {importOrgChart.isPending || updateManager.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Import chart
              </Button>
            </div>
          </div>
        )}
        {updateManager.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Saving reporting line...
          </div>
        )}
        {!updateManager.isPending && assignedCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="size-3 text-brand-green" />
            Direct reports now appear in each manager's Team dropdown.
          </div>
        )}
      </div>
    </div>
  );
}
