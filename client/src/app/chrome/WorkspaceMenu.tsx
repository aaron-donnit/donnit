import { Loader2, Menu, RefreshCcw, ShieldCheck, SlidersHorizontal, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FunctionAction, MenuActionGroup } from "@/app/chrome/FunctionBar";

export default function WorkspaceMenu({
  primaryActions,
  menuGroups,
}: {
  primaryActions: FunctionAction[];
  menuGroups: MenuActionGroup[];
}) {
  const renderItem = (action: FunctionAction) => (
    <DropdownMenuItem
      key={action.id}
      disabled={action.disabled || action.loading}
      onSelect={(event) => {
        if (action.disabled || action.loading) {
          event.preventDefault();
          return;
        }
        action.onClick?.();
      }}
      data-testid={`menu-action-${action.id}`}
    >
      {action.loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <action.icon className="size-4" />
      )}
      <span>{action.label}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open workspace menu" data-testid="button-workspace-menu">
          <Menu className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>All options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ListChecks className="size-4" />
            Daily actions
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {primaryActions.map(renderItem)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {menuGroups.map((group) => (
          <DropdownMenuSub key={group.label}>
            <DropdownMenuSubTrigger>
              {group.label === "Tools sync" ? (
                <RefreshCcw className="size-4" />
              ) : group.label === "Admin" ? (
                <ShieldCheck className="size-4" />
              ) : (
                <SlidersHorizontal className="size-4" />
              )}
              {group.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {group.actions.map(renderItem)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
