import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { EmailSuggestion, Id, SuggestionDraftReplyResult, SuggestionPatch, SuggestionReplyResult } from "@/app/types";
import { EMAIL_SIGNATURE_TEMPLATES, EMAIL_SIGNATURE_TEMPLATE_KEY, dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import { urgencyLabel } from "@/app/lib/urgency";
import { apiErrorMessage } from "@/app/lib/tasks";
import { formatReceivedAt, parseSuggestionInsight, readCustomEmailSignature, readPreferredEmailSignatureTemplate, resolveEmailSignature, applyEmailSignature } from "@/app/lib/suggestions";
import { invalidateWorkspace } from "@/app/lib/hooks";

export default function SuggestionCard({
  suggestion,
  onApprove,
  onDismiss,
  onSaveEdits,
  approving,
  dismissing,
  saving,
}: {
  suggestion: EmailSuggestion;
  onApprove: () => void;
  onDismiss: () => void;
  onSaveEdits?: (id: Id, patch: SuggestionPatch) => void;
  approving: boolean;
  dismissing: boolean;
  saving?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState(suggestion.replyDraft ?? "");
  const [customSignature, setCustomSignature] = useState(readCustomEmailSignature);
  const [replySignatureId, setReplySignatureId] = useState(readPreferredEmailSignatureTemplate);
  const [markDoneAfterSend, setMarkDoneAfterSend] = useState(false);
  const [draftTitle, setDraftTitle] = useState(suggestion.suggestedTitle);
  const [draftDueDate, setDraftDueDate] = useState(suggestion.suggestedDueDate ?? "");
  const [draftUrgency, setDraftUrgency] = useState<"low" | "normal" | "high" | "critical">(
    ["low", "normal", "high", "critical"].includes(suggestion.urgency)
      ? (suggestion.urgency as "low" | "normal" | "high" | "critical")
      : "normal",
  );
  const [draftPreview, setDraftPreview] = useState(suggestion.preview ?? "");
  const actionItems = suggestion.actionItems ?? [];
  const insight = parseSuggestionInsight(actionItems);
  const body = (suggestion.body ?? "").trim();
  const preview = (suggestion.preview ?? body.slice(0, 240)).trim();
  const fromLower = suggestion.fromEmail.toLowerCase();
  const sourceLabel = fromLower.startsWith("slack:")
    ? "Slack"
    : fromLower.startsWith("sms:")
      ? "SMS"
      : fromLower.startsWith("document:")
        ? "Document"
        : "Email";
  const canReplyToSource = sourceLabel !== "Document" && (sourceLabel !== "Email" || suggestion.fromEmail.includes("@"));
  const replyTarget =
    sourceLabel === "Email"
      ? suggestion.fromEmail
      : sourceLabel === "Slack"
        ? suggestion.subject.replace(/^slack:\s*/i, "") || suggestion.fromEmail
        : suggestion.fromEmail.replace(/^sms:/i, "") || suggestion.fromEmail;
  const replyHelp =
    sourceLabel === "Email"
      ? "Donnit will send through Gmail when permission is connected, or open a prepared draft."
      : sourceLabel === "Slack"
        ? "Donnit will send through Slack when the bot is connected, or prepare the reply to copy."
        : "Donnit will send through Twilio when SMS is configured, or prepare the reply to copy.";
  const draftReply = useMutation({
    mutationFn: async (instruction?: string) => {
      const res = await apiRequest("POST", `/api/suggestions/${suggestion.id}/draft-reply`, {
        instruction: instruction?.trim() || undefined,
      });
      return (await res.json()) as SuggestionDraftReplyResult;
    },
    onSuccess: async (result) => {
      const latestCustomSignature = readCustomEmailSignature();
      if (latestCustomSignature !== customSignature) setCustomSignature(latestCustomSignature);
      const signature = resolveEmailSignature(replySignatureId, latestCustomSignature);
      setReplyBody(applyEmailSignature(result.draft, signature));
      await invalidateWorkspace();
      toast({
        title: "Reply drafted",
        description: "Review it before sending.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not draft reply",
        description: apiErrorMessage(error, "Try again or write the reply manually."),
        variant: "destructive",
      });
    },
  });
  const openReplyDialog = () => {
    const latestCustomSignature = readCustomEmailSignature();
    setCustomSignature(latestCustomSignature);
    const preferredTemplate = readPreferredEmailSignatureTemplate();
    setReplySignatureId(preferredTemplate);
    const signature = resolveEmailSignature(preferredTemplate, latestCustomSignature);
    const sourceDraft = suggestion.replyDraft ?? replyBody;
    if (sourceDraft.trim()) {
      setReplyBody(applyEmailSignature(sourceDraft, signature));
    }
    setReplyOpen(true);
    if (!replyBody.trim() && !suggestion.replyDraft) {
      draftReply.mutate(undefined);
    }
  };
  const updateReplySignature = (templateId: string) => {
    setReplySignatureId(templateId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(EMAIL_SIGNATURE_TEMPLATE_KEY, templateId);
    }
    const signature = resolveEmailSignature(templateId, customSignature);
    if (replyBody.trim()) {
      setReplyBody((current) => applyEmailSignature(current, signature));
    }
  };
  const sendReply = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/suggestions/${suggestion.id}/reply`, {
        message: replyBody.trim(),
        completeTask: markDoneAfterSend,
      });
      return (await res.json()) as SuggestionReplyResult;
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      if (result.delivery === "mailto" && result.href) {
        window.location.href = result.href;
        setReplyOpen(false);
        toast({
          title: "Email draft opened",
          description: "Review and send it from your mail app.",
        });
        return;
      }
      if (result.delivery === "sent") {
        setReplyOpen(false);
        setReplyBody("");
        setMarkDoneAfterSend(false);
        toast({
          title: "Reply sent",
          description: result.completedTask
            ? "Donnit sent the response and marked the related task done."
            : result.message ?? "Donnit sent the response.",
        });
        return;
      }
      const copyText = result.body ?? replyBody.trim();
      try {
        await navigator.clipboard?.writeText(copyText);
        toast({
          title: "Reply copied",
          description: result.message ?? "Paste it into the source tool to send.",
        });
      } catch {
        toast({
          title: "Reply ready",
          description: result.message ?? "Copy the message from this popup and send it in the source tool.",
        });
      }
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not prepare reply",
        description: apiErrorMessage(error, "Try that reply again."),
        variant: "destructive",
      });
    },
  });
  useEffect(() => {
    setDraftTitle(suggestion.suggestedTitle);
    setDraftDueDate(suggestion.suggestedDueDate ?? "");
    setDraftUrgency(
      ["low", "normal", "high", "critical"].includes(suggestion.urgency)
        ? (suggestion.urgency as "low" | "normal" | "high" | "critical")
      : "normal",
    );
    setDraftPreview(suggestion.preview ?? "");
    const nextDraft = suggestion.replyDraft ?? "";
    if (replyOpen) {
      const latestCustomSignature = readCustomEmailSignature();
      const signature = resolveEmailSignature(replySignatureId, latestCustomSignature);
      setReplyBody(nextDraft ? applyEmailSignature(nextDraft, signature) : "");
    } else {
      setReplyBody(nextDraft);
    }
  }, [replyOpen, replySignatureId, suggestion.id, suggestion.preview, suggestion.replyDraft, suggestion.suggestedDueDate, suggestion.suggestedTitle, suggestion.urgency]);
  const saveEdits = () => {
    if (!onSaveEdits || draftTitle.trim().length < 2) return;
    onSaveEdits(suggestion.id, {
      suggestedTitle: draftTitle.trim(),
      suggestedDueDate: draftDueDate || null,
      urgency: draftUrgency,
      preview: draftPreview.trim() || suggestion.preview,
    });
    setEditing(false);
  };
  return (
    <>
      <div
        className="rounded-md border border-border bg-card p-3 shadow-sm"
        data-testid={`row-suggestion-${suggestion.id}`}
      >
      <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="ui-label mb-1">Proposed task</p>
          {editing ? (
            <Input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              maxLength={160}
              className="h-9 text-sm"
              data-testid={`input-suggestion-title-${suggestion.id}`}
            />
          ) : (
            <p className="text-sm font-medium text-foreground break-words" data-testid={`text-suggestion-title-${suggestion.id}`}>
              {suggestion.suggestedTitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {insight.confidence && (
            <span className="rounded-md bg-brand-green/10 px-2 py-1 text-[10px] font-semibold uppercase text-brand-green">
              {insight.confidence}
            </span>
          )}
          {suggestion.suggestedDueDate && !editing && (
            <span className="ui-label whitespace-nowrap text-[10px]">
              Due {suggestion.suggestedDueDate}
            </span>
          )}
          <span className="ui-label whitespace-nowrap text-[10px]">
            {urgencyLabel(suggestion.urgency)}
          </span>
        </div>
      </div>

      <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs sm:grid-cols-3">
        <div className="min-w-0">
          <p className="ui-label">Source</p>
          <p className="mt-1 truncate text-foreground" data-testid={`text-suggestion-from-${suggestion.id}`}>
            {sourceLabel} - {suggestion.fromEmail}
          </p>
        </div>
        <div className="min-w-0">
          <p className="ui-label">Subject</p>
          <p className="mt-1 truncate text-foreground">{suggestion.subject}</p>
        </div>
        <div className="min-w-0">
          <p className="ui-label">Received</p>
          <p className="mt-1 truncate text-foreground">{formatReceivedAt(suggestion.receivedAt ?? null)}</p>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_150px]">
          <Textarea
            value={draftPreview}
            onChange={(event) => setDraftPreview(event.target.value)}
            className="min-h-[76px] text-xs sm:col-span-3"
            maxLength={600}
            data-testid={`input-suggestion-rationale-${suggestion.id}`}
          />
          <Input
            type="date"
            value={draftDueDate}
            onChange={(event) => setDraftDueDate(event.target.value)}
            className="h-9 text-xs"
            data-testid={`input-suggestion-due-${suggestion.id}`}
          />
          <select
            value={draftUrgency}
            onChange={(event) => setDraftUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid={`select-suggestion-urgency-${suggestion.id}`}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      )}

      {insight.why && !editing && (
        <div className="rounded-md border border-brand-green/15 bg-brand-green/5 px-3 py-2 text-xs text-foreground">
          <p className="font-medium">Why Donnit suggested this</p>
          <p className="mt-0.5 text-muted-foreground">{insight.why}</p>
          {(insight.estimate || insight.excerpt) && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {[insight.estimate, insight.excerpt ? `Source: ${insight.excerpt}` : null].filter(Boolean).join(" / ")}
            </p>
          )}
        </div>
      )}

      {insight.nextSteps.length > 0 && (
        <div className="rounded-md border border-border bg-background px-3 py-2">
          <p className="ui-label mb-1">Proposed next steps</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground" data-testid={`list-action-items-${suggestion.id}`}>
            {insight.nextSteps.map((item, index) => (
              <li key={`${suggestion.id}-ai-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {(preview || body) && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {expanded && body ? (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Donnit interpretation</p>
              <p className="break-words" data-testid={`text-suggestion-preview-${suggestion.id}`}>
                {preview}
              </p>
              <p className="font-medium text-foreground">Original email excerpt</p>
              <pre className="whitespace-pre-wrap break-words font-sans" data-testid={`text-suggestion-body-${suggestion.id}`}>
                {body}
              </pre>
            </div>
          ) : (
            <div>
              <p className="font-medium text-foreground">Donnit interpretation</p>
              <p className="line-clamp-3 break-words" data-testid={`text-suggestion-preview-${suggestion.id}`}>
                {preview || body.slice(0, 240)}
              </p>
            </div>
          )}
          {body && body.length > preview.length && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] font-medium text-brand-green hover:underline"
              data-testid={`button-suggestion-expand-${suggestion.id}`}
            >
              {expanded ? "Show less" : "Show full email"}
            </button>
          )}
        </div>
      )}

      {canReplyToSource && (suggestion.replySuggested || sourceLabel === "Email") && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-green/20 bg-brand-green/5 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-foreground">Need to respond?</p>
            <p className="text-muted-foreground">
              Donnit can draft a reply from the original message and this task.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={openReplyDialog}
            disabled={draftReply.isPending}
            data-testid={`button-suggestion-draft-reply-inline-${suggestion.id}`}
          >
            {draftReply.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Draft reply
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              onClick={saveEdits}
              disabled={saving || draftTitle.trim().length < 2}
              data-testid={`button-suggestion-save-${suggestion.id}`}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
              data-testid={`button-suggestion-cancel-edit-${suggestion.id}`}
            >
              Cancel
            </Button>
          </>
        ) : onSaveEdits ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            disabled={approving || dismissing}
            data-testid={`button-suggestion-edit-${suggestion.id}`}
          >
            <Pencil className="size-4" /> Edit
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={onApprove}
          disabled={approving || dismissing || editing}
          data-testid={`button-suggestion-approve-${suggestion.id}`}
        >
          <Check className="size-4" /> Approve task
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDismiss}
          disabled={approving || dismissing}
          data-testid={`button-suggestion-dismiss-${suggestion.id}`}
        >
          <X className="size-4" /> Dismiss
        </Button>
        {canReplyToSource && (
          <Button
            size="sm"
            variant="outline"
            onClick={openReplyDialog}
            disabled={draftReply.isPending}
            data-testid={`button-suggestion-reply-${suggestion.id}`}
          >
            {draftReply.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Reply
          </Button>
        )}
      </div>
      </div>
      </div>
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className={`${dialogShellClass} max-w-lg`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Reply to source</DialogTitle>
            <DialogDescription>
              Draft a response to {replyTarget}. {replyHelp}
            </DialogDescription>
          </DialogHeader>
          <div className={dialogBodyClass}>
            {draftReply.isPending && (
              <div className="mb-3 flex items-center gap-2 rounded-sm border border-brand-green/20 bg-brand-green/5 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-brand-green" />
                Donnit is drafting a response from the source message.
              </div>
            )}
            <div className="mb-3 grid gap-1.5">
              <Label htmlFor={`select-suggestion-signature-${suggestion.id}`} className="ui-label">
                Signature
              </Label>
              <select
                id={`select-suggestion-signature-${suggestion.id}`}
                value={replySignatureId}
                onChange={(event) => updateReplySignature(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground"
                data-testid={`select-suggestion-signature-${suggestion.id}`}
              >
                {EMAIL_SIGNATURE_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              {replySignatureId === "custom" && !customSignature.trim() && (
                <p className="text-[11px] text-muted-foreground">
                  Add your custom signature in Workspace settings.
                </p>
              )}
            </div>
            <Textarea
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder="Donnit will draft a response here, or you can write your own."
              className="min-h-[140px]"
              maxLength={4000}
              data-testid={`input-suggestion-reply-${suggestion.id}`}
            />
            <label className="mt-3 flex items-start gap-2 rounded-sm border border-border bg-muted/30 px-3 py-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={markDoneAfterSend}
                onChange={(event) => setMarkDoneAfterSend(event.target.checked)}
                className="mt-0.5"
                data-testid={`checkbox-suggestion-reply-complete-${suggestion.id}`}
              />
              <span>
                <span className="block font-medium">Mark related task done after sending</span>
                <span className="text-muted-foreground">
                  Donnit will only complete the matching approved task after the reply is sent directly.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setReplyOpen(false)} disabled={sendReply.isPending}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => draftReply.mutate("Regenerate this reply with a concise professional tone.")}
              disabled={draftReply.isPending || sendReply.isPending}
            >
              {draftReply.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Regenerate
            </Button>
            <Button onClick={() => sendReply.mutate()} disabled={replyBody.trim().length < 2 || sendReply.isPending || draftReply.isPending}>
              {sendReply.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sourceLabel === "Email" ? "Send" : "Send reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
