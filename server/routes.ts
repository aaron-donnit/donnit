import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import {
  chatRequestSchema,
  noteRequestSchema,
  taskCreateRequestSchema,
} from "@shared/schema";
import type { InsertTask, Task, User } from "@shared/schema";
import { getIntegrationStatus, scanGmailForTaskCandidates } from "./integrations";
import { storage } from "./storage";
import { attachSupabaseAuth, requireDonnitAuth } from "./auth-supabase";
import { DonnitStore, type DonnitTask } from "./donnit-store";
import { isSupabaseConfigured } from "./supabase";

const DEMO_USER_ID = 1;

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
  const named = users.find((user) => user.id !== DEMO_USER_ID && text.includes(user.name.toLowerCase()));
  return named ?? users.find((user) => user.id === DEMO_USER_ID) ?? users[0];
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
  const assignedToId = assignee?.id ?? DEMO_USER_ID;
  const assignedById = DEMO_USER_ID;
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

type AgendaItem = {
  taskId: string | number;
  order: number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  urgency: string;
};

function buildAgenda(tasks: Task[]): AgendaItem[] {
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

// ---------------------------------------------------------------------------
// Supabase-backed bootstrap (authenticated path)
// ---------------------------------------------------------------------------

type SupabaseTaskShape = ReturnType<typeof toClientTask>;

function toClientTask(task: DonnitTask) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    urgency: task.urgency,
    dueDate: task.due_date,
    estimatedMinutes: task.estimated_minutes,
    assignedToId: task.assigned_to,
    assignedById: task.assigned_by,
    source: task.source,
    recurrence: task.recurrence,
    reminderDaysBefore: task.reminder_days_before,
    acceptedAt: task.accepted_at,
    deniedAt: task.denied_at,
    completedAt: task.completed_at,
    completionNotes: task.completion_notes,
    createdAt: task.created_at,
  };
}

