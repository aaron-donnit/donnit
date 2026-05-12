import { Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStep } from "@/app/screens/home/OnboardingChecklist";

export default function MvpReadinessPanel({
  steps,
  onDismiss,
}: {
  steps: OnboardingStep[];
  onDismiss: () => void;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);
  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4" data-testid="panel-mvp-readiness">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-foreground text-background">
              <ShieldCheck className="size-4" />
            </span>
            <div>
              <p className="display-font text-base font-bold text-foreground">Thursday MVP readiness</p>
              <p className="text-sm leading-6 text-muted-foreground">
                Demo path for HR/Ops leaders, people managers, and team leads: task capture, Slack approval, agenda planning, and role continuity.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {steps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={step.onAction}
                className={`rounded-md border p-3 text-left transition hover:border-brand-green/70 ${
                  step.done ? "border-brand-green/40 bg-brand-green/5" : "border-border bg-background"
                }`}
                data-testid={`button-mvp-readiness-${step.id}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="ui-label">{step.actionLabel}</span>
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full border ${
                      step.done ? "border-brand-green bg-brand-green text-white" : "border-border text-muted-foreground"
                    }`}
                  >
                    {step.done ? <Check className="size-3" /> : null}
                  </span>
                </div>
                <p className="text-sm font-semibold leading-snug text-foreground">{step.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0 rounded-md border border-border bg-background p-3 xl:w-60">
          <p className="ui-label">Demo confidence</p>
          <p className="display-font mt-1 text-2xl font-bold text-foreground">
            {doneCount}/{steps.length}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {doneCount === steps.length
              ? "Ready to run the seeded MVP story."
              : `Next: ${nextStep?.title ?? "Finish setup"}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {nextStep && !nextStep.done ? (
              <Button size="sm" onClick={nextStep.onAction} data-testid="button-mvp-readiness-next">
                {nextStep.actionLabel}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDismiss} data-testid="button-mvp-readiness-dismiss">
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
