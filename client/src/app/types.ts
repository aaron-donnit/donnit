export type Id = string | number;

export type AgendaItem = {
  taskId: Id;
  order: number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  urgency: string;
  startAt: string | null;
  endAt: string | null;
  timeZone: string;
  scheduleStatus: "scheduled" | "unscheduled";
};

export type AgendaPreference = "deep_work" | "communications" | "mixed";

export type AgendaPreferences = {
  workdayStart: string;
  workdayEnd: string;
  lunchStart: string;
  lunchMinutes: number;
  meetingBufferMinutes: number;
  minimumBlockMinutes: number;
  focusBlockMinutes: number;
  morningPreference: AgendaPreference;
  afternoonPreference: AgendaPreference;
};

export type AgendaSchedule = {
  autoBuildEnabled: boolean;
  buildTime: string;
  lastAutoBuildDate: string | null;
};

export type User = {
  id: Id;
  name: string;
  email: string;
  role: string;
  persona: string;
  emailSignature?: string | null;
  managerId: Id | null;
  canAssign: boolean;
  status?: "active" | "inactive";
};

export type Task = {
  id: Id;
  title: string;
  description: string;
  status: string;
  urgency: string;
  dueDate: string | null;
  dueTime: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  estimatedMinutes: number;
  assignedToId: Id;
  assignedById: Id;
  delegatedToId: Id | null;
  collaboratorIds: Id[];
  source: string;
  recurrence: string;
  reminderDaysBefore: number;
  positionProfileId: Id | null;
  visibility: "work" | "personal" | "confidential";
  visibleFrom: string | null;
  acceptedAt: string | null;
  deniedAt: string | null;
  completedAt: string | null;
  completionNotes: string;
  createdAt: string;
};

export type TaskEvent = {
  id: Id;
  taskId: Id;
  actorId: Id;
  type: string;
  note: string;
  createdAt: string;
};

export type InheritedTaskContext = {
  profileTitle: string;
  fromUserId: Id | null;
  toUserId: Id | null;
  mode: string;
  delegateUntil: string | null;
  inheritedDescription: string;
  inheritedCompletionNotes: string;
  inheritedAt: string | null;
};

export type LocalSubtask = {
  id: string;
  taskId: Id;
  title: string;
  done: boolean;
  position: number;
  completedAt: string | null;
  createdAt: string;
};

export type TaskSubtask = LocalSubtask;

export type TaskTemplateSubtask = {
  id: Id;
  templateId: Id;
  title: string;
  position: number;
  createdAt: string;
};

export type TaskTemplate = {
  id: Id;
  name: string;
  description: string;
  triggerPhrases: string[];
  defaultUrgency: "low" | "normal" | "high" | "critical";
  defaultEstimatedMinutes: number;
  defaultRecurrence: "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  createdBy: Id | null;
  createdAt: string;
  updatedAt: string;
  subtasks: TaskTemplateSubtask[];
};

export type WorkspaceState = {
  reviewedNotificationIds: string[];
  agenda: {
    excludedTaskIds: string[];
    approved: boolean;
    approvedAt: string | null;
    preferences: AgendaPreferences;
    taskOrder: string[];
    schedule: AgendaSchedule;
  };
  onboarding: {
    dismissed: boolean;
    dismissedAt: string | null;
  };
};

export type ChatMessage = {
  id: Id;
  role: string;
  content: string;
  taskId: Id | null;
  createdAt: string;
};

export type EmailSuggestion = {
  id: Id;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  fromEmail: string;
  subject: string;
  preview: string;
  body?: string;
  receivedAt?: string | null;
  actionItems?: string[];
  suggestedTitle: string;
  suggestedDueDate: string | null;
  urgency: string;
  status: string;
  assignedToId: Id | null;
  replySuggested?: boolean;
  replyDraft?: string | null;
  replyStatus?: "none" | "suggested" | "drafted" | "sent" | "copy" | "failed";
  replySentAt?: string | null;
  replyProviderMessageId?: string | null;
  createdAt: string;
};

export type SuggestionReplyResult = {
  ok: boolean;
  provider: "email" | "slack" | "sms" | "document";
  delivery: "mailto" | "sent" | "copy";
  target?: string;
  subject?: string;
  href?: string;
  message?: string;
  body?: string;
  fallbackReason?: string;
  providerMessageId?: string | null;
  completedTask?: Task | null;
};

export type SuggestionDraftReplyResult = {
  ok: boolean;
  draft: string;
  rationale?: string;
  suggestion?: EmailSuggestion | null;
};

export type SuggestionPatch = {
  suggestedTitle?: string;
  suggestedDueDate?: string | null;
  urgency?: "low" | "normal" | "high" | "critical";
  preview?: string;
};