function sortClientTasks<T extends { dueDate: string | null; urgency: string; status: string }>(tasks: T[]): T[] {
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

function buildClientAgenda(tasks: SupabaseTaskShape[]): AgendaItem[] {
  const availableMinutes = 6 * 60;
  let remaining = availableMinutes;
  const candidates = sortClientTasks(tasks).filter((task) => task.status !== "completed" && task.status !== "denied");
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

async function buildAuthenticatedBootstrap(req: Request) {
  const auth = req.donnitAuth!;
  const store = new DonnitStore(auth.client, auth.userId);
  const profile = await store.getProfile();
  if (!profile?.default_org_id) {
    return {
      authenticated: true,
      bootstrapped: false,
      currentUserId: auth.userId,
      email: auth.email,
      integrations: getIntegrationStatus(),
    };
  }
  const orgId = profile.default_org_id;
  const [members, tasks, events, messages, suggestions] = await Promise.all([
    store.listOrgMembers(orgId),
    store.listTasks(orgId),
    store.listEvents(orgId),
    store.listChatMessages(orgId),
    store.listEmailSuggestions(orgId),
  ]);
  const users = members.map((m) => ({
    id: m.user_id,
    name: m.profile?.full_name || m.profile?.email || "Member",
    email: m.profile?.email ?? "",
    role: m.role,
    persona: m.profile?.persona ?? "operator",
    managerId: m.manager_id,
    canAssign: m.can_assign,
  }));
  const clientTasks = sortClientTasks(tasks.map(toClientTask));
  return {
    authenticated: true,
    bootstrapped: true,
    currentUserId: auth.userId,
    email: auth.email,
    orgId,
    users,
    tasks: clientTasks,
    events: events.map((event) => ({
      id: event.id,
      taskId: event.task_id,
      actorId: event.actor_id,
      type: event.type,
      note: event.note,
      createdAt: event.created_at,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      taskId: m.task_id,
      createdAt: m.created_at,
    })),
    suggestions: suggestions.map((s) => ({
      id: s.id,
      fromEmail: s.from_email,
      subject: s.subject,
      preview: s.preview,
      suggestedTitle: s.suggested_title,
      suggestedDueDate: s.suggested_due_date,
      urgency: s.urgency,
      status: s.status,
      assignedToId: s.assigned_to,
      createdAt: s.created_at,
    })),
    agenda: buildClientAgenda(clientTasks),
    integrations: getIntegrationStatus(),
  };
}

async function buildDemoBootstrap() {
  const [users, tasks, events, messages, suggestions] = await Promise.all([
    storage.listUsers(),
    storage.listTasks(),
    storage.listEvents(),
    storage.listChatMessages(),
    storage.listEmailSuggestions(),
  ]);

  return {
    authenticated: false,
    bootstrapped: true,
    currentUserId: DEMO_USER_ID,
    users,
    tasks: sortTasks(tasks),
    events,
    messages,
    suggestions,
    agenda: buildAgenda(tasks),
    integrations: getIntegrationStatus(),
  };
}

// Authenticated chat task parsing — operates on the donnit profile model
// (uuid ids) instead of the demo numeric id model.
function parseChatTaskAuthenticated(
  message: string,
  members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>>,
  selfId: string,
) {
  const text = message.toLowerCase();
  const explicit = members.find((m) => {
    const name = (m.profile?.full_name ?? "").toLowerCase();
    const email = (m.profile?.email ?? "").toLowerCase();
    if (!name && !email) return false;
    return (name && (text.includes(`@${name}`) || text.includes(name))) || (email && text.includes(email));
  });
  const assignee = explicit ?? members.find((m) => m.user_id === selfId) ?? members[0];
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = reminderDaysBefore > 0 || /annual|birthday|anniversary/i.test(message) ? "annual" : "none";
  const assignedToId = assignee?.user_id ?? selfId;
  const title = titleFromMessage(message) || "Untitled task";
  return {
    title,
    description: message,
    status: assignedToId === selfId ? "open" : "pending_acceptance",
    urgency: parseUrgency(message),
    dueDate: parseDueDate(message),
    estimatedMinutes: parseEstimate(message),
    assignedToId,
    assignedById: selfId,
    source: "chat" as const,
    recurrence: recurrence as "none" | "annual",
    reminderDaysBefore,
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/api", attachSupabaseAuth);

  // ------------------------------------------------------------------
  // Public + auth utility
  // ------------------------------------------------------------------
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      res.json({ supabase: false, authenticated: false });
      return;
    }
    if (!req.donnitAuth) {
      res.json({ supabase: true, authenticated: false });
      return;
    }
    const store = new DonnitStore(req.donnitAuth.client, req.donnitAuth.userId);
    const profile = await store.getProfile();
    res.json({
      supabase: true,
      authenticated: true,
      userId: req.donnitAuth.userId,
      email: req.donnitAuth.email,
      bootstrapped: Boolean(profile?.default_org_id),
      profile: profile
        ? {
            id: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            defaultOrgId: profile.default_org_id,
            persona: profile.persona,
          }
        : null,
    });
  });

  app.post("/api/auth/bootstrap", requireDonnitAuth, async (req: Request, res: Response) => {
    const auth = req.donnitAuth!;
    const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.slice(0, 200) : "";
    const orgName = typeof req.body?.orgName === "string" ? req.body.orgName.slice(0, 200) : "";
    const store = new DonnitStore(auth.client, auth.userId);
    try {
      const result = await store.bootstrapWorkspace({
        fullName,
        email: auth.email ?? undefined,
        orgName,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  // ------------------------------------------------------------------
  // Bootstrap — branches on auth state
  // ------------------------------------------------------------------
  app.get("/api/bootstrap", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const data = await buildAuthenticatedBootstrap(req);
        res.json(data);
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    res.json(await buildDemoBootstrap());
  });

  // ------------------------------------------------------------------
  // Chat
  // ------------------------------------------------------------------
  app.post("/api/chat", async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Message must be between 2 and 800 characters." });
      return;
    }

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const profile = await store.getProfile();
        if (!profile?.default_org_id) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const orgId = profile.default_org_id;
        const members = await store.listOrgMembers(orgId);
        const taskInput = parseChatTaskAuthenticated(parsed.data.message, members, auth.userId);
        const created = await store.createTask(orgId, {
          title: taskInput.title,
          description: taskInput.description,
          status: taskInput.status as DonnitTask["status"],
          urgency: taskInput.urgency,
          due_date: taskInput.dueDate,
          estimated_minutes: taskInput.estimatedMinutes,
          assigned_to: taskInput.assignedToId,
          assigned_by: taskInput.assignedById,
          source: taskInput.source,
          recurrence: taskInput.recurrence,
          reminder_days_before: taskInput.reminderDaysBefore,
        });
        await store.createChatMessage(orgId, { role: "user", content: parsed.data.message, task_id: created.id });
        const assignee = members.find((m) => m.user_id === created.assigned_to);
        const dueText = created.due_date ? ` Due ${created.due_date}.` : "";
        const assignmentText =
          created.status === "pending_acceptance"
            ? ` I asked ${assignee?.profile?.full_name ?? "the assignee"} to accept or deny it.`
            : " It is on your list now.";
        const assistant = await store.createChatMessage(orgId, {
          role: "assistant",
          content: `Added “${created.title}” as ${created.urgency} urgency.${dueText}${assignmentText}`,
          task_id: created.id,
        });
        res.status(201).json({ task: toClientTask(created), assistant });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
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

  // ------------------------------------------------------------------
  // Tasks
  // ------------------------------------------------------------------
  app.post("/api/tasks", async (req: Request, res: Response) => {
    const parsed = taskCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Task details are incomplete." });
      return;
    }
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const data = parsed.data;
        const created = await store.createTask(orgId, {
          title: data.title,
          description: data.description ?? "",
          status: data.status as DonnitTask["status"],
          urgency: data.urgency,
          due_date: data.dueDate ?? null,
          estimated_minutes: data.estimatedMinutes ?? 30,
          assigned_to: typeof data.assignedToId === "string" ? data.assignedToId : auth.userId,
          assigned_by: typeof data.assignedById === "string" ? data.assignedById : auth.userId,
          source: data.source,
          recurrence: data.recurrence,
          reminder_days_before: data.reminderDaysBefore ?? 0,
        });
        res.status(201).json(toClientTask(created));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const task = await storage.createTask(parsed.data);
    res.status(201).json(task);
  });

  async function handleTaskAction(
    req: Request,
    res: Response,
    action: "complete" | "accept" | "deny" | "note",
  ) {
    const note = noteRequestSchema.safeParse(req.body);

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const taskId = String(req.params.id);
        const existing = await store.getTask(taskId);
        if (!existing) {
          res.status(404).json({ message: "Task not found." });
          return;
        }
        let patch: Partial<DonnitTask> = {};
        let eventType = "";
        let eventNote = "";
        switch (action) {
          case "complete":
            patch = {
              status: "completed",
              completed_at: new Date().toISOString(),
              completion_notes: note.success ? note.data.note : "",
            };
            eventType = "completed";
            eventNote = note.success ? note.data.note : "Completed without notes.";
            break;
          case "accept":
            patch = { status: "accepted", accepted_at: new Date().toISOString() };
            eventType = "accepted";
            eventNote = "Assignment accepted.";
            break;
          case "deny":
            patch = {
              status: "denied",
              denied_at: new Date().toISOString(),
              completion_notes: note.success ? note.data.note : "",
            };
            eventType = "denied";
            eventNote = note.success ? note.data.note : "Assignment denied.";
            break;
          case "note":
            if (!note.success) {
              res.status(400).json({ message: "Note is required." });
              return;
            }
            patch = { completion_notes: note.data.note };
            eventType = "note_added";
            eventNote = note.data.note;
            break;
        }
        const updated = await store.updateTask(taskId, patch);
        if (!updated) {
          res.status(404).json({ message: "Task not found." });
          return;
        }
        await store.addEvent(updated.org_id, {
          task_id: updated.id,
          actor_id: auth.userId,
          type: eventType,
          note: eventNote,
        });
        res.json(toClientTask(updated));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    let patch: Partial<Task> = {};
    let eventType = "";
    let eventNote = "";
    switch (action) {
      case "complete":
        patch = {
          status: "completed",
          completedAt: new Date().toISOString(),
          completionNotes: note.success ? note.data.note : "",
        };
        eventType = "completed";
        eventNote = note.success ? note.data.note : "Completed without notes.";
        break;
      case "accept":
        patch = { status: "accepted", acceptedAt: new Date().toISOString() };
        eventType = "accepted";
        eventNote = "Assignment accepted.";
        break;
      case "deny":
        patch = {
          status: "denied",
          deniedAt: new Date().toISOString(),
          completionNotes: note.success ? note.data.note : "",
        };
        eventType = "denied";
        eventNote = note.success ? note.data.note : "Assignment denied.";
        break;
      case "note":
        if (!note.success) {
          res.status(400).json({ message: "Note is required." });
          return;
        }
        patch = { completionNotes: note.data.note };
        eventType = "note_added";
        eventNote = note.data.note;
        break;
    }
    const task = await storage.updateTask(id, patch);
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({ taskId: id, actorId: DEMO_USER_ID, type: eventType, note: eventNote });
    res.json(task);
  }

  app.post("/api/tasks/:id/complete", (req, res) => handleTaskAction(req, res, "complete"));
  app.post("/api/tasks/:id/notes", (req, res) => handleTaskAction(req, res, "note"));
  app.post("/api/tasks/:id/accept", (req, res) => handleTaskAction(req, res, "accept"));
  app.post("/api/tasks/:id/deny", (req, res) => handleTaskAction(req, res, "deny"));

  // ------------------------------------------------------------------
  // Email suggestions
  // ------------------------------------------------------------------
  app.post("/api/suggestions/:id/approve", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const suggestion = await store.getEmailSuggestion(String(req.params.id));
        if (!suggestion) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }
        const updated = await store.updateEmailSuggestion(suggestion.id, { status: "approved" });
        const assignedTo = suggestion.assigned_to ?? auth.userId;
        const task = await store.createTask(suggestion.org_id, {
          title: suggestion.suggested_title,
          description: `${suggestion.subject}\n\n${suggestion.preview}`,
          status: assignedTo === auth.userId ? "open" : "pending_acceptance",
          urgency: suggestion.urgency,
          due_date: suggestion.suggested_due_date,
          estimated_minutes: suggestion.urgency === "high" ? 45 : 30,
          assigned_to: assignedTo,
          assigned_by: auth.userId,
          source: "email",
          recurrence: "none",
          reminder_days_before: 0,
        });
        await store.addEvent(suggestion.org_id, {
          task_id: task.id,
          actor_id: auth.userId,
          type: "email_approved",
          note: `Approved task suggestion from ${suggestion.from_email}.`,
        });
        res.json({ suggestion: updated, task: toClientTask(task) });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const result = await storage.approveEmailSuggestion(Number(req.params.id), DEMO_USER_ID);
    if (!result.suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(result);
  });

  app.post("/api/suggestions/:id/dismiss", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const updated = await store.updateEmailSuggestion(String(req.params.id), { status: "dismissed" });
        if (!updated) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }
        res.json(updated);
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const suggestion = await storage.dismissEmailSuggestion(Number(req.params.id));
    if (!suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(suggestion);
  });

  // ------------------------------------------------------------------
  // Agenda + integrations
  // ------------------------------------------------------------------
  app.get("/api/agenda", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.json([]);
          return;
        }
        const tasks = await store.listTasks(orgId);
        res.json(buildClientAgenda(tasks.map(toClientTask)));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const tasks = await storage.listTasks();
    res.json(buildAgenda(tasks));
  });

  app.get("/api/integrations", async (_req: Request, res: Response) => {
    res.json(getIntegrationStatus());
  });

  app.post("/api/integrations/gmail/scan", async (req: Request, res: Response) => {
    const result = await scanGmailForTaskCandidates();
    if (!result.ok) {
      res.status(424).json(result);
      return;
    }
    const candidates = "candidates" in result && Array.isArray(result.candidates) ? result.candidates : [];

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const existing = await store.listEmailSuggestions(orgId);
        const existingKeys = new Set(existing.map((item) => `${item.from_email}|${item.subject}`));
        const created = [];
        for (const candidate of candidates) {
          const key = `${candidate.fromEmail}|${candidate.subject}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          const suggestion = await store.createEmailSuggestion(orgId, {
            gmail_message_id: candidate.gmailMessageId ?? null,
            from_email: candidate.fromEmail,
            subject: candidate.subject,
            preview: candidate.preview,
            suggested_title: candidate.suggestedTitle,
            suggested_due_date: candidate.suggestedDueDate,
            urgency: candidate.urgency as "low" | "normal" | "high" | "critical",
            assigned_to: auth.userId,
          });
          created.push(suggestion);
        }
        res.json({ ok: true, scannedCandidates: candidates.length, createdSuggestions: created.length, suggestions: created });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

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
