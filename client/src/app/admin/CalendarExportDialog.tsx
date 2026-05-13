import { CalendarCheck, CalendarPlus, ExternalLink, Loader2, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { AgendaItem } from "@/app/types";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import type { GmailOAuthStatus } from "@/app/admin/WorkspaceSettingsDialog";

export default function CalendarExportDialog({
  open,
  onOpenChange,
  agenda,
  oauthStatus,
  onDownload,
  onExportGoogle,
  onReconnectGoogle,
  isExportingGoogle,
  isReconnectingGoogle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agenda: AgendaItem[];
  oauthStatus?: GmailOAuthStatus;
  onDownload: () => void;
  onExportGoogle: () => void;
  onReconnectGoogle: () => void;
  isExportingGoogle: boolean;
  isReconnectingGoogle: boolean;
}) {
  const calendarReady = Boolean(oauthStatus?.connected && oauthStatus.calendarConnected);
  const needsCalendarReconnect = Boolean(oauthStatus?.connected && oauthStatus.calendarRequiresReconnect);
  const scheduledCount = agenda.filter((item) => item.startAt && item.endAt && item.scheduleStatus === "scheduled").length;
  const unscheduledCount = Math.max(agenda.length - scheduledCount, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Calendar export</DialogTitle>
          <DialogDescription>
            {scheduledCount > 0
              ? `${scheduledCount} scheduled agenda block${scheduledCount === 1 ? "" : "s"} ready${unscheduledCount ? `, ${unscheduledCount} still needs time` : ""}.`
              : "Build an agenda before exporting."}
          </DialogDescription>
        </DialogHeader>
        <div className={`${dialogBodyClass} space-y-3`}>
          {unscheduledCount > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Only scheduled blocks are exported. Rebuild the agenda after connecting Google Calendar or widening the workday if tasks still need a slot.
            </div>
          )}
          <div className="rounded-md border border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Google Calendar</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {calendarReady
                    ? oauthStatus?.email ?? "Connected"
                    : needsCalendarReconnect
                      ? "Reconnect Google to enable direct calendar sync."
                      : "Connect Google before direct calendar sync."}
                </p>
              </div>
              <span className="ui-label">
                {calendarReady ? "Ready" : needsCalendarReconnect ? "Reconnect" : "Not connected"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={onExportGoogle}
                disabled={!calendarReady || scheduledCount === 0 || isExportingGoogle}
                data-testid="button-google-calendar-export"
              >
                {isExportingGoogle ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                Add to Google Calendar
              </Button>
              {!calendarReady && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReconnectGoogle}
                  disabled={isReconnectingGoogle}
                  data-testid="button-google-calendar-reconnect"
                >
                  {isReconnectingGoogle ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
                  {needsCalendarReconnect ? "Reconnect Google" : "Connect Google"}
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-md border border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Calendar file</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Downloads an .ics file; your computer chooses which calendar app opens it.
                </p>
              </div>
              <CalendarPlus className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                disabled={scheduledCount === 0}
                data-testid="button-download-calendar-file"
              >
                <CalendarPlus className="size-4" />
                Download .ics
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://calendar.google.com/calendar/u/0/r/settings/export"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-google-calendar-import"
                >
                  <ExternalLink className="size-4" />
                  Open Google Calendar
                </a>
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
