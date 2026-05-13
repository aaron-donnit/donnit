import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Check, Inbox, Loader2, MailPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { EmailSuggestion, Id, SuggestionPatch, Task } from "@/app/types";
import { dialogShellClass } from "@/app/constants";
import { urgencyClass, urgencyLabel } from "@/app/lib/urgency";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import SuggestionCard from "@/app/inbox/SuggestionCard";

export default function ApprovalInboxDialog({
  open,
  onOpenChange,
  tasks,
  suggestions,
  onScanEmail,
  scanningEmail,
  onOpenManualImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  suggestions: EmailSuggestion[];
  onScanEmail?: () => void;
  scanningEmail?: boolean;
  onOpenManualImport?: () => void;
}) {
  const waiting = tasks.filter((task) => task.status === "pending_acceptance");
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const total = waiting.length + pendingSuggestions.length;

  const accept = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/tasks/${id}/accept`),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task accepted", description: "It is now in the active task list." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not accept task",
        description: apiErrorMessage(error, "Try accepting it again."),
        variant: "destructive",
      });
    },
  });
  const deny = useMutation({
    mutationFn: async (id: Id) =>
      apiRequest("POST", `/api/tasks/${id}/deny`, { note: "Not the right owner." }),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task denied", description: "The task was removed from your active queue." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not deny task",
        description: apiErrorMessage(error, "Try denying it again."),
        variant: "destructive",
      });
    },
  });
  const approveSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task added", description: "The approved suggestion is now in the task list." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add suggestion",
        description: apiErrorMessage(error, "Review the suggestion and try again."),
        variant: "destructive",
      });
    },
  });
  const dismissSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/dismiss`),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Suggestion dismissed", description: "It was removed from the approval queue." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not dismiss suggestion",
        description: apiErrorMessage(error, "Try dismissing it again."),
        variant: "destructive",
      });
    },
  });
  const updateSuggestion = useMutation({
    mutationFn: async ({ id, patch }: { id: Id; patch: SuggestionPatch }) =>
      apiRequest("PATCH", `/api/suggestions/${id}`, patch),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Suggestion updated", description: "Your edits were saved." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save suggestion",
        description: apiErrorMessage(error, "Check the edited fields and try again."),
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-4xl`}>
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-5 text-brand-green" />
            Approval inbox
          </DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${total} item${total === 1 ? "" : "s"} waiting for manager review.`
              : "No pending approvals or email suggestions."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {total === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/35 px-4 py-10 text-center">
              <CheckCircle2 className="mx-auto size-8 text-brand-green" />
              <p className="display-font mt-3 text-base font-bold">Queue is clear.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Scan email or assign work to create new approval items.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {onScanEmail && (
                  <Button size="sm" onClick={onScanEmail} disabled={scanningEmail} data-testid="button-empty-inbox-scan-email">
                    {scanningEmail ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
                    Scan email
                  </Button>
                )}
                {onOpenManualImport && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onOpenManualImport}
                    data-testid="button-empty-inbox-manual-email"
                  >
                    <MailPlus className="size-4" />
                    Import email
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {waiting.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui-label">Assigned to you</p>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                      {waiting.length}
                    </span>
                  </div>
                  {waiting.map((task) => (
                    <div
                      key={task.id}
                      className={`task-row ${urgencyClass(task.urgency)} flex-col items-stretch`}
                      data-testid={`row-approval-task-${task.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground break-words">{task.title}</p>
                          {task.description && (
                            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <span className="ui-label whitespace-nowrap">{urgencyLabel(task.urgency)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Due {task.dueDate ?? "not set"}</span>
                        <span>{task.estimatedMinutes} min</span>
                        <span>Source: {task.source}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => accept.mutate(task.id)}
                          disabled={accept.isPending || deny.isPending}
                          data-testid={`button-inbox-accept-${task.id}`}
                        >
                          <Check className="size-4" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deny.mutate(task.id)}
                          disabled={accept.isPending || deny.isPending}
                          data-testid={`button-inbox-deny-${task.id}`}
                        >
                          <X className="size-4" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {pendingSuggestions.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui-label">Suggested from email</p>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                      {pendingSuggestions.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pendingSuggestions.map((suggestion) => (
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
                </section>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-approval-inbox-close">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
