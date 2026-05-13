import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type OnboardingStep = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
};

export default function OnboardingChecklist({
  steps,
  onDismiss,
}: {
  steps: OnboardingStep[];
  onDismiss: () => void;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1];
  return (
    <section className="mb-4 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4" data-testid="panel-onboarding-checklist">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-brand-green text-white">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="display-font text-base font-bold text-foreground">Start strong</p>
              <p className="text-sm text-muted-foreground">
                Get Donnit to first value: capture work, approve it, schedule it, and preserve role memory.
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
                  step.done ? "border-brand-green/40 bg-background" : "border-border bg-card"
                }`}
                data-testid={`button-onboarding-${step.id}`}
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
        <div className="shrink-0 rounded-md border border-border bg-background p-3 xl:w-56">
          <p className="ui-label">Setup progress</p>
          <p className="display-font mt-1 text-2xl font-bold text-foreground">
            {doneCount}/{steps.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {doneCount === steps.length ? "Ready for a pilot workflow." : `Next: ${nextStep?.title ?? "Keep going"}`}
          </p>
          <div className="mt-3 flex gap-2">
            {nextStep && !nextStep.done ? (
              <Button size="sm" onClick={nextStep.onAction} data-testid="button-onboarding-next">
                {nextStep.actionLabel}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDismiss} data-testid="button-onboarding-dismiss">
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
