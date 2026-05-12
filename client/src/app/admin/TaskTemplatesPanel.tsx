import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { ListChecks, ListPlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { Id, TaskTemplate } from "@/app/types";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";

export default function TaskTemplatesPanel({
  templates,
  authenticated,
}: {
  templates: TaskTemplate[];
  authenticated: boolean;
}) {
  const [editingId, setEditingId] = useState<string>("");
  const editingTemplate = templates.find((template) => String(template.id) === editingId) ?? null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerPhrases, setTriggerPhrases] = useState("");
  const [defaultUrgency, setDefaultUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [defaultEstimatedMinutes, setDefaultEstimatedMinutes] = useState(30);
  const [defaultRecurrence, setDefaultRecurrence] = useState<"none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual">("none");
  const [subtasks, setSubtasks] = useState("");

  useEffect(() => {
    if (!editingTemplate) {
      setName("");
      setDescription("");
      setTriggerPhrases("");
      setDefaultUrgency("normal");
      setDefaultEstimatedMinutes(30);
      setDefaultRecurrence("none");
      setSubtasks("");
      return;
    }
    setName(editingTemplate.name);
    setDescription(editingTemplate.description);
    setTriggerPhrases(editingTemplate.triggerPhrases.join(", "));
    setDefaultUrgency(editingTemplate.defaultUrgency);
    setDefaultEstimatedMinutes(editingTemplate.defaultEstimatedMinutes);
    setDefaultRecurrence(editingTemplate.defaultRecurrence);
    setSubtasks(editingTemplate.subtasks.map((subtask) => subtask.title).join("\n"));
  }, [editingTemplate?.id]);

  const payload = () => ({
    name: name.trim(),
    description: description.trim(),
    triggerPhrases: triggerPhrases
      .split(",")
      .map((phrase) => phrase.trim())
      .filter(Boolean),
    defaultUrgency,
    defaultEstimatedMinutes,
    defaultRecurrence,
    subtasks: subtasks
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = payload();
      const res = editingTemplate
        ? await apiRequest("PATCH", `/api/task-templates/${editingTemplate.id}`, body)
        : await apiRequest("POST", "/api/task-templates", body);
      return (await res.json()) as TaskTemplate;
    },
    onSuccess: async (template) => {
      await invalidateWorkspace();
      setEditingId(String(template.id));
      toast({
        title: "Template saved",
        description: "Matching tasks will now inherit this subtask sequence.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save template",
        description: apiErrorMessage(error, "Apply the task templates migration, then try again."),
        variant: "destructive",
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (templateId: Id) => {
      await apiRequest("DELETE", `/api/task-templates/${templateId}`);
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setEditingId("");
      toast({ title: "Template deleted", description: "New tasks will no longer use that sequence." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not delete template",
        description: apiErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    },
  });

  const currentPayload = payload();
  const ready = authenticated && currentPayload.name.length >= 2 && currentPayload.subtasks.length > 0;

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium text-foreground">Task templates</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Build reusable subtask sequences Donnit can attach from chat or scanned work.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditingId("")} data-testid="button-new-task-template">
          <ListPlus className="size-4" />
          New template
        </Button>
      </div>
      <div className="grid gap-3 px-3 py-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid content-start gap-2">
          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              No templates yet. Create one for repeatable work like onboarding, renewals, or quarterly reviews.
            </div>
          ) : (
            templates.map((template) => (
              <button
                key={String(template.id)}
                type="button"
                onClick={() => setEditingId(String(template.id))}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  String(template.id) === editingId ? "border-brand-green bg-brand-green/10" : "border-border bg-background hover:border-brand-green/60"
                }`}
                data-testid={`button-task-template-${template.id}`}
              >
                <span className="block text-sm font-medium text-foreground">{template.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {template.subtasks.length} subtask{template.subtasks.length === 1 ? "" : "s"} · {template.triggerPhrases.slice(0, 3).join(", ") || "name match"}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Onboard new employee"
                maxLength={120}
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-minutes">Default minutes</Label>
              <Input
                id="template-minutes"
                type="number"
                min={5}
                max={1440}
                value={defaultEstimatedMinutes}
                onChange={(event) => setDefaultEstimatedMinutes(Math.max(5, Math.min(1440, Number(event.target.value) || 30)))}
                data-testid="input-template-minutes"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-triggers">Trigger words</Label>
            <Input
              id="template-triggers"
              value={triggerPhrases}
              onChange={(event) => setTriggerPhrases(event.target.value)}
              placeholder="onboard, onboarding, new hire"
              data-testid="input-template-triggers"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="template-urgency">Default urgency</Label>
              <select
                id="template-urgency"
                value={defaultUrgency}
                onChange={(event) => setDefaultUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-template-urgency"
              >
                <option value="low">Low</option>
                <option value="normal">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-recurrence">Default repeat</Label>
              <select
                id="template-recurrence"
                value={defaultRecurrence}
                onChange={(event) => setDefaultRecurrence(event.target.value as "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-template-recurrence"
              >
                <option value="none">No</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-description">Template notes</Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this sequence is for."
              className="min-h-[70px]"
              data-testid="input-template-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-subtasks">Subtasks</Label>
            <Textarea
              id="template-subtasks"
              value={subtasks}
              onChange={(event) => setSubtasks(event.target.value)}
              placeholder={"Create account\nSend benefits packet\nSchedule manager check-in"}
              className="min-h-[110px]"
              data-testid="input-template-subtasks"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {editingTemplate && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => remove.mutate(editingTemplate.id)}
                disabled={remove.isPending}
                data-testid="button-delete-task-template"
              >
                {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Delete
              </Button>
            )}
            <Button type="button" onClick={() => save.mutate()} disabled={!ready || save.isPending} data-testid="button-save-task-template">
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
              Save template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
