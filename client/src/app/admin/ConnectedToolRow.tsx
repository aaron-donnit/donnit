import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";
import ToolStatusBadge from "@/app/admin/ToolStatusBadge";

export default function ConnectedToolRow({
  icon: Icon,
  name,
  detail,
  status,
  actionLabel,
  action,
  loading,
  disabled,
  secondaryActionLabel,
  secondaryAction,
  secondaryLoading,
  secondaryDisabled,
}: {
  icon: typeof Inbox;
  name: string;
  detail: string;
  status: "ready" | "warning" | "setup";
  actionLabel: string;
  action: () => void;
  loading?: boolean;
  disabled?: boolean;
  secondaryActionLabel?: string;
  secondaryAction?: () => void;
  secondaryLoading?: boolean;
  secondaryDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{name}</p>
            <ToolStatusBadge status={status} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {secondaryAction && secondaryActionLabel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={secondaryAction}
            disabled={secondaryDisabled || secondaryLoading}
            data-testid={`button-tool-${name.toLowerCase().replace(/\s+/g, "-")}-secondary`}
          >
            {secondaryLoading ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            {secondaryActionLabel}
          </Button>
        )}
        <Button
          type="button"
          variant={status === "ready" ? "outline" : "default"}
          size="sm"
          onClick={action}
          disabled={disabled || loading}
          data-testid={`button-tool-${name.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
