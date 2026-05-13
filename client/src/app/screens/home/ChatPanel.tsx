import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateWorkspace } from "@/app/lib/hooks";
import type { ChatMessage } from "@/app/types";

export default function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  const [message, setMessage] = useState("");
  const historyRef = useRef<HTMLDivElement | null>(null);
  const parsedPreview = useMemo(() => {
    const text = message.trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    const urgency = /asap|urgent|critical|emergency|immediately|today|now/.test(lower)
      ? "High"
      : /not urgent|low priority|whenever|someday/.test(lower)
        ? "Low"
        : /important|high priority|priority/.test(lower)
          ? "High"
          : "Normal";
    const due =
      /\beow\b|end of week/.test(lower)
        ? "End of week"
        : /\beom\b|end of month/.test(lower)
          ? "End of month"
          : /\btomorrow\b/.test(lower)
            ? "Tomorrow"
            : /\btoday\b/.test(lower)
              ? "Today"
              : lower.match(/\b(mon|monday)\b/)
                ? "Monday"
                : lower.match(/\b(tue|tuesday)\b/)
                  ? "Tuesday"
                  : lower.match(/\b(wed|wednesday)\b/)
                    ? "Wednesday"
                    : lower.match(/\b(thu|thursday)\b/)
                      ? "Thursday"
                      : lower.match(/\b(fri|friday)\b/)
                        ? "Friday"
                        : "Due date";
    const recurrence = /recurr|repeat|every|weekly|monthly|quarterly|annually|daily/.test(lower)
      ? "Recurring"
      : "One-time";
    const assigneeMatch = text.match(/\b(?:assign|send|give)\s+([A-Z][a-z]+)\b/) ?? text.match(/@([A-Za-z]+)/);
    const assignee = assigneeMatch?.[1] ?? (/for me|i need|myself|me to/i.test(text) ? "Me" : "Assignee");
    const title = text
      .replace(/@\w+/g, "")
      .replace(/\b(assign|send|give)\s+[A-Z][a-z]+\s+(to|a task to)?/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return { title, urgency, due, recurrence, assignee };
  }, [message]);
  const chat = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/chat", { message }),
    onSuccess: async () => {
      setMessage("");
      await invalidateWorkspace();
    },
    onError: (error: unknown) => {
      toast({
        title: "Chat could not send",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });
  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      className="panel command-chat-panel flex h-[min(420px,calc(100dvh-9rem))] min-h-[320px] flex-col lg:h-full lg:min-h-0"
      data-testid="panel-chat"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-green" />
          <h2 className="display-font text-base font-bold leading-none">Chat to task</h2>
        </div>
        <span className="ui-label">AI parser</span>
      </div>

      <div
        ref={historyRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
        data-testid="panel-chat-history"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <p className="display-font text-lg font-bold text-foreground">
              Tell Donnit what's on your plate.
            </p>
            <p className="mt-2 max-w-xs text-sm">
              One sentence with the task, due date, and who owns it. Donnit handles the rest.
            </p>
            <p className="mt-4 max-w-xs rounded-md bg-muted px-3 py-2 text-xs">
              "Add urgent payroll reset for Jordan tomorrow, 45 min."
            </p>
          </div>
        ) : (
          messages.map((item) => (
            <div
              key={item.id}
              className={`max-w-[88%] rounded-md px-3 py-2 text-sm leading-relaxed ${
                item.role === "assistant"
                  ? "bg-muted text-foreground"
                  : "ml-auto bg-brand-green text-white"
              }`}
              data-testid={`text-chat-message-${item.id}`}
            >
              {item.content}
            </div>
          ))
        )}
      </div>

      {parsedPreview && (
        <div className="composer-preview mx-4 mb-3">
          <span className="ui-label">Donnit understood</span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{parsedPreview.title}</span>
        </div>
      )}

      <div className="shrink-0 border-t border-border px-4 py-3">
        <Label htmlFor="chat-message" className="ui-label mb-1.5 block">
          New entry
        </Label>
        <Textarea
          id="chat-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add spouse birthday for 2026-05-30, remind me 15 days before."
          rows={3}
          className="h-24 max-h-24 min-h-0 resize-none overflow-y-auto focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (message.trim().length >= 2 && !chat.isPending) chat.mutate();
            }
          }}
          data-testid="input-chat-message"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            ["Assignee", parsedPreview?.assignee],
            ["Due", parsedPreview?.due],
            ["Urgency", parsedPreview?.urgency],
            ["Repeat", parsedPreview?.recurrence],
          ].map(([label, value]) => (
            <span key={label} className={`composer-chip ${parsedPreview && value !== label ? "is-set" : ""}`}>
              {label}: {value ?? label}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Enter to send · Shift + Enter for a new line</span>
          <Button
            onClick={() => chat.mutate()}
            disabled={message.trim().length < 2 || chat.isPending}
            data-testid="button-send-chat"
          >
            {chat.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
