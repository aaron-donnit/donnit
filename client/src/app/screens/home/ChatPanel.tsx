import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, HelpCircle, Loader2, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateWorkspace } from "@/app/lib/hooks";
import type { ChatMessage, Id, PositionProfile, User } from "@/app/types";

type SlashCommand = {
  command: "memory";
  text: string;
};

type SlashCommandOption = {
  id: "memory" | "donnit";
  label: string;
  description: string;
  insertText: string;
};

const slashCommands: SlashCommandOption[] = [
  {
    id: "donnit",
    label: "/donnit",
    description: "Assign Donnit AI to review or draft an update.",
    insertText: "/donnit ",
  },
  {
    id: "memory",
    label: "/memory",
    description: "Create a Task Memory workflow for a Position Profile.",
    insertText: "/memory ",
  },
];

const SLASH_USAGE_KEY = "donnit.slashCommandUsage";

type MentionOption = {
  id: Id;
  name: string;
  email: string;
  profileTitle: string;
};

type MentionTrigger = {
  start: number;
  end: number;
  query: string;
};

function findMentionTrigger(value: string, cursorPosition: number): MentionTrigger | null {
  const beforeCursor = value.slice(0, cursorPosition);
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;
  return {
    start: atIndex,
    end: cursorPosition,
    query: match[1] ?? "",
  };
}

function profileTitlesForUser(userId: Id, positionProfiles: PositionProfile[]) {
  const titles = positionProfiles
    .filter((profile) =>
      profile.status !== "vacant" &&
      [profile.currentOwnerId, profile.temporaryOwnerId, profile.delegateUserId]
        .filter(Boolean)
        .some((ownerId) => String(ownerId) === String(userId)),
    )
    .map((profile) => profile.title)
    .filter(Boolean);
  return Array.from(new Set(titles)).join(", ");
}

