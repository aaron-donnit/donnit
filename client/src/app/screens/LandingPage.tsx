import { ArrowRight, BriefcaseBusiness, Check, Sparkles, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import Wordmark from "@/app/chrome/Wordmark";

const demoMailto =
  "mailto:hello@donnit.ai?subject=Book%20a%20Donnit%20demo&body=I%20want%20to%20see%20how%20Donnit%20can%20help%20my%20team.";
const pricingMailto =
  "mailto:hello@donnit.ai?subject=Donnit%20pricing&body=I%20want%20to%20learn%20which%20Donnit%20plan%20fits%20my%20team.";

export default function LandingPage() {
  const goToLogin = () => {
    window.location.hash = "/app";
  };
  const integrations = ["Slack", "Gmail", "Outlook", "Teams", "Calendar", "SMS soon"];
  const proofPoints = ["AI task capture", "Role memory", "Calendar-ready work"];
  const flow = [
    { icon: Sparkles, title: "Capture", copy: "Slack, email, chat, and notes become task suggestions." },
    { icon: UserRoundCheck, title: "Clarify", copy: "Donnit adds owners, deadlines, urgency, and context." },
    { icon: BriefcaseBusiness, title: "Carry Forward", copy: "Recurring work builds a living Position Profile." },
  ];
  const heroSignals = [
    { source: "Email", title: "Vendor renewal attached", meta: "Renew by Friday" },
    { source: "Slack", title: "Jordan needs access", meta: "Send login today" },
    { source: "Recurring", title: "Board packet week", meta: "Prep agenda draft" },
  ];
  const continuitySteps = [
    { title: "Before a move", copy: "Capture the real rhythm of the role while work is happening." },
    { title: "During coverage", copy: "Assign temporary ownership without mixing roles together." },
    { title: "For the next person", copy: "Give them the playbook, not a guessing game." },
  ];
  const dailyTasks = [
    ["Approve suggested renewal task", "AI captured from Gmail", "Today"],
    ["Schedule onboarding access", "Slack request", "45 min"],
    ["Draft transition notes", "Position Profile", "Friday"],
  ];
  const pricingOptions = [
    ["Free trial", "14 days", "One role. One inbox. No card.", "Start free"],
    ["Team pilot", "Guided setup", "Connect tools and prove the handoff workflow.", "Book demo"],
  ] as const;

  return (
    <main className="landing-page min-h-screen bg-background text-foreground" data-testid="page-landing">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <a href="#continuity" className="hover:text-foreground">Role handoffs</a>
            <a href="#integrations" className="hover:text-foreground">Integrations</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToLogin} data-testid="button-landing-login">Login</Button>
            <Button size="sm" onClick={goToLogin} data-testid="button-landing-start-top">Start free</Button>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden px-4 pb-12 pt-16 lg:px-6 lg:pb-18 lg:pt-24">
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="ui-label">AI-powered work continuity</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.02] text-foreground md:text-7xl">
              Work remembered.<span className="block text-brand-green">Handoffs handled.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Donnit turns Slack, email, and notes into tasks, agendas, and role memory.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="landing-primary-cta" onClick={goToLogin} data-testid="button-landing-start">
                Start free<ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="outline" asChild data-testid="button-landing-demo-hero">
                <a href={demoMailto}>Book demo</a>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">14 days. No card. One role to start.</p>
            <div className="landing-proof-strip mt-7">{proofPoints.map((point) => <span key={point}>{point}</span>)}</div>
          </div>
          <div className="landing-product-stage mt-10" aria-label="Donnit turns work inputs into approved tasks and role memory">
            <div className="landing-stage-column">
              <p className="ui-label">Inputs</p>
              <div className="mt-3 space-y-3">
                {heroSignals.map((signal, index) => (
                  <div key={signal.title} className="landing-stage-card" style={{ animationDelay: `${index * 420}ms` }}>
                    <span>{signal.source}</span><strong>{signal.title}</strong><small>{signal.meta}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="landing-ai-core"><Sparkles className="size-6" /><span>AI intake</span></div>
            <div className="landing-stage-column landing-stage-output">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-label">Donnit</p>
                <span className="rounded-full bg-brand-green/10 px-3 py-1 text-xs font-medium text-brand-green">ready</span>
              </div>
              <div className="mt-3 space-y-2">
                {dailyTasks.map(([task, source, time], index) => (
                  <div key={task} className="landing-stage-task" style={{ animationDelay: `${index * 180}ms` }}>
                    <Check className="size-4" /><div><strong>{task}</strong><small>{source}</small></div><span>{time}</span>
                  </div>
                ))}
              </div>
              <div className="landing-memory-pill"><BriefcaseBusiness className="size-4" />Updates Position Profile</div>
            </div>
          </div>
        </div>
      </section>

      <section id="continuity" className="px-4 py-10 lg:px-6 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Role handoffs</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Less scramble. Cleaner starts.</h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">Donnit builds Position Profiles from real work, not stale job descriptions.</p>
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-start">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {continuitySteps.map((step) => (
                <div key={step.title} className="landing-continuity-step rounded-md border border-border bg-card p-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-green text-white"><Check className="size-4" /></span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </div>
              ))}
              <Button asChild className="w-fit sm:col-span-3 lg:col-span-1">
                <a href={demoMailto}>See Position Profile<ArrowRight className="size-4" /></a>
              </Button>
            </div>
            <div className="landing-profile-preview rounded-md border border-border bg-card p-4">
              <p className="ui-label">Position profile</p>
              <h3 className="mt-2 text-xl font-semibold">Executive Assistant to the CEO</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Automatically built from recurring tasks, notes, completions, and handoff context.</p>
              <div className="mt-5 space-y-2">
                {["Weekly board packet prep", "Annual insurance renewal", "CEO travel hold review", "Vendor invoice reconciliation"].map((task, index) => (
                  <div key={task} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
                    <p className="truncate text-sm font-medium">{task}</p>
                    <span className="text-xs text-muted-foreground">{index === 1 ? "Annual" : "Open"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-4 py-10 lg:px-6 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Capture. Clarify. Carry forward.</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {flow.map((item, index) => (
              <div key={item.title} className="landing-flow-step rounded-md border border-border bg-card p-5 text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-brand-green/10 text-brand-green"><item.icon className="size-5" /></div>
                <p className="ui-label mt-5">0{index + 1}</p>
                <h3 className="mt-1 text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-10 lg:px-6 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div className="max-w-xl">
              <p className="ui-label">Daily work</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Your day, already sorted.</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">Type it. Approve it. Schedule it. Donnit keeps the context close.</p>
            </div>
            <div className="landing-daily-preview rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-label">Today</p>
                <span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">AI agenda ready</span>
              </div>
              <div className="mt-4 space-y-2">
                {dailyTasks.map(([task, source, time]) => (
                  <div key={task} className="grid gap-2 rounded-md bg-background px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div><p className="text-sm font-medium">{task}</p><p className="mt-1 text-xs text-muted-foreground">{source}</p></div>
                    <span className="text-xs text-muted-foreground">{time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="integrations" className="px-4 py-10 lg:px-6 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Works where work starts</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Slack, email, and calendar first. SMS next.</h2>
          </div>
          <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
            {integrations.map((name) => (
              <div key={name} className="rounded-md border border-border bg-card px-4 py-4 text-center text-sm font-medium">{name}</div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="px-4 py-10 lg:px-6 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Start small. Prove value.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Begin with one role or one team. Expand when the workflow is working.</p>
          </div>
          <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
            {pricingOptions.map(([name, price, copy, cta]) => (
              <div key={name} className="landing-pricing-card rounded-md border border-border bg-card p-5">
                <p className="ui-label">{name}</p>
                <h3 className="mt-3 text-2xl font-semibold">{price}</h3>
                <p className="mt-3 min-h-12 text-muted-foreground">{copy}</p>
                {cta === "Start free" ? (
                  <Button className="mt-5" onClick={goToLogin}>{cta}</Button>
                ) : (
                  <Button className="mt-5" variant="outline" asChild><a href={demoMailto}>{cta}</a></Button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Need procurement details or a larger rollout?{" "}
            <a href={pricingMailto} className="text-foreground underline underline-offset-4">See pricing options</a>.
          </p>
        </div>
      </section>

      <section className="px-4 py-14 lg:px-6 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <p className="ui-label">Get started</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Try Donnit with one role.</h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="landing-primary-cta" onClick={goToLogin}>Start free</Button>
            <Button size="lg" variant="outline" asChild><a href={demoMailto}>Book demo</a></Button>
          </div>
        </div>
      </section>

      <footer className="landing-footer border-t border-border px-4 py-8 lg:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <Wordmark />
          <div className="flex flex-wrap gap-4">
            <a href="mailto:hello@donnit.ai" className="hover:text-foreground">Contact</a>
            <a href="mailto:hello@donnit.ai?subject=Donnit%20privacy%20request" className="hover:text-foreground">Privacy</a>
            <a href="mailto:hello@donnit.ai?subject=Donnit%20terms%20request" className="hover:text-foreground">Terms</a>
            <button type="button" onClick={goToLogin} className="hover:text-foreground">Login</button>
          </div>
        </div>
      </footer>
    </main>
  );
}
