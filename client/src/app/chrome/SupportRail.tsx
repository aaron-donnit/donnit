import React from "react";
import { CalendarClock, CheckCircle2, Users } from "lucide-react";
import type { AgendaItem, AgendaPreferences, AgendaSchedule, EmailSuggestion, Id, PositionProfile, Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { localDateIso } from "@/app/lib/date";
import DueTodayPanel from "@/app/screens/home/DueTodayPanel";
import AcceptancePanel from "@/app/tasks/AcceptancePanel";
import AgendaPanel from "@/app/agenda/AgendaPanel";
import TeamViewPanel from "@/app/reports/TeamViewPanel";

export type SupportRailView = "today" | "agenda" | "team" | "reports";

export default function SupportRail({
  view,
  onViewChange,
  tasks,
  suggestions,
  users,
  subtasks = [],
  authenticated = false,
  currentUserId,
  events,
  agenda,
  positionProfiles,
  excludedTaskIds,
  agendaApproved,
  agendaPreferences,
  agendaSchedule,
  onOpenInbox,
  onBuildAgenda,
  onToggleAgendaTask,
  onMoveAgendaTask,
  onUpdateAgendaPreferences,
  onUpdateAgendaSchedule,
  onApproveAgenda,
  onOpenAgendaWork,
  onExportAgenda,
  isBuildingAgenda,
}: {
  view: SupportRailView;
  onViewChange: (view: SupportRailView) => void;
  tasks: Task[];
  suggestions: EmailSuggestion[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  currentUserId: Id;
  events: TaskEvent[];
  agenda: AgendaItem[];
  positionProfiles: PositionProfile[];
  excludedTaskIds: Set<string>;
  agendaApproved: boolean;
  agendaPreferences: AgendaPreferences;
  agendaSchedule: AgendaSchedule;
  onOpenInbox: () => void;
  onBuildAgenda: () => void;
  onToggleAgendaTask: (taskId: Id) => void;
  onMoveAgendaTask: (taskId: Id, direction: "up" | "down") => void;
  onUpdateAgendaPreferences: (preferences: AgendaPreferences) => void;
  onUpdateAgendaSchedule: (schedule: AgendaSchedule) => void;
  onApproveAgenda: () => void;
  onOpenAgendaWork: () => void;
  onExportAgenda: () => void;
  isBuildingAgenda: boolean;
}) {
  const today = localDateIso();
  const dueTodayCount = tasks.filter(
    (task) => task.dueDate === today && task.status !== "completed" && task.status !== "denied",
  ).length;
  const approvalCount =
    tasks.filter((task) => task.status === "pending_acceptance").length +
    suggestions.filter((suggestion) => suggestion.status === "pending").length;
  const activeTeamCount = tasks.filter(
    (task) => String(task.assignedToId) !== String(currentUserId) && task.status !== "completed" && task.status !== "denied",
  ).length;
  const tabs: Array<{
    id: SupportRailView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }> = [
    { id: "today", label: "Today", icon: CheckCircle2, count: dueTodayCount + approvalCount },
    { id: "agenda", label: "Agenda", icon: CalendarClock, count: agenda.length },
    { id: "team", label: "Team", icon: Users, count: activeTeamCount },
  ];

  return (
    <div className="space-y-3" data-testid="rail-support">
      <div
        className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-1 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4"
        role="tablist"
        aria-label="Command rail"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === view;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onViewChange(tab.id)}
              className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-xs font-medium transition ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
              }`}
              data-testid={`button-rail-${tab.id}`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`ml-0.5 inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                    selected ? "bg-brand-green-pale text-brand-green" : "bg-background text-muted-foreground"
                  }`}
                >
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view === "today" && (
        <div className="space-y-3" data-testid="rail-panel-today">
          <DueTodayPanel tasks={tasks} />
          <AcceptancePanel tasks={tasks} suggestions={suggestions} onOpenInbox={onOpenInbox} />
        </div>
      )}

      {view === "agenda" && (
        <AgendaPanel
          agenda={agenda}
          excludedTaskIds={excludedTaskIds}
          approved={agendaApproved}
          preferences={agendaPreferences}
          schedule={agendaSchedule}
          onBuild={onBuildAgenda}
          onToggleTask={onToggleAgendaTask}
          onMoveTask={onMoveAgendaTask}
          onPreferencesChange={onUpdateAgendaPreferences}
          onScheduleChange={onUpdateAgendaSchedule}
          onApprove={onApproveAgenda}
          onOpenWork={onOpenAgendaWork}
          onExport={onExportAgenda}
          isBuilding={isBuildingAgenda}
        />
      )}

      {view === "team" && (
        <TeamViewPanel
          tasks={tasks}
          suggestions={suggestions}
          events={events}
          users={users}
          subtasks={subtasks}
          authenticated={authenticated}
          currentUserId={currentUserId}
        />
      )}

    </div>
  );
}
