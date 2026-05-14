import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, HelpCircle, Loader2, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateWorkspace } from "@/app/lib/hooks";
import type { ChatMessage } from "@/app/types";

type SlashCommand = {
  command: "memory";
  text: string;
};

export default function ChatPanel({ messages, onSlashCommand }: { messages: ChatMessage[]; onSlashCommand?: (command: SlashCommand) => void }) {
  const [message, setMessage] = useState("");
  const [localAssistantMessage, setLocalAssistantMessage] = useState<ChatMessage | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const parsedPreview = useMemo(() => {
    const rawText = message.trim();
    if (!rawText) return null;
    if (/^\/memory\b/i.test(rawText)) {
      const text = rawText.replace(/^\/memory\b\s*/i, "").trim();
      return {
        title: text || "Create Task Memory workflow",
        urgency: "Workflow",
        due: "Profile",
        recurrence: "Task Memory",
        assignee: "Position Profile",
        isDonnitCommand: false,
        isMemoryCommand: true,
      };
    }
    const isDonnitCommand = /^\/donnit\b/i.test(rawText);
    const text = rawText.replace(/^\/donnit\b\s*/i, "").trim() || rawText;
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
    return { title, urgency, due, recurrence, assignee, isDonnitCommand, isMemoryCommand: false };
  }, [message]);

  const latestPersistedAssistant = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.content.trim()),
    [messages],
  );
  const latestAssistant = localAssistantMessage ?? latestPersistedAssistant;
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
    onSuccess: async (result) => {
      setMessage("");
      if (result.assistant) {
        setLocalAssistantMessage(result.assistant);
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
    if (text.length < 2 || chat.isPending) return;
    const memoryMatch = text.match(/^\/memory\b\s*/i);
    if (memoryMatch) {
      onSlashCommand?.({ command: "memory", text: text.slice(memoryMatch[0].length).trim() });
      setMessage("");
      return;
    }
    chat.mutate(text);
  };
  const isDonnitCommand = /^\/donnit\b/i.test(message.trim());
  const isMemoryCommand = /^\/memory\b/i.test(message.trim());
  const showSlashHelp = message.trim().startsWith("/");

  const chips: Array<[string, string | undefined]> = [
    ["Assignee", parsedPreview?.assignee],
    ["Due", parsedPreview?.due],
    ["Urgency", parsedPreview?.urgency],
    ["Repeat", parsedPreview?.recurrence],
  ];

  return (
    <div className="mb-5" data-testid="panel-chat">
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
          placeholder='Tell Donnit what to do, e.g. "Follow up with Linh on Q1 deck variance by Thursday, urgent", "/memory", or "/donnit prep an update"'
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
            {isMemoryCommand ? "Open memory" : isDonnitCommand ? "Run Donnit" : "Add task"}
          </button>
        </div>
      </div>

      {showSlashHelp && (
        <div className="mt-2 grid gap-2 rounded-md border border-border bg-card p-2 text-sm sm:grid-cols-2" data-testid="chat-slash-command-menu">
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => setMessage("/memory ")}>
            <span className="block font-medium text-foreground">/memory</span>
            <span className="text-xs text-muted-foreground">Create a Task Memory workflow for a Position Profile.</span>
          </button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => setMessage("/donnit ")}>
            <span className="block font-medium text-foreground">/donnit</span>
            <span className="text-xs text-muted-foreground">Assign Donnit AI to review or draft an update.</span>
          </button>
        </div>
      )}

      {latestAssistant && (
        <div
          className={`mt-2 flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm ${
            latestAssistantNeedsReply
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : latestAssistantCreatedTask
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-border bg-card text-foreground"
          }`}
          data-testid="text-chat-latest-response"
        >
          {latestAssistantNeedsReply ? <HelpCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
          <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.07em]">
            {latestAssistantNeedsReply ? "Reply needed" : latestAssistantCreatedTask ? "Task created" : "Donnit"}
          </span>
          <span className="min-w-0 flex-1 truncate">{latestAssistant.content}</span>
        </div>
      )}

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
