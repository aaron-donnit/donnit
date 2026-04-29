import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  chatRequestSchema,
  noteRequestSchema,
  taskCreateRequestSchema,
} from "@shared/schema";
import type { InsertTask, Task, User } from "@shared/schema";
import { getIntegrationStatus, scanGmailForTaskCandidates } from "./integrations";
import { storage } from "./storage";

const CURRENT_USER_ID = 1;

const urgencyRank: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDueDate(message: string) {
  const text = message.toLowerCase();
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const year = slashMatch[3]
      ? Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3])
      : new Date().getFullYear();
    return `${year}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }
  if (text.includes("today")) return todayIso();
  if (text.includes("tomorrow")) return addDays(1);
  if (text.includes("next week")) return addDays(7);
  if (text.includes("this week") || text.includes("friday")) return addDays(3);
  return null;
}

function parseUrgency(message: string): "low" | "normal" | "high" | "critical" {
  const text = message.toLowerCase();
  if (/(critical|emergency|blocker|immediately)/.test(text)) return "critical";
  if (/(urgent|asap|high priority|important)/.test(text)) return "high";
  if (/(low priority|whenever|someday)/.test(text)) return "low";
  return "normal";
}

function parseEstimate(message: string) {
  const minutes = message.match(/(\d+)\s*(?:min|mins|minutes)/i);
  if (minutes) return Number(minutes[1]);
  const hours = message.match(/(\d+)\s*(?:hr|hrs|hour|hours)/i);
  if (hours) return Number(hours[1]) * 60;
  return 30;
}

function findAssignee(message: string, users: User[]) {
  const text = message.toLowerCase();
  const explicit = users.find((user) => text.includes(`@${user.name.toLowerCase()}`) || text.includes(user.email.toLowerCase()));
  if (explicit) return explicit;
  const named = users.find((user) => user.id !== CURRENT_USER_ID && text.includes(user.name.toLowerCase()));
  return named ?? users.find((user) => user.id === CURRENT_USER_ID) ?? users[0];
}

function titleFromMessage(message: string) {
  const cleaned = message
    .replace(/\b(today|tomorrow|next week|this week|urgent|asap|critical|high priority|low priority)\b/gi, "")
    .replace(/\bby\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\b\d+\s*(?:min|mins|minutes|hr|hrs|hour|hours)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(add|create|remind me to|please|task to)\s+/i, "")
    .slice(0, 150);
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}

function parseAnnualReminderDays(message: string) {
  const text = message.toLowerCase();
  const days = text.match(/(\d+)\s*days?\s*before/);
  if (days) return Number(days[1]);
  return text.includes("birthday") || text.includes("anniversary") || text.includes("annual") ? 15 : 0;
}

function parseChatTask(message: string, users: User[]): InsertTask {
  const assignee = findAssignee(message, users);
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = reminderDaysBefore > 0 || /annual|birthday|anniversary/i.test(message) ? "annual" : "none";
  const assignedToId = assignee?.id ?? CURRENT_USER_ID;
  const assignedById = CURRENT_USER_ID;
  const title = titleFromMessage(message) || "Untitled task";

  return {
    title,
    description: message,
    status: assignedToId === assignedById ? "open" : "pending_acceptance",
    urgency: parseUrgency(message),
    dueDate: parseDueDate(message),
    estimatedMinutes: parseEstimate(message),
    assignedToId,
    assignedById,
    source: "chat",
    recurrence,
    reminderDaysBefore,
  };
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return (urgencyRank[a.urgency] ?? 2) - (urgencyRank[b.urgency] ?? 2);
  });
}

function buildAgenda(tasks: Task[]) {
  const availableMinutes = 6 * 60;
  let remaining = availableMinutes;
  const candidates = sortTasks(tasks).filter((task) => task.status !== "completed" && task.status !== "denied");

  return candidates
    .filter((task) => {
      if (remaining <= 0) return false;
      remaining -= task.estimatedMinutes;
      return true;
    })
    .map((task, index) => ({
      taskId: task.id,
      order: index + 1,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      dueDate: task.dueDate,
      urgency: task.urgency,
    }));
}

async function bootstrap() {
  const [users, tasks, events, messages, suggestions] = await Promise.all([
    storage.listUsers(),
    storage.listTasks(),
    storage.listEvents(),
    storage.listChatMessages(),
    storage.listEmailSuggestions(),
  ]);

  return {
    currentUserId: CURRENT_USER_ID,
    users,
    tasks: sortTasks(tasks),
    events,
    messages,
    suggestions,
    agenda: buildAgenda(tasks),
    integrations: getIntegrationStatus(),
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/bootstrap", async (_req, res) => {
    res.json(await bootstrap());
  });

  app.post("/api/chat", async (req, res) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Message must be between 2 and 800 characters." });
      return;
    }

    const users = await storage.listUsers();
    const taskInput = parseChatTask(parsed.data.message, users);
    const task = await storage.createTask(taskInput);
    await storage.createChatMessage({ role: "user", content: parsed.data.message, taskId: task.id });
    const assignee = users.find((user) => user.id === task.assignedToId);
    const dueText = task.dueDate ? ` Due ${task.dueDate}.` : "";
    const assignmentText =
      task.status === "pending_acceptance"
        ? ` I asked ${assignee?.name ?? "the assignee"} to accept or deny it.`
        : " It is on your list now.";
    const assistant = await storage.createChatMessage({
      role: "assistant",
      content: `Added “${task.title}” as ${task.urgency} urgency.${dueText}${assignmentText}`,
      taskId: task.id,
    });

    res.status(201).json({ task, assistant });
  });

  app.post("/api/tasks", async (req, res) => {
    const parsed = taskCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Task details are incomplete." });
      return;
    }
    const task = await storage.createTask(parsed.data);
    res.status(201).json(task);
  });

  app.post("/api/tasks/:id/complete", async (req, res) => {
    const id = Number(req.params.id);
    const note = noteRequestSchema.safeParse(req.body);
    const task = await storage.updateTask(id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      completionNotes: note.success ? note.data.note : "",
    });
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({
      taskId: id,
      actorId: CURRENT_USER_ID,
      type: "completed",
      note: note.success ? note.data.note : "Completed without notes.",
    });
    res.json(task);
  });

  app.post("/api/tasks/:id/notes", async (req, res) => {
    const id = Number(req.params.id);
    const note = noteRequestSchema.safeParse(req.body);
    if (!note.success) {
      res.status(400).json({ message: "Note is required." });
      return;
    }
    const task = await storage.updateTask(id, { completionNotes: note.data.note });
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({ taskId: id, actorId: CURRENT_USER_ID, type: "note_added", note: note.data.note });
    res.json(task);
  });

  app.post("/api/tasks/:id/accept", async (req, res) => {
    const id = Number(req.params.id);
    const task = await storage.updateTask(id, { status: "accepted", acceptedAt: new Date().toISOString() });
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({ taskId: id, actorId: CURRENT_USER_ID, type: "accepted", note: "Assignment accepted." });
    res.json(task);
  });

  app.post("/api/tasks/:id/deny", async (req, res) => {
    const id = Number(req.params.id);
    const note = noteRequestSchema.safeParse(req.body);
    const task = await storage.updateTask(id, {
      status: "denied",
      deniedAt: new Date().toISOString(),
      completionNotes: note.success ? note.data.note : "",
    });
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({
      taskId: id,
      actorId: CURRENT_USER_ID,
      type: "denied",
      note: note.success ? note.data.note : "Assignment denied.",
    });
    res.json(task);
  });

  app.post("/api/suggestions/:id/approve", async (req, res) => {
    const result = await storage.approveEmailSuggestion(Number(req.params.id), CURRENT_USER_ID);
    if (!result.suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(result);
  });

  app.post("/api/suggestions/:id/dismiss", async (req, res) => {
    const suggestion = await storage.dismissEmailSuggestion(Number(req.params.id));
    if (!suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(suggestion);
  });

  app.get("/api/agenda", async (_req, res) => {
    const tasks = await storage.listTasks();
    res.json(buildAgenda(tasks));
  });

  app.get("/api/integrations", async (_req, res) => {
    res.json(getIntegrationStatus());
  });

  app.post("/api/integrations/gmail/scan", async (_req, res) => {
    const result = await scanGmailForTaskCandidates();
    if (!result.ok) {
      res.status(424).json(result);
      return;
    }
    const candidates = "candidates" in result && Array.isArray(result.candidates) ? result.candidates : [];
    const created = [];
    const existing = await storage.listEmailSuggestions();
    const existingKeys = new Set(existing.map((item) => `${item.fromEmail}|${item.subject}`));
    for (const candidate of candidates) {
      const key = `${candidate.fromEmail}|${candidate.subject}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const suggestion = await storage.createEmailSuggestion({
        fromEmail: candidate.fromEmail,
        subject: candidate.subject,
        preview: candidate.preview,
        suggestedTitle: candidate.suggestedTitle,
        suggestedDueDate: candidate.suggestedDueDate,
        urgency: candidate.urgency,
        assignedToId: candidate.assignedToId,
      });
      created.push(suggestion);
    }
    res.json({ ok: true, scannedCandidates: candidates.length, createdSuggestions: created.length, suggestions: created });
  });

  return httpServer;
}
