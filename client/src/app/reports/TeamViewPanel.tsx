import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { EmailSuggestion, Id, Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { urgencyClass, urgencyLabel, statusLabels } from "@/app/lib/urgency";
import { localDateIso, addLocalDays } from "@/app/lib/date";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { teamMembersForUser } from "@/app/lib/permissions";
import ReportMetric from "@/app/reports/ReportMetric";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";

export default function TeamViewPanel({
  tasks,
  suggestions,
  events,
  users,
  subtasks = [],
  authenticated = false,
  currentUserId,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  events: TaskEvent[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  currentUserId: Id;
}) {
  const currentUser = users.find((user) => String(user.id) === String(currentUserId));
  const canViewTeam = Boolean(currentUser && ["owner", "admin", "manager"].includes(currentUser.role));
  const teamMembers = teamMembersForUser(users, currentUser, currentUserId);
  const [selectedUserId, setSelectedUserId] = useState(String(teamMembers[0]?.id ?? ""));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "all">("30d");
  const urgencyRankClient = (urgency: string) =>
    urgency === "critical" ? 0 : urgency === "high" ? 1 : urgency === "normal" || urgency === "medium" ? 2 : 3;

  useEffect(() => {
    if (!teamMembers.some((member) => String(member.id) === selectedUserId)) {
      setSelectedUserId(String(teamMembers[0]?.id ?? ""));
    }
  }, [selectedUserId, teamMembers]);

  if (!canViewTeam) return null;
  const member = teamMembers.find((user) => String(user.id) === selectedUserId) ?? teamMembers[0];
  const memberTasks = member ? tasks.filter((task) => String(task.assignedToId) === String(member.id)) : [];
  const active = memberTasks.filter((task) => task.status !== "completed" && task.status !== "denied");
  const today = localDateIso();
  const soonIso = addLocalDays(2, today);
  const sinceDate = (() => {
    if (timeframe === "all") return null;
    const days = timeframe === "7d" ? 7 : 30;
    return addLocalDays(-days, today);
  })();
  const inTimeframe = (iso: string | null | undefined) => {
    if (!sinceDate || !iso) return true;
    return iso.slice(0, 10) >= sinceDate;
  };
  const overdue = active.filter((task) => task.dueDate && task.dueDate < today);
  const dueSoon = active.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= soonIso);
  const completed = memberTasks.filter((task) => task.status === "completed");
  const completedInRange = completed.filter((task) => inTimeframe(task.completedAt ?? task.createdAt));
  const delegated = active.filter((task) => task.delegatedToId);
  const pendingAcceptance = active.filter((task) => task.status === "pending_acceptance");
  const workloadMinutes = active.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const reviewedSuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.status !== "pending" &&
      (!member || String(suggestion.assignedToId ?? "") === String(member.id)) &&
      inTimeframe(suggestion.createdAt),
  );
  const approvedSuggestions = reviewedSuggestions.filter((suggestion) => suggestion.status === "approved");
  const approvalRate =
    reviewedSuggestions.length > 0
      ? Math.round((approvedSuggestions.length / reviewedSuggestions.length) * 100)
      : null;
  const sourceMix = memberTasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.source] = (acc[task.source] ?? 0) + 1;
    return acc;
  }, {});
  const sourceTotal = Math.max(1, Object.values(sourceMix).reduce((sum, count) => sum + count, 0));
  const teamStats = teamMembers.map((user) => {
    const owned = tasks.filter((task) => String(task.assignedToId) === String(user.id));
    const open = owned.filter((task) => task.status !== "completed" && task.status !== "denied");
    const userOverdue = open.filter((task) => task.dueDate && task.dueDate < today);
    const userDueSoon = open.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= soonIso);
    const userWorkload = open.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const attention = userOverdue.length * 3 + userDueSoon.length + open.filter((task) => task.urgency === "critical" || task.urgency === "high").length * 2;
    return { user, open, overdue: userOverdue, dueSoon: userDueSoon, workload: userWorkload, attention };
  });
  const teamOpen = teamStats.reduce((sum, item) => sum + item.open.length, 0);
  const teamOverdue = teamStats.reduce((sum, item) => sum + item.overdue.length, 0);
  const teamDueSoon = teamStats.reduce((sum, item) => sum + item.dueSoon.length, 0);
  const attentionQueue = active
    .filter(
      (task) =>
        (task.dueDate && task.dueDate <= soonIso) ||
        task.urgency === "critical" ||
        task.urgency === "high" ||
        task.status === "pending_acceptance",
    )
    .sort((a, b) => {
      const aOverdue = a.dueDate && a.dueDate < today ? 0 : 1;
      const bOverdue = b.dueDate && b.dueDate < today ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const urgencyDiff = (urgencyRankClient(a.urgency) - urgencyRankClient(b.urgency));
      if (urgencyDiff !== 0) return urgencyDiff;
      return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    });
  const visibleTasks = attentionQueue.length > 0 ? attentionQueue : active;
  const selectedTask = tasks.find((task) => String(task.id) === selectedTaskId) ?? null;
  const seedDemoTeam = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/seed-demo-team");
      return (await res.json()) as { message?: string; tasks?: number; suggestions?: number; positionProfiles?: number };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({
        title: "Demo workspace ready",
        description: result.message ?? "The Team dashboard now has sample members, tasks, approvals, and profiles to test.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add demo team",
        description: apiErrorMessage(error, "Confirm you are an admin and SUPABASE_SERVICE_ROLE_KEY is set."),
        variant: "destructive",
      });
    },
  });
  const requestUpdate = useMutation({
    mutationFn: async ({ task, owner }: { task: Task; owner?: User }) =>
      apiRequest("POST", `/api/tasks/${task.id}/request-update`, {
        note: `Please add a status update for ${task.title}${owner ? `, ${owner.name}` : ""}.`,
      }),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Update requested",
        description: "The request was added to the task history.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not request update",
        description: apiErrorMessage(error, "Try requesting the update again."),
        variant: "destructive",
      });
    },
  });

  const MEMBER_COLORS = [
    "#00C27A", "#2c6dd1", "#F5B800", "#FF5C35", "#7c3aed",
    "#0891b2", "#d97706", "#dc2626", "#059669", "#7c2d12",
  ];
  const memberColor = (index: number) => MEMBER_COLORS[index % MEMBER_COLORS.length];
  const maxWorkload = Math.max(1, ...teamStats.map((s) => s.workload));

  return (
    <div data-testid="panel-team-view" className="space-y-4">
      {teamMembers.length > 0 && (
        <>
          <div className="status-strip">
            <div className="status-cell" data-accent="info">
              <span className="status-cell-label">Direct reports</span>
              <span className="status-cell-value">{teamMembers.length}</span>
              <span className="status-cell-delta">across team</span>
            </div>
            <div className="status-cell">
              <span className="status-cell-label">Open work</span>
              <span className="status-cell-value">{teamOpen}</span>
              <span className="status-cell-delta">tasks across team</span>
            </div>
            <div className="status-cell" data-accent={teamOverdue > 0 ? "danger" : "success"}>
              <span className="status-cell-label">Overdue</span>
              <span className="status-cell-value">{teamOverdue}</span>
              <span className={`status-cell-delta ${teamOverdue > 0 ? "is-down" : "is-up"}`}>
                {teamOverdue > 0 ? "needs attention" : "all clear"}
              </span>
            </div>
            <div className="status-cell" data-accent="warning">
              <span className="status-cell-label">Due soon</span>
              <span className="status-cell-value">{teamDueSoon}</span>
              <span className="status-cell-delta">within 2 days</span>
            </div>
          </div>
          <div className="team-grid">
            {teamStats.map((item, index) => {
              const color = memberColor(index);
              const capacityPct = maxWorkload > 0 ? Math.min(100, Math.round((item.workload / maxWorkload) * 100)) : 0;
              const capacityColor = capacityPct > 90 ? "hsl(var(--brand-alert))" : capacityPct > 75 ? "hsl(var(--brand-amber))" : color;
              const initials = item.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
              const isSelected = String(item.user.id) === String(member?.id);
              return (
                <div
                  key={String(item.user.id)}
                  className="team-card"
                  style={{ "--member-color": color, outline: isSelected ? `2px solid ${color}` : "none", outlineOffset: "2px" } as React.CSSProperties}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedUserId(String(item.user.id))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedUserId(String(item.user.id)); }}
                  data-testid={`button-team-card-${item.user.id}`}
                >
                  <div className="team-card-head">
                    <div className="team-card-avatar" style={{ background: color }}>{initials}</div>
                    <div className="min-w-0 flex-1">
                      <div className="team-card-name truncate">{item.user.name}</div>
                      <div className="team-card-role truncate">{item.user.role}</div>
                    </div>
                  </div>
                  <div className="team-stat-row">
                    <div className="team-stat">
                      <div className="team-stat-lbl">Open</div>
                      <div className="team-stat-val">{item.open.length}</div>
                    </div>
                    <div className="team-stat">
                      <div className="team-stat-lbl">Due soon</div>
                      <div className={`team-stat-val ${item.dueSoon.length > 0 ? "is-warning" : ""}`}>{item.dueSoon.length}</div>
                    </div>
                    <div className="team-stat">
                      <div className="team-stat-lbl">Overdue</div>
                      <div className={`team-stat-val ${item.overdue.length > 0 ? "is-danger" : ""}`}>{item.overdue.length}</div>
                    </div>
                  </div>
                  <div>
                    <div className="team-capacity-label">
                      <span>Workload</span>
                      <span style={{ color: capacityColor }}>{Math.round(item.workload / 60)}h</span>
                    </div>
                    <div className="team-capacity-track">
                      <div className="team-capacity-fill" style={{ width: `${capacityPct}%`, background: capacityColor }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="panel">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="display-font text-sm font-bold">Team</h3>
            <p className="ui-label mt-1">Support, coverage, attention</p>
          </div>
          <Users className="size-4 text-brand-green" />
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {teamMembers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center">
            <Users className="mx-auto size-6 text-brand-green" />
            <p className="mt-2 text-sm font-medium text-foreground">No team members yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a pilot demo workspace before inviting real users.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => seedDemoTeam.mutate()}
              disabled={seedDemoTeam.isPending}
              data-testid="button-seed-demo-team"
            >
              {seedDemoTeam.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Seed demo workspace
            </Button>
          </div>
        ) : (
          <>
            <select
              value={String(member?.id ?? "")}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="select-team-member"
            >
              {teamMembers.map((user) => (
                <option key={String(user.id)} value={String(user.id)}>
                  {user.name}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <ReportMetric label="Team open" value={String(teamOpen)} />
              <ReportMetric label="Overdue" value={String(teamOverdue)} />
              <ReportMetric label="Due soon" value={String(teamDueSoon)} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-label">Team workload</p>
                <select
                  value={timeframe}
                  onChange={(event) => setTimeframe(event.target.value as "7d" | "30d" | "all")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  data-testid="select-team-timeframe"
                >
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <div className="space-y-1.5">
                {teamStats
                  .sort((a, b) => b.attention - a.attention || b.workload - a.workload)
                  .slice(0, 5)
                  .map((item) => {
                    const selected = String(item.user.id) === String(member?.id);
                    return (
                      <button
                        key={String(item.user.id)}
                        type="button"
                        onClick={() => setSelectedUserId(String(item.user.id))}
                        className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition ${
                          selected ? "border-brand-green bg-brand-green/5" : "border-border bg-background hover:border-brand-green/60"
                        }`}
                        data-testid={`button-team-member-${item.user.id}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{item.user.name}</span>
                          <span className="block truncate text-muted-foreground">
                            {item.open.length} open / {Math.round(item.workload / 60)}h planned
                          </span>
                        </span>
                        <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                          item.overdue.length > 0
                            ? "bg-destructive/10 text-destructive"
                            : item.dueSoon.length > 0
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {item.overdue.length > 0 ? `${item.overdue.length} overdue` : `${item.dueSoon.length} soon`}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <ReportMetric label="Open" value={String(active.length)} />
              <ReportMetric label="Past due" value={String(overdue.length)} />
              <ReportMetric label="Done" value={String(completedInRange.length)} />
              <ReportMetric label="Delegated" value={String(delegated.length)} />
              <ReportMetric label="Pending" value={String(pendingAcceptance.length)} />
              <ReportMetric label="AI accepted" value={approvalRate === null ? "N/A" : `${approvalRate}%`} />
            </div>

            {member && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{member.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {workloadMinutes < 60 ? `${workloadMinutes} min` : `${(workloadMinutes / 60).toFixed(1)}h`} active workload / {completedInRange.length} completed in view
                    </p>
                  </div>
                  <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    {member.role}
                  </span>
                </div>
              </div>
            )}

            {Object.keys(sourceMix).length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="ui-label mb-2">Source mix</p>
                <div className="space-y-2">
                  {Object.entries(sourceMix)
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, count]) => (
                      <div key={source} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="capitalize text-foreground">{source}</span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-brand-green"
                            style={{ width: `${Math.max(8, Math.round((count / sourceTotal) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-label">Needs attention</p>
                <span className="text-xs text-muted-foreground">{visibleTasks.length} item{visibleTasks.length === 1 ? "" : "s"}</span>
              </div>
              {visibleTasks.slice(0, 7).map((task) => {
                const taskSubtasks = subtasks.filter((subtask) => String(subtask.taskId) === String(task.id));
                const doneSubtasks = taskSubtasks.filter((subtask) => subtask.done).length;
                const lastEvent = events.find((event) => String(event.taskId) === String(task.id));
                const progressPct =
                  taskSubtasks.length > 0
                    ? Math.round((doneSubtasks / taskSubtasks.length) * 100)
                    : task.status === "completed"
                      ? 100
                      : task.status === "accepted"
                        ? 35
                        : task.status === "pending_acceptance"
                          ? 10
                          : 20;
                return (
                  <div
                    key={String(task.id)}
                    className={`w-full rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition hover:border-brand-green/60 ${urgencyClass(task.urgency)}`}
                    data-testid={`button-team-task-${task.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTaskId(String(task.id))}
                      className="block w-full text-left"
                    >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{task.title}</span>
                        <span className="mt-0.5 block truncate text-muted-foreground">
                          {task.dueDate ?? "No due date"} / {urgencyLabel(task.urgency)} / {task.estimatedMinutes} min
                        </span>
                      </span>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        {statusLabels[task.status] ?? task.status}
                      </span>
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-brand-green"
                        style={{ width: `${progressPct}%` }}
                      />
                    </span>
                    {(task.description || task.completionNotes || taskSubtasks.length > 0 || lastEvent) && (
                      <span className="mt-1 block truncate text-muted-foreground">
                        {taskSubtasks.length > 0
                          ? `${doneSubtasks}/${taskSubtasks.length} subtasks`
                          : task.completionNotes || task.description || lastEvent?.note}
                      </span>
                    )}
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <span className="text-[11px] text-muted-foreground">
                        {lastEvent ? `Last: ${lastEvent.type.replace(/_/g, " ")}` : "No updates yet"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => requestUpdate.mutate({ task, owner: member ?? undefined })}
                        disabled={requestUpdate.isPending}
                        data-testid={`button-team-request-update-${task.id}`}
                      >
                        {requestUpdate.isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                        Request update
                      </Button>
                    </div>
                  </div>
                );
              })}
              {active.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
                  No active tasks for this team member.
                </p>
              )}
            </div>
          </>
        )}
      </div>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        open={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
      />
      </div>
    </div>
  );
}
