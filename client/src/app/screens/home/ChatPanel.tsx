import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, HelpCircle, Loader2, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateWorkspace } from "@/app/lib/hooks";
import type { ChatMessage } from "@/app/types";

export default function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  const [message, setMessage] = useState("");
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

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
      /\beow\b|end of week/.test(lower) ? "End of week"
      : /\beom\b|end of month/.test(lower) ? "End of month"
      : /\btomorrow\b/.test(lower) ? "Tomorrow"
      : /\btoday\b/.test(lower) ? "Today"
      : lower.match(/\b(mon|monday)\b/) ? "Monday"
      : lower.match(/\b(tue|tuesday)\b/) ? "Tuesday"
      : lower.match(/\b(wed|wednesday)\b/) ? "Wednesday"
      : lower.match(/\b(thu|thursday)\b/) ? "Thursday"
      : lower.match(/\b(fri|friday)\b/) ? "Friday"
      : "Due date";
    const recurrence = /recurr|repeat|every|weekly|monthly|quarterly|annually|daily/.test(lower)
      ? "Recurring" : "One-time";
    const assigneeMatch = text.match(/\b(?:assign|send|give)\s+([A-Z][a-z]+)\b/) ?? text.match(/@([A-Za-z]+)/);
    const assignee = assigneeMatch?.[1] ?? (/for me|i need|myself|me to/i.test(text) ? "Me" : "Assignee");
    const title = text
      .replace(/@\w+/g, "")
      .replace(/\b(assign|send|give)\s+[A-Z][a-z]+\s+(to|a task to)?/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return { title, urgency, due, recurrence, assignee };
  }, [message]);

  const visibleMessages = useMemo(() => {
    const official = messages.filter((item) => item.role !== "system");
    const officialKeys = new Set(official.map((item) => `${item.role}:${item.content}`));
    const transient = localMessages.filter((item) => {
      if (!String(item.id).startsWith("local-")) return !official.some((officialItem) => String(officialItem.id) === String(item.id));
      return !officialKeys.has(`${item.role}:${item.content}`);
    });
    return [...official, ...transient]
      .filter((item) => {
        if (!item.content.trim()) return false;
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-8);
  }, [localMessages, messages]);

  const latestAssistant = [...visibleMessages].reverse().find((item) => item.role === "assistant");
  const latestAssistantNeedsReply = Boolean(
    latestAssistant?.content &&
      (latestAssistant.content.includes("?") || /which|who should|when is|what should|how urgent/i.test(latestAssistant.content)),
  );
  const latestAssistantCreatedTask = Boolean(latestAssistant?.taskId || /^I assigned\b/i.test(latestAssistant?.content ?? ""));

  const chat = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/chat", { message: text });
      return await response.json() as { assistant?: ChatMessage; pending?: boolean; task?: unknown };
    },
    onMutate: (text) => {
      setLocalMessages((current) => [
        ...current,
        {
          id: `local-user-${Date.now()}`,
          role: "user",
          content: text,
          taskId: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    onSuccess: async (result) => {
      setMessage("");
      if (result.assistant) {
        setLocalMessages((current) => [...current, result.assistant!]);
        if (result.task) {
          toast({
            title: "Task created",
            description: result.assistant.content,
          });
        }
      }
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

  const send = () => {
    const text = message.trim();
    if (text.length >= 2 && !chat.isPending) chat.mutate(text);
  };

  const chips: Array<[string, string | undefined]> = [
    ["Assignee", parsedPreview?.assignee],
    ["Due", parsedPreview?.due],
    ["Urgency", parsedPreview?.urgency],
    ["Repeat", parsedPreview?.recurrence],
  ];

  return (
    <div className="mb-5" data-testid="panel-chat">
      {visibleMessages.length > 0 && (
        <div className="mb-3 rounded-md border border-border bg-card p-2.5 shadow-sm" data-testid="panel-visible-chat-thread">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="ui-label">Chat to task</span>
            {latestAssistant && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                  latestAssistantNeedsReply
                    ? "bg-amber-50 text-amber-800"
                    : latestAssistantCreatedTask
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-muted text-muted-foreground"
                }`}
                data-testid="text-chat-latest-status"
              >
                {latestAssistantNeedsReply ? <HelpCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
                {latestAssistantNeedsReply ? "Reply needed" : latestAssistantCreatedTask ? "Task created" : "Updated"}
              </span>
            )}
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {visibleMessages.map((item) => {
              const fromAssistant = item.role === "assistant";
              return (
                <div
                  key={item.id}
                  className={`flex ${fromAssistant ? "justify-start" : "justify-end"}`}
                  data-testid={`text-chat-message-${item.id}`}
                >
                  <div
                    className={`max-w-[88%] rounded-md border px-3 py-2 text-sm leading-relaxed ${
                      fromAssistant
                        ? "border-border bg-background text-foreground"
                        : "border-brand-green/20 bg-brand-green/10 text-foreground"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                        {fromAssistant ? "Donnit" : "You"}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{item.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="composer-box">
        <textarea
          id="chat-message"
          ref={taRef}
          value={message}
          rows={2}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder='Tell Donnit what to do, e.g. "Follow up with Linh on Q1 deck variance by Thursday, urgent"'
          className="composer-input"
          data-testid="input-chat-message"
        />
        <div className="composer-bar">
          {chips.map(([label, value]) => {
            const isSet = Boolean(parsedPreview && value && value !== label);
            return (
              <span key={label} className={`composer-chip${isSet ? " is-set" : ""}`}>
                {isSet ? value : label}
              </span>
            );
          })}
          <span className="flex-1" />
          <span className="composer-kbd">Enter</span>
          <button
            type="button"
            onClick={send}
            disabled={message.trim().length < 2 || chat.isPending}
            className={`composer-send${message.trim().length < 2 || chat.isPending ? " is-disabled" : ""}`}
            data-testid="button-send-chat"
          >
            {chat.isPending
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Send className="size-3.5" />
            }
            Add task
          </button>
        </div>
      </div>

      {parsedPreview && (
        <div className="parse-preview mt-3">
          <span className="parse-preview-label">Donnit understood</span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{parsedPreview.title}</span>
          <span className="composer-kbd ml-2">Shift+Enter for line break</span>
        </div>
      )}

    </div>
  );
}
