import { Loader2, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FunctionAction = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  loading?: boolean;
  primary?: boolean;
  disabled?: boolean;
  hint?: string;
};

export type MenuActionGroup = {
  label: string;
  actions: FunctionAction[];
};

export function FunctionActionButton({ action }: { action: FunctionAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled || action.loading}
      title={action.hint ?? action.label}
      className={`fn-chip ${action.primary ? "fn-primary" : ""}`}
      data-testid={`button-fn-${action.id}`}
    >
      {action.loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <action.icon className="size-4" />
      )}
      <span>{action.label}</span>
    </button>
  );
}

export default function FunctionBar({
  addTaskActions,
  primaryActions,
}: {
  addTaskActions: FunctionAction[];
  primaryActions: FunctionAction[];
}) {
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
      data-testid="bar-functions"
      role="toolbar"
      aria-label="Workspace functions"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="button-add-task-menu">
            <ListPlus className="size-4" />
            Add task
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Add task from</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {addTaskActions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled || action.loading}
              onClick={action.onClick}
              data-testid={`menu-add-task-${action.id}`}
            >
              {action.loading ? <Loader2 className="size-4 animate-spin" /> : <action.icon className="size-4" />}
              <span>{action.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {primaryActions.map((action) => (
        <FunctionActionButton key={action.id} action={action} />
      ))}
    </div>
  );
}
