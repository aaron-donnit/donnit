import { useMemo, useState } from "react";
import { CalendarCheck, CalendarPlus, Check, GripVertical, Loader2, Play, SlidersHorizontal, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgendaItem, AgendaPreference, AgendaPreferences, AgendaSchedule, Id } from "@/app/types";
import { formatAgendaTime } from "@/app/lib/agenda";
import { urgencyClass, urgencyLabel } from "@/app/lib/urgency";

const SLOT_HEIGHT = 44;

function agendaDayKey(item: AgendaItem) {
  return item.startAt?.slice(0, 10) ?? item.dueDate ?? "unscheduled";
}

function agendaDayLabel(key: string) {
  if (key === "unscheduled") return "Needs scheduling";
  const parsed = new Date(`${key}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return key;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(parsed);
}

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinute(minute: number) {
  const hour24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  return `${hour24 % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function itemStartMinute(item: AgendaItem) {
  if (!item.startAt) return null;
  const match = item.startAt.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function itemEndMinute(item: AgendaItem) {
  if (!item.endAt) return null;
  const match = item.endAt.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function scheduledMeta(item: AgendaItem) {
  if (!item.startAt || !item.endAt || item.scheduleStatus !== "scheduled") return "Needs time";
  return `${formatAgendaTime(item.startAt)} - ${formatAgendaTime(item.endAt)}`;
}

function preferenceSummary(preferences: AgendaPreferences) {
  return `${preferences.workdayStart}-${preferences.workdayEnd} / lunch ${preferences.lunchStart}`;
}

export default function AgendaPanel({
  agenda,
  excludedTaskIds,
  approved,
  preferences,
  schedule,
  onBuild,
  onToggleTask,
  onReorderTask,
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
  onReorderTask: (sourceTaskId: Id, targetTaskId: Id) => void;
  onPreferencesChange: (preferences: AgendaPreferences) => void;
  onScheduleChange: (schedule: AgendaSchedule) => void;
  onApprove: () => void;
  onOpenWork: () => void;
  onExport: () => void;
  isBuilding: boolean;
}) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const includedAgenda = agenda.filter((item) => !excludedTaskIds.has(String(item.taskId)));
  const totalMinutes = includedAgenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const scheduledCount = includedAgenda.filter((item) => item.scheduleStatus === "scheduled").length;
  const workdayStart = timeToMinutes(preferences.workdayStart);
  const workdayEnd = Math.max(timeToMinutes(preferences.workdayEnd), workdayStart + 60);
  const timelineRows = useMemo(() => {
    const rows: number[] = [];
    for (let minute = workdayStart; minute <= workdayEnd; minute += 30) rows.push(minute);
    return rows;
  }, [workdayEnd, workdayStart]);
  const agendaGroups = agenda.reduce<Array<{ key: string; label: string; items: AgendaItem[] }>>((groups, item) => {
    const key = agendaDayKey(item);
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(item);
    else groups.push({ key, label: agendaDayLabel(key), items: [item] });
    return groups;
  }, []);
  const updatePreference = <K extends keyof AgendaPreferences>(key: K, value: AgendaPreferences[K]) => {
    onPreferencesChange({ ...preferences, [key]: value });
  };
  const updateSchedule = <K extends keyof AgendaSchedule>(key: K, value: AgendaSchedule[K]) => {
    onScheduleChange({ ...schedule, [key]: value });
  };

  return (
    <div className="panel overflow-hidden" data-testid="panel-agenda" id="panel-agenda">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h3 className="display-font text-sm font-bold">Agenda</h3>
            <p className="ui-label mt-1">
              {agenda.length > 0 ? `${scheduledCount}/${agenda.length} scheduled / ${totalMinutes} min` : "Build a daily agenda for approval"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:w-[360px]">
            <Button variant="outline" size="sm" className="w-full justify-center px-2" onClick={onBuild} disabled={isBuilding} data-testid="button-panel-build-agenda">
              {isBuilding ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}
              Build
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-center px-2" onClick={onOpenWork} disabled={includedAgenda.length === 0} data-testid="button-panel-work-agenda">
              <Play className="size-4" />
              Work
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-center px-2" onClick={onExport} disabled={includedAgenda.length === 0 || !approved} data-testid="button-panel-export-agenda">
              <CalendarPlus className="size-4" />
              Export
            </Button>
          </div>
        </div>
        {agenda.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Drag agenda blocks into the right order, remove anything unnecessary, then approve before calendar export.
            </p>
            <Button size="sm" onClick={onApprove} disabled={includedAgenda.length === 0 || approved} data-testid="button-approve-agenda">
              <Check className="size-4" />
              {approved ? "Approved" : "Approve"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <details className="rounded-md border border-border bg-background px-3 py-2" open={schedule.autoBuildEnabled}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
            <span className="inline-flex items-center gap-2">
              <CalendarCheck className="size-4 text-brand-green" />
              Daily approval draft
            </span>
            <span className="text-xs font-normal text-muted-foreground">{schedule.autoBuildEnabled ? `On at ${schedule.buildTime}` : "Off"}</span>
          </summary>
          <div className="mt-3 grid gap-3">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span>
                <span className="block font-medium text-foreground">Auto-build each morning</span>
                <span className="block text-xs text-muted-foreground">Donnit drafts the agenda for approval once per day when you open the workspace.</span>
              </span>
              <input type="checkbox" checked={schedule.autoBuildEnabled} onChange={(event) => updateSchedule("autoBuildEnabled", event.target.checked)} className="size-4 accent-brand-green" data-testid="checkbox-agenda-auto-build" />
            </label>
            <div>
              <Label className="text-[11px]">Draft time</Label>
              <Input type="time" value={schedule.buildTime} onChange={(event) => updateSchedule("buildTime", event.target.value)} data-testid="input-agenda-auto-build-time" />
              <p className="mt-1 text-xs text-muted-foreground">Last auto-draft: {schedule.lastAutoBuildDate ?? "not yet"}</p>
            </div>
          </div>
        </details>

        <details className="rounded-md border border-border bg-background px-3 py-2" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-brand-green" />
              Work rules
            </span>
            <span className="text-xs font-normal text-muted-foreground">{preferenceSummary(preferences)}</span>
          </summary>
          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Workday start</Label>
                <Input type="time" value={preferences.workdayStart} onChange={(event) => updatePreference("workdayStart", event.target.value)} />
              </div>
              <div>
                <Label className="text-[11px]">Workday end</Label>
                <Input type="time" value={preferences.workdayEnd} onChange={(event) => updatePreference("workdayEnd", event.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Lunch</Label>
                <Input type="time" value={preferences.lunchStart} onChange={(event) => updatePreference("lunchStart", event.target.value)} />
              </div>
              <div>
                <Label className="text-[11px]">Lunch min</Label>
                <Input type="number" min={0} max={120} value={preferences.lunchMinutes} onChange={(event) => updatePreference("lunchMinutes", Number(event.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px]">Buffer</Label>
                <Input type="number" min={0} max={45} value={preferences.meetingBufferMinutes} onChange={(event) => updatePreference("meetingBufferMinutes", Number(event.target.value))} />
              </div>
              <div>
                <Label className="text-[11px]">Min block</Label>
                <Input type="number" min={5} max={60} value={preferences.minimumBlockMinutes} onChange={(event) => updatePreference("minimumBlockMinutes", Number(event.target.value))} />
              </div>
              <div>
                <Label className="text-[11px]">Focus</Label>
                <Input type="number" min={30} max={180} value={preferences.focusBlockMinutes} onChange={(event) => updatePreference("focusBlockMinutes", Number(event.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Morning</Label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={preferences.morningPreference} onChange={(event) => updatePreference("morningPreference", event.target.value as AgendaPreference)}>
                  <option value="deep_work">Deep work</option>
                  <option value="communications">Messages</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
              <div>
                <Label className="text-[11px]">Afternoon</Label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={preferences.afternoonPreference} onChange={(event) => updatePreference("afternoonPreference", event.target.value as AgendaPreference)}>
                  <option value="deep_work">Deep work</option>
                  <option value="communications">Messages</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
            </div>
          </div>
        </details>

        {agenda.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Build an agenda after tasks are added.
          </p>
        ) : (
          <div className="space-y-4">
            {agendaGroups.map((group) => {
              const scheduled = group.items.filter((item) => item.startAt && item.endAt && item.scheduleStatus === "scheduled");
              const unscheduled = group.items.filter((item) => !scheduled.includes(item));
              return (
                <section key={group.key} className="rounded-md border border-border bg-background">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{group.label}</p>
                      <p className="text-xs text-muted-foreground">{group.items.length} agenda block{group.items.length === 1 ? "" : "s"}</p>
                    </div>
                    <span className="ui-label">Day view</span>
                  </div>
                  {scheduled.length > 0 && (
                    <div className="relative overflow-hidden" style={{ minHeight: Math.max((timelineRows.length - 1) * SLOT_HEIGHT, 240) }}>
                      <div className="absolute inset-y-0 left-0 w-[76px] border-r border-border bg-muted/20">
                        {timelineRows.map((minute) => (
                          <div key={minute} className="relative border-b border-border/70 pl-2 text-[10px] text-muted-foreground" style={{ height: SLOT_HEIGHT }}>
                            <span className="absolute -top-2 bg-background pr-1">{formatMinute(minute)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="absolute inset-y-0 left-[76px] right-0">
                        {timelineRows.map((minute) => (
                          <div key={minute} className="border-b border-border/60" style={{ height: SLOT_HEIGHT }} />
                        ))}
                      </div>
                      {scheduled.map((item) => {
                        const start = itemStartMinute(item) ?? workdayStart;
                        const end = itemEndMinute(item) ?? start + item.estimatedMinutes;
                        const top = Math.max(4, ((start - workdayStart) / 30) * SLOT_HEIGHT + 4);
                        const height = Math.max(42, ((end - start) / 30) * SLOT_HEIGHT - 8);
                        const excluded = excludedTaskIds.has(String(item.taskId));
                        return (
                          <div
                            key={`${item.taskId}-${item.order}`}
                            draggable
                            onDragStart={() => setDraggingTaskId(String(item.taskId))}
                            onDragEnd={() => setDraggingTaskId(null)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (draggingTaskId && draggingTaskId !== String(item.taskId)) onReorderTask(draggingTaskId, item.taskId);
                              setDraggingTaskId(null);
                            }}
                            className={`absolute left-[88px] right-3 rounded-md border border-border bg-card px-3 py-2 shadow-sm transition ${urgencyClass(item.urgency)} ${excluded ? "opacity-50" : ""}`}
                            style={{ top, minHeight: height }}
                            data-testid={`row-agenda-${item.taskId}`}
                          >
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                              <GripVertical className="mt-0.5 size-4 cursor-grab text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="line-clamp-1 text-sm font-semibold text-foreground">{item.title}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{scheduledMeta(item)} / {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}</p>
                              </div>
                              <Button variant="ghost" size="icon" className="size-7" onClick={() => onToggleTask(item.taskId)} aria-label={excluded ? "Add agenda block" : "Remove agenda block"} data-testid={`button-agenda-toggle-${item.taskId}`}>
                                <X className="size-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {unscheduled.length > 0 && (
                    <div className="space-y-2 border-t border-border p-3">
                      <p className="ui-label">Needs time</p>
                      {unscheduled.map((item) => (
                        <div
                          key={`${item.taskId}-${item.order}-unscheduled`}
                          draggable
                          onDragStart={() => setDraggingTaskId(String(item.taskId))}
                          onDragEnd={() => setDraggingTaskId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (draggingTaskId && draggingTaskId !== String(item.taskId)) onReorderTask(draggingTaskId, item.taskId);
                            setDraggingTaskId(null);
                          }}
                          className={`rounded-md border border-border bg-card px-3 py-2 shadow-sm ${urgencyClass(item.urgency)}`}
                        >
                          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                            <GripVertical className="mt-0.5 size-4 cursor-grab text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="line-clamp-1 text-sm font-semibold text-foreground">{item.title}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">Needs an open slot / {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => onToggleTask(item.taskId)} aria-label="Remove agenda block">
                              <X className="size-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