export type Bootstrap = {
  authenticated?: boolean;
  bootstrapped?: boolean;
  currentUserId: Id;
  email?: string | null;
  orgId?: string;
  users: User[];
  tasks: Task[];
  events: TaskEvent[];
  messages: ChatMessage[];
  suggestions: EmailSuggestion[];
  positionProfiles?: PersistedPositionProfile[];
  subtasks?: TaskSubtask[];
  taskTemplates?: TaskTemplate[];
  workspaceState?: WorkspaceState;
  agenda: AgendaItem[];
  integrations: {
    auth: { provider: string; status: string; projectId: string; schema?: string };
    email: { provider: string; sourceId: string; status: string; mode: string };
    slack?: {
      provider: string;
      status: string;
      mode: string;
      webhookConfigured?: boolean;
      botConfigured?: boolean;
      signingSecretConfigured?: boolean;
      eventsConfigured?: boolean;
      userMapping?: string;
      unreadDelayMinutes?: number;
    };
    sms?: {
      provider: string;
      status: string;
      mode: string;
      webhookConfigured?: boolean;
      signatureConfigured?: boolean;
      accountConfigured?: boolean;
      providerConfigured?: boolean;
      fromNumberConfigured?: boolean;
      inboundConfigured?: boolean;
      routing?: string;
    };
    reminders: { channelOrder: string[]; reminderOrder: string[] };
    app: { delivery: string; native: string };
  };
};

export type PositionProfile = {
  id: string;
  persisted: boolean;
  title: string;
  owner: User;
  currentOwnerId: Id | null;
  directManagerId: Id | null;
  temporaryOwnerId: Id | null;
  delegateUserId: Id | null;
  delegateUntil: string | null;
  status: "active" | "vacant" | "covered";
  currentIncompleteTasks: Task[];
  recurringTasks: Task[];
  completedTasks: Task[];
  criticalDates: string[];
  howTo: string[];
  tools: string[];
  stakeholders: string[];
  accessItems: ProfileAccessItem[];
  institutionalMemory: Record<string, unknown>;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
  transitionChecklist: string[];
  lastUpdatedAt: string | null;
};

export type ProfileAccessItem = {
  id: string;
  toolName: string;
  loginUrl: string;
  accountOwner: string;
  billingNotes: string;
  status: "active" | "needs_grant" | "needs_reset" | "remove_access" | "pending";
  updatedAt: string;
};

export type PersistedPositionProfile = {
  id: string;
  title: string;
  status: "active" | "vacant" | "covered";
  currentOwnerId: Id | null;
  directManagerId: Id | null;
  temporaryOwnerId: Id | null;
  delegateUserId: Id | null;
  delegateUntil: string | null;
  autoUpdateRules: Record<string, unknown>;
  institutionalMemory: Record<string, unknown>;
  riskScore: number;
  riskSummary: string;
  createdAt: string;
  updatedAt: string;
};

export type PositionProfileKnowledge = {
  id: Id;
  positionProfileId: Id;
  sourceTaskId: Id | null;
  kind: string;
  title: string;
  body: string;
  markdownBody: string;
  sourceKind: string;
  evidence: Record<string, unknown>;
  confidence: "low" | "medium" | "high";
  confidenceScore: number;
  importance: number;
  lastSeenAt: string;
  createdAt: string;
};

export type TaskContinuityContext = {
  ok: boolean;
  task: Task;
  profile: PersistedPositionProfile | null;
  knowledge: PositionProfileKnowledge[];
  historicalTasks: Task[];
  events: TaskEvent[];
  subtasks: TaskSubtask[];
};

export type ContinuityPreviewTask = {
  id: string;
  title: string;
  dueDate: string | null;
  urgency: string;
  recurrence: string;
  visibleFrom: string | null;
  visibility: "work" | "personal" | "confidential";
  action: "transfer_owner" | "delegate_coverage" | "exclude_personal" | "review_unbound";
  contextHidden: boolean;
};

export type ContinuityAssignmentPreview = {
  profileId: string | null;
  profileTitle: string;
  mode: "transfer" | "delegate";
  fromUserId: string;
  toUserId: string;
  delegateUntil: string | null;
  summary: {
    activeTasks: number;
    recurringTasks: number;
    futureRecurringTasks: number;
    confidentialTasks: number;
    personalTasksExcluded: number;
    historicalTasks: number;
    contextHiddenTasks: number;
    unboundTasksNeedingReview: number;
  };
  includedTasks: ContinuityPreviewTask[];
  excludedTasks: ContinuityPreviewTask[];
  reviewTasks: ContinuityPreviewTask[];
  warnings: string[];
};

export type UrgencyClass = "urgency-high" | "urgency-medium" | "urgency-low";

export type AppView = "home" | "tasks" | "agenda" | "inbox" | "team" | "profiles" | "reports" | "admin" | "settings";
