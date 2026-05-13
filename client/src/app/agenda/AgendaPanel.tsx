import { ArrowDown, ArrowUp, CalendarCheck, CalendarPlus, Check, Loader2, Play, SlidersHorizontal, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgendaItem, AgendaPreference, AgendaPreferences, AgendaSchedule, Id } from "@/app/types";
import { urgencyClass, urgencyLabel } from "@/app/lib/urgency";
import { formatAgendaSlot } from "@/app/lib/agenda";

export default function AgendaPanel({
  agenda,
  excludedTaskIds,
  approved,
  preferences,
  schedule,
  onBuild,
  onToggleTask,
  onMoveTask,
  onPreferencesChange,
  onScheduleChange,
  onApprove,
  onOpenWork,
  onExport,
  isBuilding,
}: {
  agenda: AgendaItem[];
  excludedTaskIds: Set<string>;
  approved: boolean;
  preferences: AgendaPreferences;
  schedule: AgendaSchedule;
  onBuild: () => void;
  onToggleTask: (taskId: Id) => void;
  onMoveTask: (taskId: Id, direction: "up" | "down") => void;
  onPreferencesChange: (preferences: AgendaPreferences) => void;
  onScheduleChange: (schedule: AgendaSchedule) => void;
  onApprove: () => void;
  onOpenWork: () => void;
  onExport: () => void;
  isBuilding: boolean;
}) {
  const includedAgenda = agenda.filter((item) => !excludedTaskIds.has(String(item.taskId)));
  const totalMinutes = includedAgenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const scheduledCount = includedAgenda.filter((item) => item.scheduleStatus === "scheduled").length;
  const updatePreference = <K extends keyof AgendaPreferences>(key: K, value: AgendaPreferences[K]) => {
    onPreferencesChange({ ...preferences, [key]: value });
  };
  const updateSchedule = <K extends keyof AgendaSchedule>(key: K, value: AgendaSchedule[K]) => {
    onScheduleChange({ ...schedule, [key]: value });
  };
  return (
    <div className="panel overflow-hidden" data-testid="panel-agenda" id="panel-agenda">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="display-font text-sm font-bold">Agenda</h3>
          <p className="ui-label mt-1">
            {agenda.length > 0 ? `${scheduledCount}/${agenda.length} scheduled / ${totalMinutes} min` : "No blocks yet"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center px-2"
            onClick={onBuild}
            disabled={isBuilding}
            data-testid="button-panel-build-agenda"
          >
            {isBuilding ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}
            Build
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center px-2"
            onClick={onOpenWork}
            disabled={includedAgenda.length === 0}
            data-testid="button-panel-work-agenda"
          >
            <Play className="size-4" />
            Work
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center px-2"
            onClick={onExport}
            disabled={includedAgenda.length === 0 || !approved}
            data-testid="button-panel-export-agenda"
          >
            <CalendarPlus className="size-4" />
            Export
          </Button>
        </div>
        {agenda.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {approved
              ? "Approved agenda is ready to work from or export."
              : "Review the agenda, remove anything unnecessary, then approve it to unlock calendar export."}
          </p>
        )}
      </div>
      <div className="px-4 py-3">
        <div className="space-y-3">
          <details className="rounded-md border border-border bg-background px-3 py-2" open={schedule.autoBuildEnabled}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
              <span className="inline-flex items-center gap-2">
                <CalendarCheck className="size-4 text-brand-green" />
                Daily approval draft
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {schedule.autoBuildEnabled ? `On at ${schedule.buildTime}` : "Off"}
              </span>
            </summary>
            <div className="mt-3 grid gap-3">
              <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <span>
                  <span className="block font-medium text-foreground">Auto-build each morning</span>
                  <span className="block text-xs text-muted-foreground">Donnit drafts the agenda for approval once per day when you open the workspace.</span>
                </span>
                <input
                  type="checkbox"
                  checked={schedule.autoBuildEnabled}
                  onChange={(event) => updateSchedule("autoBuildEnabled", event.target.checked)}
                  className="size-4 accent-brand-green"
                  data-testid="checkbox-agenda-auto-build"
                />
              </label>
              <div>
                <Label className="text-[11px]">Draft time</Label>
                <Input
                  type="time"
                  value={schedule.buildTime}
                  onChange={(event) => updateSchedule("buildTime", event.target.value)}
                  data-testid="input-agenda-auto-build-time"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Last auto-draft: {schedule.lastAutoBuildDate ?? "not yet"}
                </p>
              </div>
            </div>
          </details>
          {agenda.length === 0 ? (
            <p className="text-sm text-muted-foreground">Build an agenda after tasks are added.</p>
          ) : (
            <>
            <details className="rounded-md border border-border bg-background px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-brand-green" />
                  Schedule preferences
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {preferences.workdayStart}-{preferences.workdayEnd}
                </span>
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Start</Label>
                    <Input
                      type="time"
                      value={preferences.workdayStart}
                      onChange={(event) => updatePreference("workdayStart", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">End</Label>
                    <Input
                      type="time"
                      value={preferences.workdayEnd}
                      onChange={(event) => updatePreference("workdayEnd", event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Lunch</Label>
                    <Input
                      type="time"
                      value={preferences.lunchStart}
                      onChange={(event) => updatePreference("lunchStart", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Lunch min</Label>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={preferences.lunchMinutes}
                      onChange={(event) => updatePreference("lunchMinutes", Number(event.target.value))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[11px]">Buffer</Label>
                    <Input
                      type="number"
                      min={0}
                      max={45}
                      value={preferences.meetingBufferMinutes}
                      onChange={(event) => updatePreference("meetingBufferMinutes", Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Min block</Label>
                    <Input
                      type="number"
                      min={5}
                      max={60}
                      value={preferences.minimumBlockMinutes}
                      onChange={(event) => updatePreference("minimumBlockMinutes", Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Focus</Label>
                    <Input
                      type="number"
                      min={30}
                      max={180}
                      value={preferences.focusBlockMinutes}
                      onChange={(event) => updatePreference("focusBlockMinutes", Number(event.target.value))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Morning</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={preferences.morningPreference}
                      onChange={(event) => updatePreference("morningPreference", event.target.value as AgendaPreference)}
                    >
                      <option value="deep_work">Deep work</option>
                      <option value="communications">Messages</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Afternoon</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={preferences.afternoonPreference}
                      onChange={(event) => updatePreference("afternoonPreference", event.target.value as AgendaPreference)}
                    >
                      <option value="deep_work">Deep work</option>
                      <option value="communications">Messages</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Rebuild after changing preferences so Donnit can repair the schedule against your calendar.
                </p>
              </div>
            </details>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Review, reorder, remove anything that should not be scheduled, then approve before export.
                </p>
                <Button
                  size="sm"
                  onClick={onApprove}
                  disabled={includedAgenda.length === 0 || approved}
                  data-testid="button-approve-agenda"
                >
                  <Check className="size-4" />
                  {approved ? "Approved" : "Approve agenda"}
                </Button>
              </div>
            </div>
            <ol className="space-y-2">
              {agenda.map((item, index) => {
                const excluded = excludedTaskIds.has(String(item.taskId));
                return (
                  <li
                    key={`${item.taskId}-${item.order}`}
                    className={`task-row flex-col items-stretch gap-2 overflow-hidden px-3 py-3 ${urgencyClass(item.urgency)} ${excluded ? "opacity-55" : ""}`}
                    data-testid={`row-agenda-${item.taskId}`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="line-clamp-1 min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
                        {item.title}
                      </p>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold tabular-nums">
                        {index + 1}
                      </span>
                    </div>
                    <div className="min-w-0 text-xs leading-snug text-muted-foreground">
                      <p className="truncate">{formatAgendaSlot(item)}</p>
                      <p className="mt-0.5 truncate">
                        {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}
                        {excluded ? " / Removed" : ""}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          aria-label="Move task earlier"
                          onClick={() => onMoveTask(item.taskId, "up")}
                          disabled={index === 0}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          aria-label="Move task later"
                          onClick={() => onMoveTask(item.taskId, "down")}
                          disabled={index === agenda.length - 1}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onToggleTask(item.taskId)}
                        data-testid={`button-agenda-toggle-${item.taskId}`}
                      >
                        {excluded ? "Add" : "Remove"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
