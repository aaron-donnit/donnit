import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DerivedNotification } from "@/app/lib/notifications";

export default function NotificationCenter({
  notifications,
  onReviewed,
  onOpenNotification,
}: {
  notifications: DerivedNotification[];
  onReviewed: (ids: string[]) => void;
  onOpenNotification: (notification: DerivedNotification) => void;
}) {
  const highCount = notifications.filter((item) => item.severity === "high").length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open notifications" data-testid="button-notifications">
          <span className="relative inline-flex">
            <Bell className="size-4" />
            {notifications.length > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[10px] font-bold text-white">
                {notifications.length}
              </span>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>
          Notifications{highCount > 0 ? ` - ${highCount} urgent` : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <DropdownMenuItem disabled>No task alerts right now.</DropdownMenuItem>
        ) : (
          notifications.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="items-start gap-2"
              onClick={() => {
                onReviewed([item.id]);
                onOpenNotification(item);
              }}
              data-testid={`notification-item-${item.id}`}
            >
              <span
                className={`mt-1 size-2 shrink-0 rounded-full ${
                  item.severity === "high"
                    ? "bg-destructive"
                    : item.severity === "normal"
                      ? "bg-brand-green"
                      : "bg-muted-foreground"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
              </span>
            </DropdownMenuItem>
          ))
        )}
        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onReviewed(notifications.map((item) => item.id))}>
              <Check className="size-4" />
              Clear reviewed
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
