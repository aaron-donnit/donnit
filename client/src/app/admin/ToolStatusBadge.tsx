export default function ToolStatusBadge({ status, label: customLabel }: { status: "ready" | "warning" | "setup"; label?: string }) {
  const label = customLabel ?? (status === "ready" ? "Ready" : status === "warning" ? "Needs attention" : "Setup");
  const classes =
    status === "ready"
      ? "border-brand-green/30 bg-brand-green/10 text-brand-green"
      : status === "warning"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}
