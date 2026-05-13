import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import { invalidateWorkspace } from "@/app/lib/hooks";

export default function ManualEmailImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/email/manual", {
        subject: subject.trim(),
        body: body.trim(),
        fromEmail: fromEmail.trim() || undefined,
      });
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Email added",
        description: "Pasted email is queued in the approval inbox.",
      });
      setSubject("");
      setBody("");
      setFromEmail("");
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Could not import email",
        description: "Check the subject and body and try again.",
        variant: "destructive",
      });
    },
  });

  const ready = subject.trim().length >= 1 && body.trim().length >= 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Manual email import (diagnostic)</DialogTitle>
          <DialogDescription>
            Donnit's primary email flow is "Scan email", which reads unread Gmail directly. Use this
            paste form only as a one-off diagnostic when Gmail OAuth is not yet configured.
          </DialogDescription>
        </DialogHeader>
        <div className={`${dialogBodyClass} space-y-3`}>
          <div>
            <Label htmlFor="manual-email-from" className="ui-label mb-1.5 block">
              From (optional)
            </Label>
            <Input
              id="manual-email-from"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              placeholder="alex@example.com"
              data-testid="input-manual-email-from"
            />
          </div>
          <div>
            <Label htmlFor="manual-email-subject" className="ui-label mb-1.5 block">
              Subject
            </Label>
            <Input
              id="manual-email-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Action required: review Q2 contract"
              maxLength={240}
              data-testid="input-manual-email-subject"
            />
          </div>
          <div>
            <Label htmlFor="manual-email-body" className="ui-label mb-1.5 block">
              Body
            </Label>
            <Textarea
              id="manual-email-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Paste the relevant excerpt — the suggested task title, due date, and urgency will be inferred."
              className="min-h-[140px]"
              maxLength={4000}
              data-testid="input-manual-email-body"
            />
          </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-manual-email-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!ready || create.isPending}
            data-testid="button-manual-email-submit"
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
            Add to queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
