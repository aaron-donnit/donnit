import { useRef } from "react";
import { Bold, List, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type RichNoteEditorProps = {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  testId?: string;
  disabled?: boolean;
};

export default function RichNoteEditor({
  id,
  label,
  value,
  onChange,
  placeholder,
  className,
  maxLength,
  testId,
  disabled = false,
}: RichNoteEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const updateSelection = (next: string, start: number, end = start) => {
    onChange(next);
    window.requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(start, end);
    });
  };
  const insertText = (before: string, after = "") => {
    const el = ref.current;
    if (!el) {
      onChange(`${value}${before}${after}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    updateSelection(next, start + before.length, start + before.length + selected.length);
  };
  const prefixLines = (prefixer: (index: number) => string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = value.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const nextBlock = lines
      .map((line, index) => {
        const stripped = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "");
        return stripped.trim().length === 0 ? line : `${prefixer(index)}${stripped}`;
      })
      .join("\n");
    const next = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
    updateSelection(next, lineStart, lineStart + nextBlock.length);
  };
  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => insertText("**", "**")} disabled={disabled}>
          <Bold className="size-3.5" />
          Bold
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => prefixLines(() => "- ")} disabled={disabled}>
          <List className="size-3.5" />
          Bullets
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => prefixLines((index) => `${index + 1}. `)} disabled={disabled}>
          <ListOrdered className="size-3.5" />
          Numbered
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => insertText("\n\n")} disabled={disabled}>
          Space
        </Button>
      </div>
      <Textarea
        ref={ref}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={className}
        maxLength={maxLength}
        disabled={disabled}
        data-testid={testId}
      />
    </div>
  );
}
