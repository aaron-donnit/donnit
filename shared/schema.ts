import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("member"),
  persona: text("persona").notNull().default("operator"),
  managerId: integer("manager_id"),
  canAssign: integer("can_assign", { mode: "boolean" }).notNull().default(false),
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("open"),
  urgency: text("urgency").notNull().default("normal"),
  dueDate: text("due_date"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(30),
  assignedToId: integer("assigned_to_id").notNull(),
  assignedById: integer("assigned_by_id").notNull(),
  delegatedToId: integer("delegated_to_id"),
  collaboratorIds: text("collaborator_ids").notNull().default("[]"),
  source: text("source").notNull().default("chat"),
  recurrence: text("recurrence").notNull().default("none"),
  reminderDaysBefore: integer("reminder_days_before").notNull().default(0),
  positionProfileId: text("position_profile_id"),
  visibility: text("visibility").notNull().default("work"),
  visibleFrom: text("visible_from"),
  acceptedAt: text("accepted_at"),
  deniedAt: text("denied_at"),
  completedAt: text("completed_at"),
  completionNotes: text("completion_notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  actorId: integer("actor_id").notNull(),
  type: text("type").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  taskId: integer("task_id"),
  createdAt: text("created_at").notNull(),
});

export const emailSuggestions = sqliteTable("email_suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromEmail: text("from_email").notNull(),
  subject: text("subject").notNull(),
  preview: text("preview").notNull(),
  suggestedTitle: text("suggested_title").notNull(),
  suggestedDueDate: text("suggested_due_date"),
  urgency: text("urgency").notNull().default("normal"),
  status: text("status").notNull().default("pending"),
  assignedToId: integer("assigned_to_id").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  acceptedAt: true,
  deniedAt: true,
  completedAt: true,
  completionNotes: true,
  createdAt: true,
});

export const insertTaskEventSchema = createInsertSchema(taskEvents).omit({
  id: true,
  createdAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export const insertEmailSuggestionSchema = createInsertSchema(emailSuggestions).omit({
  id: true,
  createdAt: true,
  status: true,
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(2).max(800),
});

export const taskCreateRequestSchema = insertTaskSchema.extend({
  title: z.string().trim().min(2).max(160),
  assignedToId: z.union([z.string().min(1), z.number()]),
  assignedById: z.union([z.string().min(1), z.number()]),
  urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  status: z
    .enum(["open", "pending_acceptance", "accepted", "denied", "completed"])
    .default("open"),
  source: z.enum(["chat", "manual", "email", "slack", "sms", "document", "automation", "annual"]).default("manual"),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "quarterly", "annual"]).default("none"),
  positionProfileId: z.string().nullable().optional(),
  visibility: z.enum(["work", "personal", "confidential"]).default("work"),
  visibleFrom: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  description: z.string().optional().default(""),
});

export const taskUpdateRequestSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["open", "pending_acceptance", "accepted", "denied", "completed"]).optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
  dueDate: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().min(5).max(1440).optional(),
  assignedToId: z.union([z.string().min(1), z.number()]).optional(),
  delegatedToId: z.union([z.string().min(1), z.number()]).nullable().optional(),
  collaboratorIds: z.array(z.union([z.string().min(1), z.number()])).optional(),
  positionProfileId: z.string().nullable().optional(),
  visibility: z.enum(["work", "personal", "confidential"]).optional(),
  visibleFrom: z.string().nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "quarterly", "annual"]).optional(),
  reminderDaysBefore: z.number().int().min(0).max(365).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const noteRequestSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});

export const externalTaskSuggestionSchema = z.object({
  text: z.string().trim().min(2).max(4000),
  from: z.string().trim().max(200).optional(),
  channel: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(180).optional(),
  assignedToId: z.union([z.string().min(1), z.number()]).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTaskEvent = z.infer<typeof insertTaskEventSchema>;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertEmailSuggestion = z.infer<typeof insertEmailSuggestionSchema>;
export type EmailSuggestion = typeof emailSuggestions.$inferSelect;
