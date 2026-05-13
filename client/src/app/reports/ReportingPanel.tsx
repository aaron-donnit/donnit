import { AlertTriangle } from "lucide-react";
import type { AgendaItem, EmailSuggestion, Id, PositionProfile, Task } from "@/app/types";
import ReportMetric from "@/app/reports/ReportMetric";

export default function ReportingPanel({
  tasks,
  suggestions,
  agenda,
  positionProfiles,
  currentUserId,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  agenda: AgendaItem[];
  positionProfiles: PositionProfile[];
  currentUserId: Id;
}) {
  const now = new Date();
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed");
  const incomplete = tasks.filter((task) => task.status !== "completed" && task.status !== "denied");
  const overdue = incomplete.filter((task) => task.dueDate && new Date(`${task.dueDate}T23:59:59`) < now);
  const delegatedOutstanding = incomplete.filter(
    (task) => String(task.assignedById) === String(currentUserId) && String(task.assignedToId) !== String(currentUserId),
  );
  const completionDurations = completed
    .map((task) => {
      if (!task.completedAt) return null;
      const start = Date.parse(task.createdAt);
      const end = Date.parse(task.completedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return end - start;
    })
    .filter((value): value is number => value !== null);
  const avgHours =
    completionDurations.length > 0
      ? completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length / 36e5
      : null;
  const incompletePct = total > 0 ? Math.round((incomplete.length / total) * 100) : 0;
  const reviewedSuggestions = suggestions.filter((suggestion) => suggestion.status !== "pending");
  const approvedSuggestions = suggestions.filter((suggestion) => suggestion.status === "approved");
  const dismissedSuggestions = suggestions.filter((suggestion) => suggestion.status === "dismissed");
  const approvalRate =
    reviewedSuggestions.length > 0
      ? Math.round((approvedSuggestions.length / reviewedSuggestions.length) * 100)
      : null;
  const bySource = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.source] = (acc[task.source] ?? 0) + 1;
    return acc;
  }, {});
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const capturedSignals = tasks.length + suggestions.length;
  const sourcedTasks = tasks.filter((task) => task.source !== "manual");
  const automationShare = total > 0 ? Math.round((sourcedTasks.length / total) * 100) : 0;
  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;
  const reviewedRate = suggestions.length > 0 ? Math.round((reviewedSuggestions.length / suggestions.length) * 100) : 0;
  const scheduledAgenda = agenda.filter((item) => item.scheduleStatus === "scheduled");
  const agendaMinutes = scheduledAgenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const profilesWithMemory = positionProfiles.filter(
    (profile) =>
      profile.persisted ||
      profile.recurringTasks.length > 0 ||
      profile.howTo.length > 0 ||
      profile.currentIncompleteTasks.length > 0,
  );
  const continuityCoverage =
    positionProfiles.length > 0 ? Math.round((profilesWithMemory.length / positionProfiles.length) * 100) : 0;
  const highRiskProfiles = positionProfiles.filter((profile) => profile.riskLevel === "high");
  const pilotSignals = [
    {
      label: "Captured",
      value: String(capturedSignals),
      detail: `${tasks.length} tasks / ${suggestions.length} suggestions`,
    },
    {
      label: "AI quality",
      value: approvalRate === null ? "N/A" : `${approvalRate}%`,
      detail: `${reviewedRate}% reviewed / ${dismissedSuggestions.length} dismissed`,
    },
    {
      label: "Automation",
      value: `${automationShare}%`,
      detail: `${sourcedTasks.length} tasks from connected or AI-assisted sources`,
    },
    {
      label: "Work health",
      value: `${completionRate}%`,
      detail: `${overdue.length} overdue / ${incomplete.length} open`,
    },
    {
      label: "Agenda habit",
      value: scheduledAgenda.length > 0 ? `${scheduledAgenda.length}` : "0",
      detail: `${agendaMinutes} scheduled minutes ready for calendar`,
    },
    {
      label: "Continuity",
      value: `${continuityCoverage}%`,
      detail: `${profilesWithMemory.length}/${positionProfiles.length || 0} profiles with live memory`,
    },
  ];
  const pilotRisks = [
    pendingSuggestions.length > 0 ? `${pendingSuggestions.length} suggestion${pendingSuggestions.length === 1 ? "" : "s"} waiting for approval` : "",
    overdue.length > 0 ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} need attention` : "",
    delegatedOutstanding.length > 0 ? `${delegatedOutstanding.length} delegated task${delegatedOutstanding.length === 1 ? "" : "s"} still accountable to you` : "",
    highRiskProfiles.length > 0 ? `${highRiskProfiles.length} high-risk Position Profile${highRiskProfiles.length === 1 ? "" : "s"}` : "",
    capturedSignals === 0 ? "No captured work yet; start with chat, Gmail scan, or document import" : "",
  ].filter(Boolean).slice(0, 4);

  return (
    <div className="panel" data-testid="panel-reporting" id="panel-reporting">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Manager report</h3>
        <p className="ui-label mt-1">Completion, overdue, delegated</p>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <ReportMetric label="Incomplete" value={`${incompletePct}%`} />
        <ReportMetric label="Overdue" value={String(overdue.length)} />
        <ReportMetric label="Delegated" value={String(delegatedOutstanding.length)} />
        <ReportMetric label="Avg done" value={avgHours === null ? "N/A" : `${avgHours < 1 ? Math.round(avgHours * 60) + "m" : avgHours.toFixed(1) + "h"}`} />
        <ReportMetric label="Accepted AI" value={approvalRate === null ? "N/A" : `${approvalRate}%`} />
        <ReportMetric label="Dismissed" value={String(dismissedSuggestions.length)} />
      </div>
      {Object.keys(bySource).length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="ui-label mb-2">Source mix</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bySource).map(([source, count]) => (
              <span key={source} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {source}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="border-t border-border px-4 py-3" data-testid="panel-pilot-analytics">
        <div className="mb-3">
          <h4 className="display-font text-sm font-bold text-foreground">Pilot analytics</h4>
          <p className="ui-label mt-1">Behavior change and continuity signals</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {pilotSignals.map((signal) => (
            <div key={signal.label} className="rounded-md border border-border bg-background px-3 py-2">
              <p className="ui-label">{signal.label}</p>
              <p className="display-font mt-1 text-lg font-bold text-foreground">{signal.value}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-md border border-border bg-muted/35 px-3 py-2">
          <p className="ui-label">Pilot readout</p>
          {pilotRisks.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
              {pilotRisks.map((risk) => (
                <li key={risk} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Core loop is active: captured work is being reviewed, scheduled, and retained in role memory.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