export default function ChatPanel({
  messages,
  users = [],
  positionProfiles = [],
  onSlashCommand,
}: {
  messages: ChatMessage[];
  users?: User[];
  positionProfiles?: PositionProfile[];
  onSlashCommand?: (command: SlashCommand) => void;
}) {
  const [message, setMessage] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [localAssistantMessage, setLocalAssistantMessage] = useState<ChatMessage | null>(null);
  const [responseExpanded, setResponseExpanded] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [slashUsage, setSlashUsage] = useState<Record<string, number>>(() => {
    try {
      if (typeof window === "undefined") return {};
      return JSON.parse(window.localStorage.getItem(SLASH_USAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionOptions = useMemo<MentionOption[]>(
    () =>
      users
        .filter((user) => user.status !== "inactive")
        .map((user) => ({
          id: user.id,
          name: user.name || user.email,
          email: user.email,
          profileTitle: profileTitlesForUser(user.id, positionProfiles) || user.role || "No Position Profile",
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [positionProfiles, users],
  );
  const mentionTrigger = useMemo(() => {
    const boundedCursor = Math.max(0, Math.min(cursorPosition || message.length, message.length));
    return findMentionTrigger(message, boundedCursor) ?? findMentionTrigger(message, message.length);
  }, [cursorPosition, message]);
  const visibleMentionOptions = useMemo(() => {
    if (!mentionTrigger) return [];
    const query = mentionTrigger.query.toLowerCase();
    return mentionOptions
      .filter((option) => {
        if (!query) return true;
        return (
          option.name.toLowerCase().includes(query) ||
          option.email.toLowerCase().includes(query) ||
          option.profileTitle.toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [mentionOptions, mentionTrigger]);
  const showMentionHelp = Boolean(mentionTrigger && !mentionDismissed);

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

  useEffect(() => {
    if (latestAssistant?.id) setResponseExpanded(true);
  }, [latestAssistant?.id]);

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

  const recordSlashUse = (id: SlashCommandOption["id"]) => {
    setSlashUsage((current) => {
      const next = { ...current, [id]: (current[id] ?? 0) + 1 };
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(SLASH_USAGE_KEY, JSON.stringify(next));
      } catch {
        // Local ordering is a convenience only.
      }
      return next;
    });
  };

  const send = () => {
    const text = message.trim();
    if (text.length < 2 || chat.isPending) return;
    const memoryMatch = text.match(/^\/memory\b\s*/i);
    if (memoryMatch) {
      recordSlashUse("memory");
      onSlashCommand?.({ command: "memory", text: text.slice(memoryMatch[0].length).trim() });
      setMessage("");
      return;
    }
    if (/^\/donnit\b/i.test(text)) recordSlashUse("donnit");
    chat.mutate(text);
  };
  const isDonnitCommand = /^\/donnit\b/i.test(message.trim());
  const isMemoryCommand = /^\/memory\b/i.test(message.trim());
  const showSlashHelp = message.trim().startsWith("/");
  const slashQuery = showSlashHelp ? message.trim().replace(/^\//, "").split(/\s+/)[0].toLowerCase() : "";
  const visibleSlashCommands = slashCommands
    .filter((command) => command.id.includes(slashQuery) || command.label.toLowerCase().includes(slashQuery))
    .sort((a, b) => {
      const usageDelta = (slashUsage[b.id] ?? 0) - (slashUsage[a.id] ?? 0);
      if (usageDelta !== 0) return usageDelta;
      return a.label.localeCompare(b.label);
    });

  const chips: Array<[string, string | undefined]> = [
    ["Assignee", parsedPreview?.assignee],
    ["Due", parsedPreview?.due],
    ["Urgency", parsedPreview?.urgency],
    ["Repeat", parsedPreview?.recurrence],
  ];

  const updateMessage = (value: string, nextCursorPosition?: number) => {
    setMessage(value);
    setCursorPosition(nextCursorPosition ?? value.length);
    setMentionDismissed(false);
    setMentionIndex(0);
  };

  const insertMention = (option: MentionOption) => {
    if (!mentionTrigger) return;
    const inserted = `@${option.name} `;
    const next = `${message.slice(0, mentionTrigger.start)}${inserted}${message.slice(mentionTrigger.end)}`;
    const nextCursorPosition = mentionTrigger.start + inserted.length;
    updateMessage(next, nextCursorPosition);
    window.setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    }, 0);
  };

  return (
    <div className="mb-5" data-testid="panel-chat">
      <div className="composer-box">
        <textarea
          id="chat-message"
          ref={taRef}
          value={message}
          rows={2}
          onChange={(e) => updateMessage(e.target.value, e.target.selectionStart)}
          onClick={(e) => setCursorPosition(e.currentTarget.selectionStart)}
          onFocus={(e) => setCursorPosition(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCursorPosition(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (showMentionHelp && visibleMentionOptions.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((current) => (current + 1) % visibleMentionOptions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((current) => (current - 1 + visibleMentionOptions.length) % visibleMentionOptions.length);
                return;
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                insertMention(visibleMentionOptions[mentionIndex] ?? visibleMentionOptions[0]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionDismissed(true);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder='Tell Donnit what to do, e.g. "Assign @Nina Patel the renewal by Thursday", "/memory", or "/donnit prep an update"'
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

      {showMentionHelp && (
        <div className="mt-2 rounded-md border border-border bg-card p-2 text-sm shadow-sm" data-testid="chat-mention-menu">
          <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <span>People</span>
            <span>{mentionTrigger?.query ? "Matching workspace" : "A-Z"}</span>
          </div>
          <div className="grid gap-1">
            {visibleMentionOptions.length === 0 && (
              <div className="rounded-md px-3 py-2 text-xs text-muted-foreground">
                No matching people in this workspace.
              </div>
            )}
            {visibleMentionOptions.map((option, index) => (
              <button
                key={String(option.id)}
                type="button"
                className={`rounded-md px-3 py-2 text-left ${index === mentionIndex ? "bg-muted" : "hover:bg-muted"}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(option);
                }}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{option.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{option.profileTitle}</span>
                </span>
                <span className="text-xs text-muted-foreground">{option.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showSlashHelp && (
        <div className="mt-2 rounded-md border border-border bg-card p-2 text-sm shadow-sm" data-testid="chat-slash-command-menu">
          <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <span>Commands</span>
            <span>{Object.values(slashUsage).some(Boolean) ? "Most used first" : "A-Z"}</span>
          </div>
          <div className="grid gap-1">
            {visibleSlashCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                className="rounded-md px-3 py-2 text-left hover:bg-muted"
                onClick={() => {
                  setMessage(command.insertText);
                  window.setTimeout(() => taRef.current?.focus(), 0);
                }}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{command.label}</span>
                  {(slashUsage[command.id] ?? 0) > 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{slashUsage[command.id]}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{command.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {latestAssistant && (
        <div
          className={`mt-2 flex min-h-10 gap-2 rounded-md border px-3 py-2 text-sm ${
            latestAssistantNeedsReply
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : latestAssistantCreatedTask
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-border bg-card text-foreground"
          } ${responseExpanded ? "items-start" : "items-center"}`}
          data-testid="text-chat-latest-response"
        >
          {latestAssistantNeedsReply ? <HelpCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.07em]">
            {latestAssistantNeedsReply ? "Reply needed" : latestAssistantCreatedTask ? "Task created" : "Donnit"}
          </span>
          <span className={`min-w-0 flex-1 ${responseExpanded ? "whitespace-pre-wrap break-words" : "truncate"}`}>
            {latestAssistant.content}
          </span>
          <button
            type="button"
            onClick={() => setResponseExpanded((current) => !current)}
            className="rounded p-0.5 text-current opacity-70 transition hover:bg-black/5 hover:opacity-100"
            aria-label={responseExpanded ? "Collapse Donnit response" : "Expand Donnit response"}
          >
            {responseExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
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
