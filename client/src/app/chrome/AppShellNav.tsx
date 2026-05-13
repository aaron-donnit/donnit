import { useState } from "react";
import type { User, AppView } from "@/app/types";

export default function AppShellNav({
  view,
  onViewChange,
  items,
  currentUser,
}: {
  view: AppView;
  onViewChange: (view: AppView) => void;
  items: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }>; count?: number; disabled?: boolean }>;
  currentUser: User | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const groups = [
    { label: "Work", ids: ["home", "tasks", "agenda", "inbox"] as AppView[] },
    { label: "People", ids: ["team", "profiles", "reports"] as AppView[] },
    { label: "Workspace", ids: ["admin", "settings"] as AppView[] },
  ]
    .map((group) => ({
      ...group,
      items: group.ids
        .map((id) => items.find((item) => item.id === id))
        .filter(Boolean) as typeof items,
    }))
    .filter((group) => group.items.length > 0);

  const initials = (currentUser?.name ?? "D")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      {/* Desktop rail — collapses to icon-only, expands to 220px on hover */}
      <aside
        className={`hidden shrink-0 border-r border-border bg-muted/20 transition-[width] duration-[140ms] ease-out lg:flex lg:min-h-screen lg:flex-col ${
          expanded ? "w-[220px]" : "w-14"
        }`}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false);
        }}
        aria-label="Donnit navigation"
        data-testid="nav-rail"
      >
        {/* Brand mark */}
        <button
          type="button"
          onClick={() => onViewChange("home")}
          aria-label="Home"
          data-testid="button-app-nav-logo"
          className={`flex shrink-0 items-center gap-2.5 border-b border-border px-3.5 transition-[height] duration-[140ms] ${
            expanded ? "h-11 justify-start" : "h-11 justify-center"
          }`}
        >
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-brand-green text-white font-mono text-[11px] font-bold leading-none">
            dn
          </span>
          {expanded && (
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              donnit
            </span>
          )}
        </button>

        {/* Nav groups */}
        <nav className="flex flex-1 flex-col overflow-hidden py-2" aria-label="Donnit navigation">
          {groups.map((group, gIdx) => (
            <div key={group.label} className={gIdx > 0 ? "mt-1 border-t border-border pt-1" : ""}>
              {/* Section label — fades in when rail is open */}
              <p
                className={`px-3.5 pb-0.5 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground transition-opacity duration-[140ms] ${
                  expanded ? "opacity-100" : "opacity-0"
                }`}
              >
                {group.label}
              </p>

              {group.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    disabled={item.disabled}
                    onClick={() => onViewChange(item.id)}
                    className={`relative flex h-[30px] w-full min-w-0 items-center gap-2.5 px-2.5 text-[13px] font-medium transition-colors duration-[140ms] disabled:pointer-events-none disabled:opacity-40 ${
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                    data-testid={`button-app-nav-${item.id}`}
                  >
                    {/* Active accent stripe (left edge) */}
                    {active && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-brand-green" />
                    )}

                    {/* Icon */}
                    <span
                      className={`flex size-[22px] shrink-0 items-center justify-center rounded-[4px] ${
                        active ? "bg-brand-green text-white" : ""
                      }`}
                    >
                      <Icon className="size-[14px]" />
                    </span>

                    {/* Label — fades in with rail */}
                    <span
                      className={`flex-1 truncate text-left transition-opacity duration-[140ms] ${
                        expanded ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      {item.label}
                    </span>

                    {/* Count badge */}
                    {item.count ? (
                      <span
                        className={`font-mono text-[10px] tabular-nums transition-opacity duration-[140ms] ${
                          expanded ? "opacity-100" : "opacity-0"
                        } ${
                          active
                            ? "text-brand-green"
                            : "text-muted-foreground"
                        }`}
                      >
                        {item.count > 99 ? "99+" : item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User foot */}
        <div className="shrink-0 border-t border-border p-2">
          <div
            className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/50 ${
              expanded ? "justify-start" : "justify-center"
            }`}
            title={currentUser?.name ?? "Donnit user"}
          >
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-brand-green/15 font-mono text-[10px] font-bold text-brand-green">
              {initials}
            </span>
            {expanded && (
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {currentUser?.name ?? "Donnit user"}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="border-b border-border bg-background px-3 py-2 lg:hidden">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-brand-green font-mono text-[11px] font-bold text-white">
              dn
            </span>
            <span className="text-sm font-semibold tracking-tight">donnit</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground capitalize">
            {currentUser?.role ?? "member"}
          </span>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto pb-1" aria-label="Donnit mobile navigation">
          {items.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                disabled={item.disabled}
                onClick={() => onViewChange(item.id)}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                  active
                    ? "bg-brand-green text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`button-app-nav-${item.id}`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}
