import {
  chatMessages,
  emailSuggestions,
  taskEvents,
  tasks,
  users,
} from "@shared/schema";
import type {
  ChatMessage,
  EmailSuggestion,
  InsertChatMessage,
  InsertEmailSuggestion,
  InsertTask,
  InsertTaskEvent,
  InsertUser,
  Task,
  TaskEvent,
  User,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { asc, desc, eq } from "drizzle-orm";
import path from "node:path";

// Pick a writable location for the demo SQLite file. On Vercel only /tmp is
// writable from a serverless function, so default there when running in that
// environment. Outside Vercel we keep the original ./data.db so local dev and
// the bundled `npm start` server behave exactly as before.
function resolveDemoDbPath() {
  if (process.env.DONNIT_DEMO_DB_PATH) return process.env.DONNIT_DEMO_DB_PATH;
  if (process.env.VERCEL) return path.join("/tmp", "donnit-demo.db");
  return "data.db";
}

let cachedDb: BetterSQLite3Database | null = null;

function getDb(): BetterSQLite3Database {
  if (cachedDb) return cachedDb;
  const sqlite = new Database(resolveDemoDbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      persona TEXT NOT NULL DEFAULT 'operator',
      manager_id INTEGER,
      can_assign INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      urgency TEXT NOT NULL DEFAULT 'normal',
      due_date TEXT,
      due_time TEXT,
      start_time TEXT,
      end_time TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      estimated_minutes INTEGER NOT NULL DEFAULT 30,
      assigned_to_id INTEGER NOT NULL,
      assigned_by_id INTEGER NOT NULL,
      delegated_to_id INTEGER,
      collaborator_ids TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'chat',
      recurrence TEXT NOT NULL DEFAULT 'none',
      reminder_days_before INTEGER NOT NULL DEFAULT 0,
      position_profile_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'work',
      visible_from TEXT,
      accepted_at TEXT,
      denied_at TEXT,
      completed_at TEXT,
      completion_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      task_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      preview TEXT NOT NULL,
      suggested_title TEXT NOT NULL,
      suggested_due_date TEXT,
      urgency TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_to_id INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  const taskColumns = new Set((sqlite.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((c) => c.name));
  if (!taskColumns.has("delegated_to_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN delegated_to_id INTEGER");
  }
  if (!taskColumns.has("collaborator_ids")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN collaborator_ids TEXT NOT NULL DEFAULT '[]'");
  }
  if (!taskColumns.has("position_profile_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN position_profile_id TEXT");
  }
  if (!taskColumns.has("visibility")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'work'");
  }
  if (!taskColumns.has("visible_from")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN visible_from TEXT");
  }
  if (!taskColumns.has("due_time")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN due_time TEXT");
  }
  if (!taskColumns.has("start_time")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN start_time TEXT");
  }
  if (!taskColumns.has("end_time")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN end_time TEXT");
  }
  if (!taskColumns.has("is_all_day")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0");
  }
  cachedDb = drizzle(sqlite);
  seedIfEmpty(cachedDb);
  return cachedDb;
}

// Backwards-compatible export. Reading `db` triggers initialization on first
// use, so importing this module remains a no-op on serverless cold starts.
export const db: BetterSQLite3Database = new Proxy({} as BetterSQLite3Database, {
  get(_t, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

function nowIso() {
  return new Date().toISOString();
}

function seedIfEmpty(db: BetterSQLite3Database) {
  const existingUsers = db.select().from(users).all();
  if (existingUsers.length === 0) {
    const seededUsers: InsertUser[] = [
      {
        name: "Aaron",
        email: "aaron@rosterstack.com",
        role: "owner",
        persona: "founder",
        managerId: null,
        canAssign: true,
      },
      {
        name: "Maya",
        email: "maya@donnit.ai",
        role: "manager",
        persona: "operations",
        managerId: 1,
        canAssign: true,
      },
      {
        name: "Jordan",
        email: "jordan@donnit.ai",
        role: "member",
        persona: "support",
        managerId: 2,
        canAssign: false,
      },
    ];

    for (const user of seededUsers) {
      db.insert(users).values(user).run();
    }
  }

  const existingTasks = db.select().from(tasks).all();
  if (existingTasks.length === 0) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const seededTasks: InsertTask[] = [
      {
        title: "Confirm Donnit MVP scope",
        description: "Decide the first release boundary and what can wait until integrations.",
        status: "open",
        urgency: "high",
        dueDate: today.toISOString().slice(0, 10),
        estimatedMinutes: 45,
        assignedToId: 1,
        assignedById: 1,
        source: "manual",
        recurrence: "none",
        reminderDaysBefore: 0,
      },
      {
        title: "Review email-scan permission copy",
        description: "Make the opt-in prompt clear before Donnit adds a task from an email.",
        status: "pending_acceptance",
        urgency: "normal",
        dueDate: tomorrow.toISOString().slice(0, 10),
        estimatedMinutes: 30,
        assignedToId: 2,
        assignedById: 1,
        source: "email",
        recurrence: "none",
        reminderDaysBefore: 0,
      },
      {
        title: "Spouse birthday reminder",
        description: "Birthday on 2026-05-30; reminder fires 15 days before.",
        status: "open",
        urgency: "normal",
        dueDate: "2026-05-15",
        estimatedMinutes: 15,
        assignedToId: 1,
        assignedById: 1,
        source: "annual",
        recurrence: "annual",
        reminderDaysBefore: 15,
      },
    ];

    for (const task of seededTasks) {
      const created = db.insert(tasks).values({ ...task, createdAt: nowIso() }).returning().get();
      db.insert(taskEvents)
        .values({
          taskId: created.id,
          actorId: created.assignedById,
          type: "created",
          note: `Task created from ${created.source}.`,
          createdAt: nowIso(),
        })
        .run();
    }
  }

  const existingSuggestions = db.select().from(emailSuggestions).all();
  if (existingSuggestions.length === 0) {
    const due = new Date();
    due.setDate(due.getDate() + 2);
    const suggestions: InsertEmailSuggestion[] = [
      {
        fromEmail: "support@acmehr.example",
        subject: "New IT ticket submitted: payroll login reset",
        preview: "Employee cannot access payroll before Friday's deadline. Please assign to support.",
        suggestedTitle: "Resolve payroll login reset ticket",
        suggestedDueDate: due.toISOString().slice(0, 10),
        urgency: "high",
        assignedToId: 3,
      },
      {
        fromEmail: "finance@example.com",
        subject: "Contract renewal needs founder approval",
        preview: "Can you review the renewal terms and confirm by end of week?",
        suggestedTitle: "Review contract renewal terms",
        suggestedDueDate: due.toISOString().slice(0, 10),
        urgency: "normal",
        assignedToId: 1,
      },
    ];

    for (const suggestion of suggestions) {
      db.insert(emailSuggestions).values({ ...suggestion, status: "pending", createdAt: nowIso() }).run();
    }
  }
}

export interface IStorage {
  listUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  listTasks(): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, patch: Partial<Task>): Promise<Task | undefined>;
  addEvent(event: InsertTaskEvent): Promise<TaskEvent>;
  listEvents(): Promise<TaskEvent[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  listChatMessages(): Promise<ChatMessage[]>;
  listEmailSuggestions(): Promise<EmailSuggestion[]>;
  createEmailSuggestion(suggestion: InsertEmailSuggestion): Promise<EmailSuggestion>;
  updateEmailSuggestion(id: number, patch: Partial<EmailSuggestion>): Promise<EmailSuggestion | undefined>;
  approveEmailSuggestion(id: number, actorId: number): Promise<{ suggestion?: EmailSuggestion; task?: Task }>;
  dismissEmailSuggestion(id: number): Promise<EmailSuggestion | undefined>;
}

export class DatabaseStorage implements IStorage {
  async listUsers(): Promise<User[]> {
    return getDb().select().from(users).orderBy(asc(users.id)).all();
  }

  async getUser(id: number): Promise<User | undefined> {
    return getDb().select().from(users).where(eq(users.id, id)).get();
  }

  async listTasks(): Promise<Task[]> {
    return getDb().select().from(tasks).all();
  }

  async createTask(task: InsertTask): Promise<Task> {
    const created = getDb().insert(tasks).values({ ...task, createdAt: nowIso() }).returning().get();
    await this.addEvent({
      taskId: created.id,
      actorId: created.assignedById,
      type: "created",
      note: `Task created from ${created.source}.`,
    });
    return created;
  }

  async updateTask(id: number, patch: Partial<Task>): Promise<Task | undefined> {
    return getDb().update(tasks).set(patch).where(eq(tasks.id, id)).returning().get();
  }

  async addEvent(event: InsertTaskEvent): Promise<TaskEvent> {
    return getDb().insert(taskEvents).values({ ...event, createdAt: nowIso() }).returning().get();
  }

  async listEvents(): Promise<TaskEvent[]> {
    return getDb().select().from(taskEvents).orderBy(desc(taskEvents.createdAt)).all();
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    return getDb().insert(chatMessages).values({ ...message, createdAt: nowIso() }).returning().get();
  }

  async listChatMessages(): Promise<ChatMessage[]> {
    return getDb().select().from(chatMessages).orderBy(asc(chatMessages.id)).all();
  }

  async listEmailSuggestions(): Promise<EmailSuggestion[]> {
    return getDb().select().from(emailSuggestions).orderBy(desc(emailSuggestions.createdAt)).all();
  }

  async createEmailSuggestion(suggestion: InsertEmailSuggestion): Promise<EmailSuggestion> {
    return getDb()
      .insert(emailSuggestions)
      .values({ ...suggestion, status: "pending", createdAt: nowIso() })
      .returning()
      .get();
  }

  async updateEmailSuggestion(id: number, patch: Partial<EmailSuggestion>): Promise<EmailSuggestion | undefined> {
    return getDb()
      .update(emailSuggestions)
      .set(patch)
      .where(eq(emailSuggestions.id, id))
      .returning()
      .get();
  }

  async approveEmailSuggestion(id: number, actorId: number): Promise<{ suggestion?: EmailSuggestion; task?: Task }> {
    const dbi = getDb();
    const suggestion = dbi.select().from(emailSuggestions).where(eq(emailSuggestions.id, id)).get();
    if (!suggestion) {
      return {};
    }

    const updatedSuggestion = dbi
      .update(emailSuggestions)
      .set({ status: "approved" })
      .where(eq(emailSuggestions.id, id))
      .returning()
      .get();

    const source = suggestion.fromEmail.toLowerCase().startsWith("slack:")
      ? "slack"
      : suggestion.fromEmail.toLowerCase().startsWith("sms:")
        ? "sms"
        : "email";
    const task = await this.createTask({
      title: suggestion.suggestedTitle,
      description: `${suggestion.subject}\n\n${suggestion.preview}`,
      status: suggestion.assignedToId === actorId ? "open" : "pending_acceptance",
      urgency: suggestion.urgency,
      dueDate: suggestion.suggestedDueDate,
      estimatedMinutes: suggestion.urgency === "high" ? 45 : 30,
      assignedToId: suggestion.assignedToId,
      assignedById: actorId,
      source,
      recurrence: "none",
      reminderDaysBefore: 0,
    });

    await this.addEvent({
      taskId: task.id,
      actorId,
      type: "email_approved",
      note: `Approved ${source} task suggestion from ${suggestion.fromEmail}.`,
    });

    return { suggestion: updatedSuggestion, task };
  }

  async dismissEmailSuggestion(id: number): Promise<EmailSuggestion | undefined> {
    return getDb()
      .update(emailSuggestions)
      .set({ status: "dismissed" })
      .where(eq(emailSuggestions.id, id))
      .returning()
      .get();
  }
}

export const storage = new DatabaseStorage();
