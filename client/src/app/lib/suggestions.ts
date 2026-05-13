import { EMAIL_SIGNATURE_TEMPLATES, EMAIL_SIGNATURE_TEMPLATE_KEY, EMAIL_SIGNATURE_CUSTOM_KEY } from "@/app/constants";

export function formatReceivedAt(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value.slice(0, 24);
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function parseSuggestionInsight(actionItems: string[]) {
  const take = (prefix: string) => {
    const found = actionItems.find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));
    return found ? found.slice(prefix.length).trim() : null;
  };
  const metaPrefixes = [
    "Why Donnit suggested this:",
    "Confidence:",
    "Estimated time:",
    "Source excerpt:",
  ];
  return {
    why: take("Why Donnit suggested this:"),
    confidence: take("Confidence:"),
    estimate: take("Estimated time:"),
    excerpt: take("Source excerpt:"),
    nextSteps: actionItems.filter(
      (item) => !metaPrefixes.some((prefix) => item.toLowerCase().startsWith(prefix.toLowerCase())),
    ),
  };
}

export function readCustomEmailSignature() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(EMAIL_SIGNATURE_CUSTOM_KEY) ?? "";
}

export function readPreferredEmailSignatureTemplate() {
  if (typeof window === "undefined") return "best";
  return window.localStorage.getItem(EMAIL_SIGNATURE_TEMPLATE_KEY) ?? (readCustomEmailSignature().trim() ? "custom" : "best");
}

export function resolveEmailSignature(templateId: string, customSignature: string) {
  if (templateId === "custom") return customSignature;
  return EMAIL_SIGNATURE_TEMPLATES.find((item) => item.id === templateId)?.body ?? "";
}

export function applyEmailSignature(message: string, signature: string) {
  const cleanMessage = message
    .replace(/\n{2,}(best regards|best|thanks|thank you|regards|sincerely),?\s*(?:\n[\w\s.,&'-]{1,120}){0,4}\s*$/i, "")
    .trimEnd();
  if (!signature.trim()) return cleanMessage;
  return `${cleanMessage}\n\n${signature.trim()}`;
}
