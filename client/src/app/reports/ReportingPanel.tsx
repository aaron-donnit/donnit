import { AlertTriangle } from "lucide-react";
import type { AgendaItem, EmailSuggestion, Id, PositionProfile, Task } from "@/app/types";

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
  const agedOver7d = incomplete.filter((task) => {
    const created = new Date(task.createdAt).getTime();
    return Date.now() - created > 7 * 24 * 60 * 60 * 1000;
  });
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
  const avgDays =
    completionDurations.length > 0
      ? completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length / 86_400_000
      : null;

  const reviewedSuggestions = suggestions.filter((s) => s.status !== "pending");
  const approvedSuggestions = suggestions.filter((s) => s.status === "approved");
  const dismissedSuggestions = suggestions.filter((s) => s.status === "dismissed");
  const approvalRate =
    reviewedSuggestions.length > 0
      ? Math.round((approvedSuggestions.length / reviewedSuggestions.length) * 100)
      : null;
  const bySource = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.source] = (acc[task.source] ?? 0) + 1;
    return acc;
  }, {});
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");
  const sourcedTasks = tasks.filter((task) => task.source !== "manual");
  const automationShare = total > 0 ? Math.round((sourcedTasks.length / total) * 100) : 0;
  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;
  const scheduledAgenda = agenda.filter((item) => item.scheduleStatus === "scheduled");
  const agendaMinutes = scheduledAgenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const profilesWithMemory = positionProfiles.filter(
    (p) => p.persisted || p.recurringTasks.length > 0 || p.howTo.length > 0 || p.currentIncompleteTasks.length > 0,
  );
  const continuityCoverage =
    positionProfiles.length > 0 ? Math.round((profilesWithMemory.length / positionProfiles.length) * 100) : 0;
  const highRiskProfiles = positionProfiles.filter((p) => p.riskLevel === "high");

  const sourceEntries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const sourceMax = sourceEntries[0]?.[1] ?? 1;

  const pilotRisks = [
    pendingSuggestions.length > 0 ? `${pendingSuggestions.length} suggestion${pendingSuggestions.length === 1 ? "" : "s"} waiting for approval` : "",
    overdue.length > 0 ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} need attention` : "",
    delegatedOutstanding.length > 0 ? `${delegatedOutstanding.length} delegated task${delegatedOutstanding.length === 1 ? "" : "s"} still accountable to you` : "",
    highRiskProfiles.length > 0 ? `${highRiskProfiles.length} high-risk Position Profile${highRiskProfiles.length === 1 ? "" : "s"}` : "",
    tasks.length + suggestions.length === 0 ? "No captured work yet; start with chat, Gmail scan, or document import" : "",
  ].filter(Boolean).slice(0, 4);

  return (
    <div data-testid="panel-reporting" id="panel-reporting" className="space-y-1">
      <div className="reports-grid">
        {/* KPI 1 — Completed */}
        <div className="report-card kpi" style={{ borderTopColor: "hsl(var(--brand-green))" }}>
          <div className="report-lbl">Completed</div>
          <div className="report-val">{completed.length}</div>
          <div className={`report-delta ${completionRate >= 50 ? "is-up" : "is-down"}`}>
            {completionRate}% of all tasks
          </div>
        </div>

        {/* KPI 2 — Open */}
        <div className="report-card kpi" style={{ borderTopColor: "hsl(var(--accent-info))" }}>
          <div className="report-lbl">Open tasks</div>
          <div className="report-val">{incomplete.length}</div>
          <div className="report-delta">
            {automationShare}% from automation
          </div>
        </div>

        {/* KPI 3 — Avg time-to-close */}
        <div className="report-card kpi" style={{ borderTopColor: "hsl(var(--brand-amber))" }}>
          <div className="report-lbl">Avg time-to-close</div>
          <div className="report-val">
            {avgDays === null ? "N/A" : avgDays < 1 ? `${Math.round(avgDays * 24)}h` : `${avgDays.toFixed(1)}d`}
          </div>
          <div className="report-delta">
            {completionDurations.length} tasks measured
          </div>
        </div>

        {/* KPI 4 — Overdue / aged */}
        <div className="report-card kpi" style={{ borderTopColor: "hsl(var(--brand-alert))" }}>
          <div className="report-lbl">Aged &gt;7d</div>
          <div className="report-val">{agedOver7d.length}</div>
          <div className={`report-delta ${overdue.length > 0 ? "is-down" : ""}`}>
            {overdue.length} overdue right now
          </div>
        </div>

        {/* Source mix */}
        {sourceEntries.length > 0 && (
          <div className="report-card med">
            <div className="report-head">
              <h3>Where tasks come from</h3>
            </div>
            <div className="bars-h">
              {sourceEntries.slice(0, 5).map(([source, count]) => (
                <div key={source} className="bars-h-row">
                  <span className="bars-h-nm">{source}</span>
                  <div className="bars-h-track">
                    <div className="bars-h-fill" style={{ width: `${Math.round((count / sourceMax) * 100)}%` }} />
                  </div>
                  <span className="bars-h-val">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI quality + continuity */}
        <div className="report-card med">
          <div className="report-head">
            <h3>AI quality &amp; continuity</h3>
          </div>
          <div className="bars-h">
            <div className="bars-h-row">
              <span className="bars-h-nm">AI approval</span>
              <div className="bars-h-track">
                <div className="bars-h-fill" style={{ width: `${approvalRate ?? 0}%` }} />
              </div>
              <span className="bars-h-val">{approvalRate === null ? "N/A" : `${approvalRate}%`}</span>
            </div>
            <div className="bars-h-row">
              <span className="bars-h-nm">Continuity</span>
              <div className="bars-h-track">
                <div className="bars-h-fill" style={{ width: `${continuityCoverage}%` }} />
              </div>
              <span className="bars-h-val">{continuityCoverage}%</span>
            </div>
            <div className="bars-h-row">
              <span className="bars-h-nm">Automation</span>
              <div className="bars-h-track">
                <div className="bars-h-fill" style={{ width: `${automationShare}%` }} />
              </div>
              <span className="bars-h-val">{automationShare}%</span>
            </div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {dismissedSuggestions.length} dismissed · {scheduledAgenda.length} agenda items · {agendaMinutes} min scheduled
          </div>
        </div>
      </div>

      {/* Pilot readout */}
      {pilotRisks.length > 0 && (
        <div className="rounded-md border border-border bg-muted/35 px-4 py-3">
          <p className="ui-label mb-2">Pilot readout</p>
          <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground" data-testid="panel-pilot-analytics">
            {pilotRisks.map((risk) => (
              <li key={risk} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
