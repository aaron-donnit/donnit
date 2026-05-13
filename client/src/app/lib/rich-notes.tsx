import { cn } from "@/lib/utils";

const htmlPattern = /<\/?[a-z][\s\S]*>/i;

export function isRichNote(value: string) {
  return htmlPattern.test(value);
}

export function richNoteToPlainText(value: string) {
  if (!value) return "";
  if (!isRichNote(value)) return value;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeRichNote(value: string) {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/href=(["'])javascript:[^"']*\1/gi, 'href="#"');
}

export function RichNoteContent({ note, className }: { note: string; className?: string }) {
  if (!note) return null;
  if (!isRichNote(note)) {
    return <p className={cn("whitespace-pre-wrap", className)}>{note}</p>;
  }
  return (
    <div
      className={cn(
        "whitespace-normal [&_a]:text-brand-green [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: sanitizeRichNote(note) }}
    />
  );
}
