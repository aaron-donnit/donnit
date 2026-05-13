export default function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="ui-label">{label}</p>
      <p className="display-font mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
