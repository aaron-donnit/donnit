import { useState } from "react";
import { Check } from "lucide-react";
import type { User, AppView } from "@/app/types";
import Wordmark from "@/app/chrome/Wordmark";

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
      items: group.ids.map((id) => items.find((item) => item.id === id)).filter(Boolean) as typeof items,
    }))
    .filter((group) => group.items.length > 0);
  const renderButton = (item: (typeof items)[number], compact = false) => {
    const Icon = item.icon;
    const active = view === item.id;
    const showLabel = compact || expanded;
    return (
      <button
        key={item.id}
        type="button"
        title={item.label}
        disabled={item.disabled}
        onClick={() => onViewChange(item.id)}
        className={`relative flex min-w-0 items-center rounded-md py-2 text-sm font-medium transition ${
          active
            ? "bg-brand-green text-white shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        } ${compact ? "h-9 shrink-0 gap-2 px-3" : expanded ? "w-full gap-2 px-3" : "mx-auto size-10 justify-center px-0"} disabled:pointer-events-none disabled:opacity-40`}
        data-testid={`button-app-nav-${item.id}`}
      >
        <Icon className="size-4 shrink-0" />
        {showLabel && <span className="truncate">{item.label}</span>}
        {item.count ? (
          <span
            className={`${
              showLabel ? "ml-auto" : "absolute -right-1 -top-1"
            } rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-white/20 text-white" : "bg-background text-muted-foreground"}`}
          >
            {item.count > 99 ? "99+" : item.count}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <aside
        className={`hidden shrink-0 border-r border-border bg-muted/20 px-3 py-4 transition-[width] duration-200 ease-out lg:flex lg:min-h-screen lg:flex-col ${
          expanded ? "w-[220px]" : "w-14"
        }`}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
        }}
        aria-label="Donnit navigation"
      >
        <div className={`mb-5 flex min-h-10 items-center ${expanded ? "justify-start px-1" : "justify-center"}`}>
          {expanded ? (
            <div>
              <Wordmark onClick={() => onViewChange("home")} />
              <p className="mt-2 text-xs text-muted-foreground">Work continuity command center</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onViewChange("home")}
              className="flex size-10 items-center justify-center rounded-md border border-brand-green/30 bg-brand-green text-white shadow-sm"
              aria-label="Home"
              data-testid="button-app-nav-logo-collapsed"
            >
              <Check className="size-5" />
            </button>
          )}
        </div>
        <nav className="space-y-2" aria-label="Donnit navigation">
          {groups.map((group, index) => (
            <div key={group.label} className={index > 0 ? "border-t border-border pt-2" : ""}>
              {expanded && (
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">{group.items.map((item) => renderButton(item))}</div>
            </div>
          ))}
        </nav>
        {expanded ? (
          <div className="mt-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{currentUser?.name ?? "Donnit user"}</p>
            <p className="mt-0.5 capitalize">{currentUser?.role ?? "member"}</p>
          </div>
        ) : (
          <div className="mt-auto flex justify-center">
            <div className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-foreground" title={currentUser?.name ?? "Donnit user"}>
              {(currentUser?.name ?? "D").slice(0, 1).toUpperCase()}
            </div>
          </div>
        )}
      </aside>
      <div className="border-b border-border bg-background px-3 py-2 lg:hidden">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Wordmark onClick={() => onViewChange("home")} />
          <span className="text-xs text-muted-foreground capitalize">{currentUser?.role ?? "member"}</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Donnit mobile navigation">
          {items.map((item) => renderButton(item, true))}
        </nav>
      </div>
    </>
  );
}
