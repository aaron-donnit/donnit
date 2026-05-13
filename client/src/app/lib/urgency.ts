import type { UrgencyClass } from "@/app/types";

export function urgencyClass(urgency: string): UrgencyClass {
  if (urgency === "critical" || urgency === "high") return "urgency-high";
  if (urgency === "normal" || urgency === "medium") return "urgency-medium";
  return "urgency-low";
}

export function urgencyLabel(urgency: string) {
  if (urgency === "critical") return "Overdue";
  if (urgency === "high") return "High";
  if (urgency === "normal" || urgency === "medium") return "Medium";
  return "Low";
}

export const statusLabels: Record<string, string> = {
  open: "Open",
  pending_acceptance: "Needs acceptance",
  accepted: "Accepted",
  denied: "Denied",
  completed: "Done",
};
