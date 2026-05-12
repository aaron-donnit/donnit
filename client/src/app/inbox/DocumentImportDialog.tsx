import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import { invalidateWorkspace } from "@/app/lib/hooks";

export default function DocumentImportDialog({
  open,
  onOpenChange,
  onOpenApprovalInbox,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenApprovalInbox: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a PDF, Word, or text file first.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Could not read the document."));
        reader.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const res = await apiRequest("POST", "/api/documents/suggest", {
        fileName: file.name,
        mimeType: file.type,
        dataBase64,
      });
      return (await res.json()) as { ok: boolean; created: number };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({
        title: "Document scanned",
        description:
          result.created > 0
            ? `Queued ${result.created} task suggestion${result.created === 1 ? "" : "s"} for approval.`
            : "No task suggestions were found.",
      });
      setFile(null);
      onOpenChange(false);
      if (result.created > 0) onOpenApprovalInbox();
    },
    onError: (error: unknown) => {
      toast({
        title: "Document scan failed",
        description: error instanceof Error ? error.message : "Upload a PDF, Word .docx, or text file.",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Import document</DialogTitle>
          <DialogDescription>
            Upload a PDF, Word .docx, or text file and Donnit will queue task suggestions for approval.
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyClass}>
          <div className="space-y-2">
            <Label htmlFor="document-import-file">Document</Label>
            <Input
              id="document-import-file"
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              data-testid="input-document-import-file"
            />
            <p className="text-xs text-muted-foreground">
              Files are parsed into the approval inbox before anything becomes a task.
            </p>
          </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-document-import-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => upload.mutate()}
            disabled={!file || upload.isPending}
            data-testid="button-document-import-submit"
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            Scan document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
