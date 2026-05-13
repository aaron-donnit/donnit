import { useEffect, useRef } from "react";
import { Bold, Italic, Link, List, ListOrdered, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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

const htmlPattern = /<\/?[a-z][\s\S]*>/i;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function valueToHtml(value: string) {
  if (!value) return "";
  if (htmlPattern.test(value)) return value;
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeEditorLinks(root: HTMLElement) {
  root.querySelectorAll("a").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href) anchor.setAttribute("href", normalizeUrl(href));
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer");
  });
}

function isEffectivelyEmpty(root: HTMLElement | null) {
  if (!root) return true;
  return (root.textContent ?? "").trim().length === 0 && root.querySelectorAll("img, a").length === 0;
}

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
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = valueToHtml(value);
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
      normalizeEditorLinks(editor);
    }
  }, [value]);

  const syncValue = () => {
    const editor = editorRef.current;
    if (!editor) return;
    normalizeEditorLinks(editor);
    onChange(isEffectivelyEmpty(editor) ? "" : editor.innerHTML);
  };

  const focusEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
  };

  const runCommand = (command: string, argument?: string) => {
    if (disabled) return;
    focusEditor();
    document.execCommand(command, false, argument);
    syncValue();
  };

  const addLink = () => {
    if (disabled) return;
    const rawUrl = window.prompt("Paste a link");
    const url = normalizeUrl(rawUrl ?? "");
    if (!url) return;
    focusEditor();
    const selection = window.getSelection();
    if (!selection || selection.toString().trim().length === 0) {
      document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    } else {
      document.execCommand("createLink", false, url);
    }
    syncValue();
  };

  const insertPlainText = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentLength = (editor.textContent ?? "").length;
    const nextText = typeof maxLength === "number" ? text.slice(0, Math.max(0, maxLength - currentLength)) : text;
    if (!nextText) return;
    document.execCommand("insertText", false, nextText);
    syncValue();
  };

  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => runCommand("bold")} disabled={disabled}>
          <Bold className="size-3.5" />
          Bold
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => runCommand("italic")} disabled={disabled}>
          <Italic className="size-3.5" />
          Italic
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => runCommand("underline")} disabled={disabled}>
          <Underline className="size-3.5" />
          Underline
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => runCommand("insertUnorderedList")} disabled={disabled}>
          <List className="size-3.5" />
          Bullets
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => runCommand("insertOrderedList")} disabled={disabled}>
          <ListOrdered className="size-3.5" />
          Numbered
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={addLink} disabled={disabled}>
          <Link className="size-3.5" />
          Link
        </Button>
      </div>
      <div className="relative">
        <div
          ref={editorRef}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={syncValue}
          onBlur={syncValue}
          onPaste={(event) => {
            event.preventDefault();
            insertPlainText(event.clipboardData.getData("text/plain"));
          }}
          className={cn(
            "min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
            "[&_a]:text-brand-green [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_li]:my-1 [&_p]:my-1",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
          data-testid={testId}
        />
        {placeholder && value.trim().length === 0 && (
          <span className="pointer-events-none absolute left-3 top-2 text-sm leading-6 text-muted-foreground">{placeholder}</span>
        )}
      </div>
    </div>
  );
}
