import { useMutation } from "@tanstack/react-query";
import { Check, MailPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmailSuggestion, Id, SuggestionPatch, Task } from "@/app/types";
import { urgencyClass } from "@/app/lib/urgency";
import { apiRequest } from "@/lib/queryClient";
import { invalidateWorkspace } from "@/app/lib/hooks";
import SuggestionCard from "@/app/inbox/SuggestionCard";

export default function AcceptancePanel({
  tasks,
  suggestions,
  onOpenInbox,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  onOpenInbox: () => void;
}) {
  const waiting = tasks.filter((task) => task.status === "pending_acceptance");
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  const VISIBLE_LIMIT = 2;
  const visibleWaiting = waiting.slice(0, VISIBLE_LIMIT);
  const remainingWaiting = Math.max(0, waiting.length - visibleWaiting.length);
  const remainingSuggestions = pendingSuggestions.length;
  const overflowParts: string[] = [];
  if (remainingWaiting > 0) {
    overflowParts.push(
      `+${remainingWaiting} more acceptance${remainingWaiting === 1 ? "" : "s"}`,
    );
  }
  if (remainingSuggestions > 0) {
    overflowParts.push(
      `+${remainingSuggestions} approval item${remainingSuggestions === 1 ? "" : "s"}`,
    );
  }
  const overflowLabel = overflowParts.length > 0 ? overflowParts.join(" · ") : null;

  const accept = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/tasks/${id}/accept`),
    onSuccess: invalidateWorkspace,
  });
  const deny = useMutation({
    mutationFn: async (id: Id) =>
      apiRequest("POST", `/api/tasks/${id}/deny`, { note: "Not the right owner." }),
    onSuccess: invalidateWorkspace,
  });
  const approveSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: invalidateWorkspace,
  });
  const dismissSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/dismiss`),
    onSuccess: invalidateWorkspace,
  });
  const updateSuggestion = useMutation({
    mutationFn: async ({ id, patch }: { id: Id; patch: SuggestionPatch }) =>
      apiRequest("PATCH", `/api/suggestions/${id}`, patch),
    onSuccess: invalidateWorkspace,
  });

  const visibleSuggestions = pendingSuggestions.slice(0, 3);
  const remainingSuggestionsAfterVisible = Math.max(
    0,
    pendingSuggestions.length - visibleSuggestions.length,
  );

  return (
    <div className="panel" data-testid="panel-acceptance">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Waiting on you</h3>
        <p className="ui-label mt-1">Acceptances and approval queue</p>
      </div>
      <div className="space-y-3 px-4 py-3">
        {waiting.length === 0 && pendingSuggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing waiting. Nice.</p>
        )}

        {visibleWaiting.map((task) => (
          <div
            key={task.id}
            className={`task-row ${urgencyClass(task.urgency)} flex-col items-stretch`}
            data-testid={`row-waiting-${task.id}`}
          >
            <p className="text-sm font-medium text-foreground break-words">{task.title}</p>
            <p className="text-xs text-muted-foreground">{task.dueDate ?? "No due date"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => accept.mutate(task.id)}
                data-testid={`button-accept-${task.id}`}
              >
                <Check className="size-4" /> Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deny.mutate(task.id)}
                data-testid={`button-deny-${task.id}`}
              >
                <X className="size-4" /> Deny
              </Button>
            </div>
          </div>
        ))}

        {visibleSuggestions.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="ui-label text-[10px] uppercase tracking-wider text-muted-foreground">
              Approval queue
            </p>
            {visibleSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onApprove={() => approveSuggestion.mutate(suggestion.id)}
                onDismiss={() => dismissSuggestion.mutate(suggestion.id)}
                onSaveEdits={(id, patch) => updateSuggestion.mutate({ id, patch })}
                approving={approveSuggestion.isPending}
                dismissing={dismissSuggestion.isPending}
                saving={updateSuggestion.isPending}
              />
            ))}
          </div>
        )}

        {(overflowLabel || remainingSuggestionsAfterVisible > 0) && (
          <button
            type="button"
            onClick={onOpenInbox}
            className="flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-brand-green hover:text-foreground"
            data-testid="button-waiting-overflow"
          >
            <span className="inline-flex items-center gap-1.5">
              <MailPlus className="size-3.5" />
              {overflowLabel ??
                `+${remainingSuggestionsAfterVisible} approval item${
                  remainingSuggestionsAfterVisible === 1 ? "" : "s"
                }`}
            </span>
            <span className="ui-label">Open</span>
          </button>
        )}
      </div>
    </div>
  );
}
