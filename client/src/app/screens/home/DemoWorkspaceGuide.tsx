import { BarChart3, BriefcaseBusiness, Inbox, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmailSuggestion, PositionProfile, Task, User } from "@/app/types";

export default function DemoWorkspaceGuide({
  users,
  tasks,
  suggestions,
  positionProfiles,
  onOpenTeam,
  onOpenApprovals,
  onOpenReports,
  onOpenPositionProfiles,
  onDismiss,
}: {
  users: User[];
  tasks: Task[];
  suggestions: EmailSuggestion[];
  positionProfiles: PositionProfile[];
  onOpenTeam: () => void;
  onOpenApprovals: () => void;
  onOpenReports: () => void;
  onOpenPositionProfiles: () => void;
  onDismiss: () => void;
}) {
  const demoUsers = users.filter((user) => String(user.email ?? "").endsWith("@example.invalid"));
  const demoTasks = tasks.filter((task) =>
    [
      "Confirm Friday client coverage plan",
      "Follow up on ACME renewal blockers",
      "Reconcile ChatGPT expense receipt",
      "Review payroll access request from Gmail",
    ].includes(task.title),
  );
  const pendingApprovals = suggestions.filter((suggestion) => suggestion.status === "pending").length;
  const slackItems =
    tasks.filter((task) => task.source === "slack").length +
    suggestions.filter((suggestion) => suggestion.fromEmail.toLowerCase().startsWith("slack:")).length;
  const demoProfiles = positionProfiles.filter((profile) =>
    ["Operations Manager", "Client Success Specialist", "Finance Coordinator"].includes(profile.title),
  );
  const walkthrough = [
    {
      label: "1. Slack becomes work",
      detail: "Open Approvals and review the #people-ops onboarding coverage suggestion.",
      action: onOpenApprovals,
      icon: Inbox,
    },
    {
      label: "2. Manager sees load",
      detail: "Open Team to show overdue, assigned, completed, and update-request context.",
      action: onOpenTeam,
      icon: Users,
    },
    {
      label: "3. Report the workflow",
      detail: "Open Reports to show source mix, completion rate, and continuity signals.",
      action: onOpenReports,
      icon: BarChart3,
    },
    {
      label: "4. Handoff the role",
      detail: "Open Profiles, choose Client Success Specialist, then show the handoff packet.",
      action: onOpenPositionProfiles,
      icon: BriefcaseBusiness,
    },
  ];
  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4" data-testid="panel-demo-workspace-guide">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-green text-white">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="display-font text-base font-bold text-foreground">Demo workspace</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Demo data has been added to this workspace. Use these views to walk through the buyer story: team visibility, approval review, reporting, and role continuity.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-2 py-1">{demoUsers.length} sample members</span>
                <span className="rounded-md bg-muted px-2 py-1">{demoTasks.length || tasks.length} demo tasks</span>
                <span className="rounded-md bg-muted px-2 py-1">{pendingApprovals} pending approvals</span>
                <span className="rounded-md bg-muted px-2 py-1">{demoProfiles.length} demo profiles</span>
                <span className="rounded-md bg-muted px-2 py-1">{slackItems} Slack-origin items</span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {walkthrough.map((step) => (
              <button
                key={step.label}
                type="button"
                onClick={step.action}
                className="rounded-md border border-border bg-background px-3 py-3 text-left transition hover:border-brand-green/70 hover:bg-muted/40"
                data-testid={`button-demo-step-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <step.icon className="size-4 text-brand-green" />
                  <p className="text-xs font-semibold text-foreground">{step.label}</p>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{step.detail}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onOpenTeam} data-testid="button-demo-open-team">
            <Users className="size-4" />
            Team
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenApprovals} data-testid="button-demo-open-approvals">
            <Inbox className="size-4" />
            Approvals
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenReports} data-testid="button-demo-open-reports">
            <BarChart3 className="size-4" />
            Reports
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenPositionProfiles} data-testid="button-demo-open-profiles">
            <BriefcaseBusiness className="size-4" />
            Profiles
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss} data-testid="button-demo-guide-dismiss">
            Dismiss
          </Button>
        </div>
      </div>
    </section>
  );
}
