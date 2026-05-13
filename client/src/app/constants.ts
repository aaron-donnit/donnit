import type { AgendaPreferences, AgendaSchedule } from "@/app/types";

export const DEFAULT_AGENDA_PREFERENCES: AgendaPreferences = {
  workdayStart: "09:00",
  workdayEnd: "17:00",
  lunchStart: "12:00",
  lunchMinutes: 30,
  meetingBufferMinutes: 10,
  minimumBlockMinutes: 15,
  focusBlockMinutes: 90,
  morningPreference: "deep_work",
  afternoonPreference: "communications",
};

export const DEFAULT_AGENDA_SCHEDULE: AgendaSchedule = {
  autoBuildEnabled: false,
  buildTime: "07:30",
  lastAutoBuildDate: null,
};

export const CLIENT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

export const dialogShellClass =
  "flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0";
export const dialogHeaderClass = "shrink-0 border-b border-border px-5 py-4 pr-12";
export const dialogBodyClass = "min-h-0 flex-1 overflow-y-auto px-5 py-4";
export const dialogFooterClass = "shrink-0 border-t border-border px-5 py-3";
export const REPEAT_DETAILS_PREFIX = "Repeat details:";

export const EMAIL_SIGNATURE_TEMPLATES = [
  { id: "none", label: "No signature", body: "" },
  { id: "custom", label: "Custom signature", body: "" },
  { id: "best", label: "Best", body: "Best," },
  { id: "thanks", label: "Thanks", body: "Thanks," },
  { id: "donnit", label: "Donnit", body: "Best,\nDonnit" },
  { id: "followup", label: "Follow-up", body: "Thanks,\nI will follow up shortly." },
];

export const EMAIL_SIGNATURE_TEMPLATE_KEY = "donnit.emailSignatureTemplate";
export const EMAIL_SIGNATURE_CUSTOM_KEY = "donnit.emailSignatureCustom";
