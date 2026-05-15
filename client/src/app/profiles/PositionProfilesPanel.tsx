import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Download,
  Edit3,
  Eye,
  FileText,
  GitMerge,
  History,
  KeyRound,
  ListChecks,
  ListPlus,
  Loader2,
  Paperclip,
  Repeat2,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type {
  ContinuityAssignmentPreview,
  Id,
  PersistedPositionProfile,
  PositionProfile,
  PositionProfileTaskMemory,
  ProfileAccessItem,
  Task,
  TaskEvent,
  TaskSubtask,
  User,
} from "@/app/types";
import { dialogBodyClass, dialogFooterClass, dialogHeaderClass, dialogShellClass } from "@/app/constants";
import { urgencyLabel } from "@/app/lib/urgency";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { titleCase, taskKnowledgeText, taskRepeatLabel } from "@/app/lib/task-text";
import { memoryHowToNotes, memoryRecentSignals, memoryRecurringResponsibilities, mergeRecurringResponsibilities, recurringResponsibilitiesFromTasks } from "@/app/lib/memory";
import { canAdministerProfiles, isActiveUser } from "@/app/lib/permissions";
import { profileAssignmentLabel, profilePrimaryOwnerId, profilesForUser } from "@/app/lib/profiles";
import { richNoteToPlainText } from "@/app/lib/rich-notes";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";

type ProfileFilter = "all" | "active" | "at_risk" | "vacant" | "archived";
type SheetTab = "overview" | "work" | "recurring" | "memory" | "tools" | "activity";
type ConfirmAction = "archive" | "delete" | null;
type TaskMemoryFormStep = {
  title: string;
  instructions: string;
  toolName: string;
  toolUrl: string;
  expectedOutput: string;
  relativeDueOffsetDays: number;
  estimatedMinutes: number;
};

type CapturedAttachment = {
  name: string;
  kind: "Document" | "Image" | "Spreadsheet" | "Other";
  size: number;
  contentType: string;
  file?: File;
};

type TaskMemoryDraft = {
  title: string;
  objective: string;
  cadence: PositionProfileTaskMemory["cadence"];
  dueRule: string;
  startOffsetDays: number;
  defaultUrgency: PositionProfileTaskMemory["defaultUrgency"];
  defaultEstimatedMinutes: number;
  guidelines: string;
  importantInformation: string;
  attachmentReferences: string;
  attachments: CapturedAttachment[];
  steps: TaskMemoryFormStep[];
};

const accessStatusLabels: Record<ProfileAccessItem["status"], string> = {
  active: "Active",
  needs_grant: "Grant access",
  needs_reset: "Reset needed",
  remove_access: "Remove access",
  pending: "Pending",
};

function emptyTaskMemoryStep(position = 0): TaskMemoryFormStep {
  return {
    title: position === 0 ? "Start the workflow" : "Next step",
    instructions: "",
    toolName: "",
    toolUrl: "",
    expectedOutput: "",
    relativeDueOffsetDays: 0,
    estimatedMinutes: 30,
  };
}

function emptyTaskMemoryDraft(): TaskMemoryDraft {
  return {
    title: "",
    objective: "",
    cadence: "none",
    dueRule: "",
    startOffsetDays: 0,
    defaultUrgency: "normal",
    defaultEstimatedMinutes: 30,
    guidelines: "",
    importantInformation: "",
    attachmentReferences: "",
    attachments: [],
    steps: [emptyTaskMemoryStep(0), emptyTaskMemoryStep(1)],
  };
}

function classifyAttachment(file: File): CapturedAttachment["kind"] {
  const lower = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) return "Image";
  if (/\.(csv|xls|xlsx|numbers)$/i.test(lower)) return "Spreadsheet";
  if (file.type.includes("pdf") || /\.(pdf|doc|docx|txt|rtf|md)$/i.test(lower)) return "Document";
  return "Other";
}

function attachmentSummaryLines(attachments: CapturedAttachment[]) {
  return attachments.map((file) => `Attachment captured: [${file.kind}] ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",").pop() ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment."));
    reader.readAsDataURL(file);
  });
}

export default function PositionProfilesPanel({
  profiles,
  users,
  currentUserId,
  authenticated,
  subtasks = [],
  events = [],
  focusProfileId = null,
  focusAction = null,
  focusMemoryPrompt = "",
  focusRequestKey = 0,
}: {
  profiles: PositionProfile[];
  users: User[];
  currentUserId: Id;
  authenticated: boolean;
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
  focusProfileId?: string | null;
  focusAction?: "task-memory" | null;
  focusMemoryPrompt?: string;
  focusRequestKey?: number;
}) {
  const currentUser = users.find((user) => String(user.id) === String(currentUserId));
  const canManageProfiles = canAdministerProfiles(currentUser);
  const [customProfileMetas, setCustomProfileMetas] = useState<Array<{ id: string; title: string; ownerId: string }>>(() => {
    try {
      if (typeof window === "undefined") return [];
      return JSON.parse(window.localStorage.getItem("donnit.customPositionProfiles") ?? "[]");
    } catch {
      return [];
    }
  });
  const [deletedProfileIds, setDeletedProfileIds] = useState<Set<string>>(() => {
    try {
      if (typeof window === "undefined") return new Set();
      return new Set(JSON.parse(window.localStorage.getItem("donnit.deletedPositionProfiles") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [renamedProfileTitles, setRenamedProfileTitles] = useState<Record<string, string>>(() => {
    try {
      if (typeof window === "undefined") return {};
      return JSON.parse(window.localStorage.getItem("donnit.renamedPositionProfiles") ?? "{}");
    } catch {
      return {};
    }
  });

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [expandedProfileIds, setExpandedProfileIds] = useState<Set<string>>(new Set());
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(new Set());
  const [profileListSearch, setProfileListSearch] = useState("");
  const [profileListFilter, setProfileListFilter] = useState<ProfileFilter>("all");
  const [profileTaskSearch, setProfileTaskSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [taskMemoryOpen, setTaskMemoryOpen] = useState(false);
  const [taskMemoryDraft, setTaskMemoryDraft] = useState<TaskMemoryDraft>(() => emptyTaskMemoryDraft());
  const [taskMemoryDraggingFiles, setTaskMemoryDraggingFiles] = useState(false);
  const taskMemoryAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [newProfileTitle, setNewProfileTitle] = useState("");
  const [newProfileOwnerId, setNewProfileOwnerId] = useState(String(users[0]?.id ?? ""));
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState<"active" | "vacant" | "covered">("active");
  const [targetUserId, setTargetUserId] = useState("");
  const [mode, setMode] = useState<"delegate" | "transfer">("transfer");
  const [delegateUntil, setDelegateUntil] = useState("");
  const [selectedProfileTaskId, setSelectedProfileTaskId] = useState<string | null>(null);
  const [accessDraft, setAccessDraft] = useState<{
    toolName: string;
    loginUrl: string;
    accountOwner: string;
    billingNotes: string;
    status: ProfileAccessItem["status"];
  }>({ toolName: "", loginUrl: "", accountOwner: "", billingNotes: "", status: "needs_grant" });

  const customProfiles = useMemo(
    () =>
      customProfileMetas
        .map((meta): PositionProfile | null => {
          const owner = users.find((user) => String(user.id) === meta.ownerId) ?? users[0];
          if (!owner) return null;
          const base = profiles.find((profile) => String(profile.owner.id) === String(owner.id));
          return {
            ...(base ?? emptyProfileBase(owner)),
            id: meta.id,
            persisted: false,
            title: meta.title,
            owner,
            currentOwnerId: owner.id,
          } satisfies PositionProfile;
        })
        .filter((profile): profile is PositionProfile => Boolean(profile)),
    [customProfileMetas, profiles, users],
  );

  const repositoryProfiles = useMemo(() => {
    if (authenticated) return [...profiles].sort((a, b) => a.title.localeCompare(b.title));
    return [
      ...profiles
        .filter((profile) => !deletedProfileIds.has(profile.id))
        .map((profile) => ({ ...profile, title: renamedProfileTitles[profile.id] ?? profile.title })),
      ...customProfiles,
    ].sort((a, b) => a.title.localeCompare(b.title));
  }, [authenticated, customProfiles, deletedProfileIds, profiles, renamedProfileTitles]);

  const selectedProfile = repositoryProfiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const assignmentUsers = useMemo(() => users.filter(isActiveUser), [users]);
  const targetUsers = useMemo(() => assignableUsersForProfile(selectedProfile, users), [selectedProfile, users]);
  const canManageSelectedTaskMemory = Boolean(selectedProfile && canManageTaskMemoryForProfile(selectedProfile, currentUser, currentUserId, users));

  const createProfile = useMutation({
    mutationFn: async (input: { title: string; ownerId: Id | null; status?: "active" | "vacant" | "covered" }) => {
      const res = await apiRequest("POST", "/api/position-profiles", {
        title: input.title,
        ownerId: input.ownerId === null ? null : String(input.ownerId),
        status: input.status,
      });
      return (await res.json()) as PersistedPositionProfile;
    },
    onSuccess: async (profile) => {
      await invalidateWorkspace();
      setSelectedProfileId(profile.id);
      setSheetOpen(true);
      setCreateOpen(false);
      toast({ title: "Position Profile saved", description: `${profile.title} is now a durable admin record.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save Position Profile",
        description: error instanceof Error ? error.message : "Apply the Position Profiles migration and try again.",
        variant: "destructive",
      });
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/position-profiles/${input.id}`, input.patch);
      return (await res.json()) as PersistedPositionProfile;
    },
    onSuccess: async (profile) => {
      await invalidateWorkspace();
      setSelectedProfileId(profile.id);
      setEditOpen(false);
      setToolsOpen(false);
      setConfirmAction(null);
      toast({ title: "Position Profile updated", description: `${profile.title} was saved.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update Position Profile",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const deletePersistedProfile = useMutation({
    mutationFn: async (profileId: string) => apiRequest("DELETE", `/api/position-profiles/${profileId}`),
    onSuccess: async () => {
      await invalidateWorkspace();
      setSelectedProfileId("");
      setSheetOpen(false);
      setConfirmAction(null);
      toast({ title: "Position Profile deleted", description: "The saved admin record was removed." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not delete Position Profile",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const assignmentPreviewQuery = useQuery({
    queryKey: [
      "position-profile-assignment-preview",
      selectedProfile?.id ?? "",
      selectedProfile?.persisted ? selectedProfile.id : "",
      selectedProfile?.currentOwnerId ? String(selectedProfile.currentOwnerId) : "__vacant__",
      targetUserId,
      mode,
      delegateUntil,
      authenticated,
    ],
    enabled: Boolean(authenticated && assignmentDialogOpen && selectedProfile && targetUserId),
    queryFn: async () => {
      if (!selectedProfile || !targetUserId) throw new Error("Choose a profile and target user.");
      const res = await apiRequest("POST", "/api/position-profiles/assign/preview", {
        profileId: selectedProfile.persisted ? selectedProfile.id : undefined,
        fromUserId: selectedProfile.currentOwnerId ? String(selectedProfile.currentOwnerId) : targetUserId,
        toUserId: targetUserId,
        mode,
        delegateUntil: delegateUntil || null,
        profileTitle: selectedProfile.title,
        includeUnboundOwnerTasks: !selectedProfile.persisted,
      });
      const data = (await res.json()) as { ok: boolean; preview: ContinuityAssignmentPreview };
      return data.preview;
    },
  });
  const assignmentPreview = assignmentPreviewQuery.data ?? null;

  const assign = useMutation({
    mutationFn: async () => {
      if (!selectedProfile || !targetUserId) throw new Error("Choose a profile and target user.");
      let profileId = selectedProfile.persisted ? selectedProfile.id : undefined;
      if (authenticated && !profileId) {
        const createRes = await apiRequest("POST", "/api/position-profiles", {
          title: selectedProfile.title,
          ownerId: String(selectedProfile.owner.id),
          status: selectedProfile.status,
        });
        const created = (await createRes.json()) as PersistedPositionProfile;
        profileId = created.id;
      }
      const res = await apiRequest("POST", "/api/position-profiles/assign", {
        profileId,
        fromUserId: selectedProfile.currentOwnerId ?? targetUserId,
        toUserId: targetUserId,
        mode,
        delegateUntil: delegateUntil || null,
        profileTitle: selectedProfile.title,
        includeUnboundOwnerTasks: !selectedProfile.persisted,
      });
      return (await res.json()) as {
        ok: boolean;
        updated: number;
        mode: string;
        profile?: PersistedPositionProfile | null;
        preview?: ContinuityAssignmentPreview;
      };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      if (result.profile?.id) setSelectedProfileId(result.profile.id);
      setAssignmentDialogOpen(false);
      const recurring = result.preview?.summary.recurringTasks ?? 0;
      const future = result.preview?.summary.futureRecurringTasks ?? 0;
      toast({
        title: mode === "transfer" ? "Profile transferred" : "Coverage delegated",
        description: `${result.updated} active task${result.updated === 1 ? "" : "s"} updated. ${recurring} recurring ${recurring === 1 ? "item" : "items"} retained${future > 0 ? `, ${future} hidden until due window` : ""}.`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not assign profile",
        description: error instanceof Error ? error.message : "Check the profile assignment and try again.",
        variant: "destructive",
      });
    },
  });

  const taskMemoryQuery = useQuery({
    queryKey: ["position-profile-task-memory", selectedProfile?.id ?? ""],
    enabled: Boolean(authenticated && selectedProfile?.id && sheetOpen),
    queryFn: async () => {
      if (!selectedProfile) return [] as PositionProfileTaskMemory[];
      const res = await apiRequest("GET", `/api/position-profiles/${selectedProfile.id}/task-memory`);
      const data = await res.json() as { ok: boolean; memories: PositionProfileTaskMemory[] };
      return data.memories ?? [];
    },
  });

  const taskMemories = taskMemoryQuery.data ?? [];

  const createTaskMemory = useMutation({
    mutationFn: async (input: TaskMemoryDraft) => {
      if (!selectedProfile) throw new Error("Choose a Position Profile first.");
      const profileId = selectedProfile.id;
      const cleanedSteps = input.steps
        .map((step, index) => ({
          title: step.title.trim(),
          instructions: step.instructions.trim(),
          toolName: step.toolName.trim(),
          toolUrl: step.toolUrl.trim(),
          expectedOutput: step.expectedOutput.trim(),
          relativeDueOffsetDays: Number(step.relativeDueOffsetDays) || 0,
          estimatedMinutes: Math.max(5, Number(step.estimatedMinutes) || 30),
          position: index,
        }))
        .filter((step) => step.title.length > 0);
      const pendingUploads = input.attachments.filter((attachment) => attachment.file);
      const res = await apiRequest("POST", `/api/position-profiles/${profileId}/task-memory`, {
        title: input.title.trim(),
        objective: input.objective.trim(),
        cadence: input.cadence,
        dueRule: input.dueRule.trim(),
        startOffsetDays: Number(input.startOffsetDays) || 0,
        defaultUrgency: input.defaultUrgency,
        defaultEstimatedMinutes: Math.max(5, Number(input.defaultEstimatedMinutes) || 30),
        status: "active",
        confidenceScore: 0.9,
        guidelines: input.guidelines.trim(),
        importantInformation: input.importantInformation.trim(),
        attachmentReferences: [input.attachmentReferences.trim(), ...attachmentSummaryLines(input.attachments)].filter(Boolean).join("\n"),
        attachmentFiles: input.attachments.map((attachment) => ({
          name: attachment.name,
          kind: attachment.kind,
          size: attachment.size,
          contentType: attachment.contentType,
        })),
        steps: cleanedSteps,
      });
      const memory = (await res.json()) as PositionProfileTaskMemory;
      const uploadFailures: string[] = [];
      for (const attachment of pendingUploads) {
        try {
          if (!attachment.file) continue;
          const dataBase64 = await fileToBase64(attachment.file);
          await apiRequest("POST", `/api/position-profiles/${profileId}/task-memory/${memory.id}/attachments`, {
            fileName: attachment.name,
            contentType: attachment.contentType || "application/octet-stream",
            size: attachment.size,
            kind: attachment.kind,
            dataBase64,
          });
        } catch (error) {
          uploadFailures.push(`${attachment.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        }
      }
      return { memory, uploadFailures };
    },
    onSuccess: async ({ memory, uploadFailures }) => {
      await queryClient.invalidateQueries({ queryKey: ["position-profile-task-memory", selectedProfile?.id ?? ""] });
      setTaskMemoryOpen(false);
      setTaskMemoryDraft(emptyTaskMemoryDraft());
      setSheetOpen(true);
      setSheetTab("recurring");
      toast({
        title: uploadFailures.length > 0 ? "Task Profile saved, attachment issue" : "Task Profile created",
        description: uploadFailures.length > 0 ? uploadFailures[0] : `${memory.title} is ready as a reusable workflow.`,
        variant: uploadFailures.length > 0 ? "destructive" : undefined,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not create Task Profile",
        description: error instanceof Error ? error.message : "Check the workflow details and try again.",
        variant: "destructive",
      });
    },
  });

  const createTaskMemoryFromTask = useMutation({
    mutationFn: async (task: Task) => {
      if (!selectedProfile) throw new Error("Choose a Position Profile first.");
      const taskSubtasks = subtasks
        .filter((subtask) => String(subtask.taskId) === String(task.id))
        .sort((a, b) => a.position - b.position);
      const steps = taskSubtasks.length > 0
        ? taskSubtasks.map((subtask, index) => ({
            title: subtask.title,
            instructions: index === 0 ? [task.description, task.completionNotes].filter(Boolean).join("\n\n") : "",
            expectedOutput: index === taskSubtasks.length - 1 ? `Completed contribution toward ${task.title}` : "",
            estimatedMinutes: Math.max(5, Math.round(task.estimatedMinutes / Math.max(taskSubtasks.length, 1))),
            relativeDueOffsetDays: Math.min(0, index - Math.max(taskSubtasks.length - 1, 0)),
            position: index,
          }))
        : [{
            title: task.title,
            instructions: [task.description, task.completionNotes].filter(Boolean).join("\n\n"),
            expectedOutput: `Complete ${task.title}`,
            estimatedMinutes: task.estimatedMinutes,
            relativeDueOffsetDays: 0,
            position: 0,
          }];
      const res = await apiRequest("POST", `/api/position-profiles/${selectedProfile.id}/task-memory`, {
        sourceTaskId: String(task.id),
        title: task.title,
        objective: `Complete ${task.title}${task.recurrence !== "none" ? ` as a ${task.recurrence} recurring responsibility` : ""}.`,
        cadence: task.recurrence === "none" ? "none" : task.recurrence,
        dueRule: [
          task.dueDate ? `Current due date anchor: ${task.dueDate}` : "",
          task.reminderDaysBefore > 0 ? `Start ${task.reminderDaysBefore} day(s) before due date` : "",
        ].filter(Boolean).join(". "),
        startOffsetDays: task.reminderDaysBefore,
        defaultUrgency: task.urgency,
        defaultEstimatedMinutes: task.estimatedMinutes,
        status: "active",
        confidenceScore: 0.72,
        steps,
      });
      return (await res.json()) as PositionProfileTaskMemory;
    },
    onSuccess: async (memory) => {
      await queryClient.invalidateQueries({ queryKey: ["position-profile-task-memory", selectedProfile?.id ?? ""] });
      toast({ title: "Task Profile saved", description: `${memory.title} now has a reusable role sequence.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save Task Profile",
        description: error instanceof Error ? error.message : "Apply the latest Supabase migration and try again.",
        variant: "destructive",
      });
    },
  });

  const normalizedProfileListSearch = profileListSearch.trim().toLowerCase();
  const normalizedProfileTaskSearch = profileTaskSearch.trim().toLowerCase();
  const activeProfiles = repositoryProfiles.filter((profile) => profileStatusKey(profile) === "active");
  const atRiskProfiles = repositoryProfiles.filter((profile) => profileStatusKey(profile) === "at_risk");
  const vacantProfiles = repositoryProfiles.filter((profile) => profileStatusKey(profile) === "vacant");
  const archivedProfiles = repositoryProfiles.filter((profile) => profileStatusKey(profile) === "archived");
  const filteredRepositoryProfiles = repositoryProfiles.filter((profile) => {
    const key = profileStatusKey(profile);
    if (profileListFilter === "all") return true;
    if (profileListFilter === "active") return key === "active" || key === "covered";
    if (profileListFilter === "at_risk") return key === "at_risk";
    if (profileListFilter === "vacant") return key === "vacant";
    return key === "archived";
  });
  const visibleRepositoryProfiles = normalizedProfileListSearch
    ? filteredRepositoryProfiles.filter((profile) => {
        const haystack = [
          profile.title,
          profile.status,
          profileDepartment(profile),
          profileAssignmentLabel(profile, users),
          ...profile.tools,
          ...profile.stakeholders,
          ...profile.accessItems.map((item) => item.toolName),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedProfileListSearch);
      })
    : filteredRepositoryProfiles;
  const visibleSelectedIds = visibleRepositoryProfiles.map((profile) => profile.id);
  const allVisibleSelected = visibleSelectedIds.length > 0 && visibleSelectedIds.every((id) => selectedBulkIds.has(id));
  const bulkProfiles = repositoryProfiles.filter((profile) => selectedBulkIds.has(profile.id));

  const selectedMemory = selectedProfile?.institutionalMemory ?? {};
  const learnedHowToNotes = memoryHowToNotes(selectedMemory);
  const learnedRecurringResponsibilities = mergeRecurringResponsibilities(
    memoryRecurringResponsibilities(selectedMemory),
    recurringResponsibilitiesFromTasks(selectedProfile?.recurringTasks ?? []),
  );
  const learnedTaskSignals = memoryRecentSignals(selectedMemory);
  const lastLearnedAt = typeof selectedMemory.lastAutoUpdatedAt === "string" ? selectedMemory.lastAutoUpdatedAt : null;
  const recurringKnowledgeGaps = (selectedProfile?.recurringTasks ?? [])
    .filter((task) => taskKnowledgeText(task).length < 30)
    .slice(0, 4);
  const allSelectedProfileTasks = selectedProfile
    ? [
        ...selectedProfile.currentIncompleteTasks,
        ...selectedProfile.recurringTasks,
        ...selectedProfile.completedTasks,
      ].filter((task, index, items) => items.findIndex((item) => String(item.id) === String(task.id)) === index)
    : [];
  const selectedProfileTask = allSelectedProfileTasks.find((task) => String(task.id) === selectedProfileTaskId) ?? null;
  const profileSearchResults = selectedProfile && normalizedProfileTaskSearch
    ? buildProfileSearchResults({
        profile: selectedProfile,
        users,
        query: normalizedProfileTaskSearch,
        tasks: allSelectedProfileTasks,
        learnedHowToNotes,
        learnedRecurringResponsibilities,
        learnedTaskSignals,
      })
    : [];
  const profileReadinessItems = selectedProfile
    ? buildReadinessItems(selectedProfile, users, learnedHowToNotes.length, recurringKnowledgeGaps.length)
    : [];
  const readinessDone = profileReadinessItems.filter((item) => item.done).length;

  useEffect(() => {
    if (repositoryProfiles.length === 0) {
      setSelectedProfileId("");
      setSheetOpen(false);
      return;
    }
    if (!repositoryProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(repositoryProfiles[0].id);
    }
  }, [repositoryProfiles, selectedProfileId]);

  useEffect(() => {
    if (!focusProfileId) return;
    const profile = repositoryProfiles.find((item) => String(item.id) === String(focusProfileId));
    if (!profile) return;
    if (focusAction === "task-memory") {
      openTaskMemoryBuilder(profile, focusMemoryPrompt);
      return;
    }
    openProfileSheet(profile.id);
  }, [focusProfileId, focusAction, focusMemoryPrompt, focusRequestKey, repositoryProfiles]);

  useEffect(() => {
    if (!selectedProfile) {
      setTargetUserId("");
      return;
    }
    const fallback = targetUsers.find((user) => String(user.id) === String(currentUserId)) ?? targetUsers[0];
    setTargetUserId(fallback ? String(fallback.id) : "");
    setEditTitle(selectedProfile.title);
    setEditStatus(selectedProfile.status);
  }, [selectedProfile?.id, currentUserId, targetUsers]);

  function persistCustomProfiles(next: Array<{ id: string; title: string; ownerId: string }>) {
    setCustomProfileMetas(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.customPositionProfiles", JSON.stringify(next));
    }
  }

  function persistDeletedProfiles(next: Set<string>) {
    setDeletedProfileIds(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.deletedPositionProfiles", JSON.stringify(Array.from(next)));
    }
  }

  function persistRenamedProfiles(next: Record<string, string>) {
    setRenamedProfileTitles(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.renamedPositionProfiles", JSON.stringify(next));
    }
  }

  function addProfile() {
    const title = newProfileTitle.trim();
    if (!title) return;
    if (authenticated) {
      createProfile.mutate({
        title,
        ownerId: newProfileOwnerId || null,
        status: newProfileOwnerId ? "active" : "vacant",
      });
      setNewProfileTitle("");
      return;
    }
    if (!newProfileOwnerId) return;
    const id = `custom-position-${Date.now()}`;
    persistCustomProfiles([...customProfileMetas, { id, title, ownerId: newProfileOwnerId }]);
    setSelectedProfileId(id);
    setSheetOpen(true);
    setNewProfileTitle("");
    setCreateOpen(false);
  }

  function saveProfileEdits() {
    if (!selectedProfile) return;
    const trimmed = editTitle.trim();
    if (trimmed.length < 2) return;
    if (authenticated) {
      if (selectedProfile.persisted) {
        updateProfile.mutate({ id: selectedProfile.id, patch: { title: trimmed, status: editStatus } });
      } else {
        createProfile.mutate({ title: trimmed, ownerId: selectedProfile.owner.id, status: editStatus });
      }
      return;
    }
    if (selectedProfile.id.startsWith("custom-position-")) {
      persistCustomProfiles(
        customProfileMetas.map((profile) => (profile.id === selectedProfile.id ? { ...profile, title: trimmed } : profile)),
      );
    } else {
      persistRenamedProfiles({ ...renamedProfileTitles, [selectedProfile.id]: trimmed });
    }
    setEditOpen(false);
  }

  function deleteProfile() {
    if (!selectedProfile) return;
    if (authenticated) {
      if (!selectedProfile.persisted) {
        toast({
          title: "Save this Position Profile first",
          description: "This profile is assembled from task history. Save it as an admin record before deleting it.",
        });
        return;
      }
      deletePersistedProfile.mutate(selectedProfile.id);
      return;
    }
    if (selectedProfile.id.startsWith("custom-position-")) {
      persistCustomProfiles(customProfileMetas.filter((profile) => profile.id !== selectedProfile.id));
    } else {
      const next = new Set(deletedProfileIds);
      next.add(selectedProfile.id);
      persistDeletedProfiles(next);
    }
    setSelectedProfileId(repositoryProfiles.find((profile) => profile.id !== selectedProfile.id)?.id ?? "");
    setSheetOpen(false);
    setConfirmAction(null);
  }

  function archiveProfile() {
    if (!selectedProfile) return;
    if (authenticated) {
      if (!selectedProfile.persisted) {
        toast({
          title: "Save the Position Profile first",
          description: "Save this profile as an admin record before archiving it.",
        });
        return;
      }
      updateProfile.mutate({
        id: selectedProfile.id,
        patch: {
          institutionalMemory: {
            ...selectedProfile.institutionalMemory,
            archivedAt: new Date().toISOString(),
            archivedBy: String(currentUserId),
          },
          riskSummary: "Archived by admin. Historical position data is retained for continuity review.",
        },
      });
      return;
    }
    deleteProfile();
  }

  function restoreProfile(profile = selectedProfile) {
    if (!profile || !profile.persisted) return;
    const { archivedAt, archivedBy, ...memory } = profile.institutionalMemory;
    void archivedAt;
    void archivedBy;
    updateProfile.mutate({
      id: profile.id,
      patch: {
        institutionalMemory: memory,
        riskSummary: "Restored by admin from archive.",
      },
    });
  }

  function saveAccessInventory(items: ProfileAccessItem[]) {
    if (!selectedProfile) return;
    if (!authenticated || !selectedProfile.persisted) {
      toast({
        title: "Save the Position Profile first",
        description: "Access inventory is stored on saved admin Position Profiles.",
      });
      return;
    }
    updateProfile.mutate({
      id: selectedProfile.id,
      patch: {
        institutionalMemory: {
          ...selectedProfile.institutionalMemory,
          accessItems: items,
        },
      },
    });
  }

  function addAccessItem() {
    if (!selectedProfile) return;
    const toolName = accessDraft.toolName.trim();
    if (!toolName) return;
    saveAccessInventory([
      ...selectedProfile.accessItems,
      {
        id: `access-${Date.now()}`,
        toolName,
        loginUrl: accessDraft.loginUrl.trim(),
        accountOwner: accessDraft.accountOwner.trim(),
        billingNotes: accessDraft.billingNotes.trim(),
        status: accessDraft.status,
        updatedAt: new Date().toISOString(),
      },
    ]);
    setAccessDraft({ toolName: "", loginUrl: "", accountOwner: "", billingNotes: "", status: "needs_grant" });
  }

  function openProfileSheet(profileId: string, tab: SheetTab = "overview") {
    setSelectedProfileId(profileId);
    setSheetTab(tab);
    setProfileTaskSearch("");
    setSelectedProfileTaskId(null);
    setSheetOpen(true);
  }

  function openTaskMemoryBuilder(profile: PositionProfile, prompt = "") {
    const nextDraft = emptyTaskMemoryDraft();
    if (prompt.trim()) {
      nextDraft.title = prompt.trim().slice(0, 160);
      nextDraft.objective = prompt.trim().slice(0, 1500);
    }
    setSelectedProfileId(profile.id);
    setTaskMemoryDraft(nextDraft);
    setTaskMemoryOpen(true);
  }

  function updateTaskMemoryStep(index: number, patch: Partial<TaskMemoryFormStep>) {
    setTaskMemoryDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    }));
  }

  function removeTaskMemoryStep(index: number) {
    setTaskMemoryDraft((current) => ({
      ...current,
      steps: current.steps.length <= 1 ? current.steps : current.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
  }

  function captureTaskMemoryFiles(fileList: FileList | null) {
    const captured = Array.from(fileList ?? []).map((file) => ({
      name: file.name,
      kind: classifyAttachment(file),
      size: file.size,
      contentType: file.type || "application/octet-stream",
      file,
    }));
    if (captured.length === 0) return;
    setTaskMemoryDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...captured].slice(0, 12),
    }));
  }

  function removeTaskMemoryAttachment(index: number) {
    setTaskMemoryDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function downloadTaskMemoryAttachment(memory: PositionProfileTaskMemory, attachmentId: Id) {
    if (!selectedProfile) return;
    try {
      const res = await apiRequest("GET", `/api/position-profiles/${selectedProfile.id}/task-memory/${memory.id}/attachments/${attachmentId}/download`);
      const data = (await res.json()) as { ok: boolean; url: string };
      if (data.url && typeof window !== "undefined") window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Could not open attachment",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }

  function toggleExpanded(profileId: string) {
    setExpandedProfileIds((current) => {
      if (current.has(profileId)) return new Set();
      return new Set([profileId]);
    });
  }

  function openAssignment(nextMode: "delegate" | "transfer", profile = selectedProfile) {
    const profileToAssign = profile ?? repositoryProfiles[0] ?? null;
    if (!profileToAssign) return;
    setMode(nextMode);
    setSelectedProfileId(profileToAssign.id);
    setTargetUserId(defaultTargetUserIdForProfile(profileToAssign, users, currentUserId));
    setAssignmentDialogOpen(true);
  }

  function exportProfiles(targetProfiles = repositoryProfiles) {
    const rows = [
      ["Role", "Holder", "Department", "Status", "Open work", "Recurring", "Readiness", "Last updated"],
      ...targetProfiles.map((profile) => [
        profile.title,
        profileAssignmentLabel(profile, users),
        profileDepartment(profile),
        profileStatusLabel(profile),
        String(profile.currentIncompleteTasks.length),
        String(profile.recurringTasks.length),
        `${profileReadiness(profile)}%`,
        formatDate(profile.lastUpdatedAt),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "donnit-position-profiles.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function selectAllVisible() {
    setSelectedBulkIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleSelectedIds.forEach((id) => next.delete(id));
      else visibleSelectedIds.forEach((id) => next.add(id));
      return next;
    });
  }

  return (
    <div className="position-profiles-shell overflow-hidden rounded-md border border-border bg-background" data-testid="panel-position-profiles">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="display-font text-xl font-bold text-foreground">Position Profiles</h1>
            <p className="mt-1 text-sm text-muted-foreground">A clean repository of role memory, work ownership, and transition readiness.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => exportProfiles()} data-testid="button-position-profile-export">
              <Download className="size-4" />
              Export
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!canManageProfiles} data-testid="button-position-profile-create">
              <ListPlus className="size-4" />
              New profile
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {!canManageProfiles && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Position Profiles are restricted to admins.
          </div>
        )}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/30 p-1" data-testid="position-profile-status-filters">
            {([
              ["all", "All", repositoryProfiles.length],
              ["active", "Active", activeProfiles.length],
              ["at_risk", "At risk", atRiskProfiles.length],
              ["vacant", "Vacant", vacantProfiles.length],
              ["archived", "Archived", archivedProfiles.length],
            ] as Array<[ProfileFilter, string, number]>).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setProfileListFilter(id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                  profileListFilter === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`button-position-profile-filter-${id}`}
              >
                {label} <span className="ml-1 tabular-nums">{count}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-0 xl:w-[340px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={profileListSearch}
              onChange={(event) => setProfileListSearch(event.target.value)}
              placeholder="Search roles, holders, tools, status"
              className="h-10 pl-9 text-sm"
              data-testid="input-position-profile-list-search"
            />
          </div>
        </div>

        {selectedBulkIds.size > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-neutral-950 px-3 py-2 text-white sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">{selectedBulkIds.size} selected</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setSelectedBulkIds(new Set())}>
                Clear
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => exportProfiles(bulkProfiles)}>
                Export
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={() => {
                  const first = bulkProfiles[0];
                  if (first) openAssignment("transfer", first);
                }}
                disabled={!canManageProfiles}
              >
                Transfer all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-200 hover:bg-red-500/20 hover:text-red-100"
                onClick={() => {
                  const first = bulkProfiles.find((profile) => !isProfileArchived(profile));
                  if (first) {
                    setSelectedProfileId(first.id);
                    setConfirmAction("archive");
                  }
                }}
                disabled={!canManageProfiles}
              >
                Archive
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div>
            <div className="w-full">
              <div className="grid grid-cols-[36px_minmax(130px,1.6fr)_minmax(108px,1fr)_minmax(88px,0.8fr)_86px_64px_90px_82px_44px] border-b border-border bg-muted/35 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                <label className="flex items-center">
                  <input type="checkbox" checked={allVisibleSelected} onChange={selectAllVisible} aria-label="Select all visible Position Profiles" />
                </label>
                <span>Role</span>
                <span>Holder</span>
                <span>Department</span>
                <span>Status</span>
                <span>Open work</span>
                <span>Readiness</span>
                <span>Last updated</span>
                <span className="sr-only">Expand</span>
              </div>
            </div>
            <div className="w-full" data-testid="position-profile-list">
              {repositoryProfiles.length === 0 ? (
                <EmptyState>No role memory yet. Create a profile or let Donnit build one as tasks are assigned and completed.</EmptyState>
              ) : visibleRepositoryProfiles.length === 0 ? (
                <EmptyState>No Position Profiles match that search.</EmptyState>
              ) : (
                visibleRepositoryProfiles.map((profile) => {
                  const expanded = expandedProfileIds.has(profile.id);
                  const readiness = profileReadiness(profile);
                  return (
                    <div key={profile.id} data-testid={`position-profile-row-${profile.id}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(profile.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") toggleExpanded(profile.id);
                        }}
                        className="grid grid-cols-[36px_minmax(130px,1.6fr)_minmax(108px,1fr)_minmax(88px,0.8fr)_86px_64px_90px_82px_44px] items-center border-b border-border px-3 py-3 text-sm transition hover:bg-muted/25"
                      >
                        <label className="flex items-center" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedBulkIds.has(profile.id)}
                            onChange={(event) => {
                              setSelectedBulkIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(profile.id);
                                else next.delete(profile.id);
                                return next;
                              });
                            }}
                            aria-label={`Select ${profile.title}`}
                          />
                        </label>
                        <div className="min-w-0 pr-3">
                          <p className="truncate font-semibold text-foreground">{profile.title}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{profile.recurringTasks.length} recurring / {profile.completedTasks.length} historical</p>
                        </div>
                        <p className="truncate pr-3 text-muted-foreground">{profileAssignmentLabel(profile, users)}</p>
                        <p className="truncate pr-3 text-muted-foreground">{profileDepartment(profile)}</p>
                        <StatusPill profile={profile} />
                        <p className="tabular-nums text-foreground">{profile.currentIncompleteTasks.length}</p>
                        <ReadinessMeter value={readiness} />
                        <p className="truncate text-xs text-muted-foreground">{formatDate(profile.lastUpdatedAt)}</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(profile.id);
                          }}
                          aria-label={expanded ? `Collapse ${profile.title}` : `Expand ${profile.title}`}
                          data-testid={`button-position-profile-row-actions-${profile.id}`}
                        >
                          <ChevronDown className={`size-4 transition ${expanded ? "rotate-180" : ""}`} />
                        </Button>
                      </div>
                      {expanded && (
                        <div className="border-b border-border bg-muted/15 py-4 pl-[72px] pr-4">
                          <div className="border-l-2 border-brand-green/70 pl-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Manage this profile</p>
                            <div className="flex flex-wrap gap-2">
                              <ActionButton icon={<Eye className="size-4" />} label="View profile" onClick={() => openProfileSheet(profile.id)} testId={`button-position-profile-view-${profile.id}`} />
                              <ActionButton icon={<ShieldCheck className="size-4" />} label="Task Profiles" onClick={() => openProfileSheet(profile.id, "recurring")} testId={`button-position-profile-task-memory-${profile.id}`} />
                              <ActionButton icon={<ListPlus className="size-4" />} label="Add workflow" onClick={() => openTaskMemoryBuilder(profile)} disabled={!canManageTaskMemoryForProfile(profile, currentUser, currentUserId, users)} testId={`button-position-profile-add-task-memory-${profile.id}`} />
                              <ActionButton icon={<UserCog className="size-4" />} label="Transfer ownership" primary onClick={() => openAssignment("transfer", profile)} disabled={!canManageProfiles} />
                              <ActionButton icon={<Edit3 className="size-4" />} label="Edit details" onClick={() => { setSelectedProfileId(profile.id); setEditTitle(profile.title); setEditStatus(profile.status); setEditOpen(true); }} disabled={!canManageProfiles} />
                              <ActionButton icon={<KeyRound className="size-4" />} label="Assign tools" onClick={() => { setSelectedProfileId(profile.id); setToolsOpen(true); }} disabled={!canManageProfiles} />
                              <ActionButton icon={<History className="size-4" />} label="Review history" onClick={() => openProfileSheet(profile.id, "activity")} />
                              <ActionButton icon={<Download className="size-4" />} label="Export" onClick={() => exportProfiles([profile])} />
                              <ActionButton icon={<GitMerge className="size-4" />} label="Merge" onClick={() => { setSelectedProfileId(profile.id); setMergeOpen(true); }} disabled={!canManageProfiles} />
                              <ActionButton icon={<Archive className="size-4" />} label={isProfileArchived(profile) ? "Restore" : "Archive"} danger onClick={() => { setSelectedProfileId(profile.id); isProfileArchived(profile) ? restoreProfile(profile) : setConfirmAction("archive"); }} disabled={!canManageProfiles} />
                              <ActionButton icon={<Trash2 className="size-4" />} label="Delete" danger onClick={() => { setSelectedProfileId(profile.id); setConfirmAction("delete"); }} disabled={!canManageProfiles} />
                            </div>
                            <div className="mt-4 grid gap-3 xl:grid-cols-3">
                              <TaskMemorySummaryCard profile={profile} onOpen={() => openProfileSheet(profile.id, "recurring")} onCreate={() => openTaskMemoryBuilder(profile)} canCreate={canManageTaskMemoryForProfile(profile, currentUser, currentUserId, users)} />
                              <MiniWorkCard title="Current tasks" icon={<ListChecks className="size-4" />} tasks={profile.currentIncompleteTasks} empty="No current work captured." onTaskOpen={(task) => setSelectedProfileTaskId(String(task.id))} />
                              <MiniWorkCard title="Recurring" icon={<Repeat2 className="size-4" />} tasks={profile.recurringTasks} empty="No recurring work mapped yet." onTaskOpen={(task) => setSelectedProfileTaskId(String(task.id))} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {sheetOpen && selectedProfile && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/25 p-4">
          <button className="absolute inset-0 cursor-default" aria-label="Close Position Profile details" onClick={() => setSheetOpen(false)} />
          <aside className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusPill profile={selectedProfile} />
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{profileReadiness(selectedProfile)}% ready</span>
                  </div>
                  <h2 className="truncate text-xl font-bold text-foreground">{selectedProfile.title}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {profileAssignmentLabel(selectedProfile, users)} / {profileDepartment(selectedProfile)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSheetOpen(false)} aria-label="Close Position Profile details">
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => openAssignment("transfer", selectedProfile)}
                  disabled={!canManageProfiles}
                  data-testid="button-position-profile-actions"
                >
                  <UserCog className="size-4" />
                  Transfer
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!canManageProfiles}>
                  <Edit3 className="size-4" />
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportProfiles([selectedProfile])}>
                  <Download className="size-4" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (isProfileArchived(selectedProfile) ? restoreProfile(selectedProfile) : setConfirmAction("archive"))}
                  disabled={!canManageProfiles}
                >
                  {isProfileArchived(selectedProfile) ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                  {isProfileArchived(selectedProfile) ? "Restore" : "Archive"}
                </Button>
              </div>
            </div>
            <div className="border-b border-border px-5 py-3" data-testid="panel-position-profile-search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={profileTaskSearch}
                  onChange={(event) => setProfileTaskSearch(event.target.value)}
                  placeholder="Search this profile"
                  className="h-9 pl-9 text-sm"
                  data-testid="input-position-profile-task-search"
                />
              </div>
              {normalizedProfileTaskSearch && (
                <div className="mt-3 rounded-md border border-border bg-muted/25 p-2" data-testid="position-profile-search-results">
                  {profileSearchResults.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">No profile results found.</p>
                  ) : (
                    <div className="grid gap-1.5">
                      {profileSearchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => result.taskId && setSelectedProfileTaskId(String(result.taskId))}
                          className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-left transition hover:bg-background"
                          data-testid={`button-position-profile-search-result-${result.id}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-foreground">{result.label}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{result.detail}</span>
                          </span>
                          <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                            {result.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-border px-5 py-2">
              {([
                ["overview", "Overview"],
                ["work", "Open work"],
                ["recurring", "Recurring"],
                ["memory", "How-to memory"],
                ["tools", "Tools & access"],
                ["activity", "Activity"],
              ] as Array<[SheetTab, string]>).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSheetTab(id)}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    sheetTab === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {sheetTab === "overview" && (
                <div className="space-y-4">
                  <div className="rounded-md border border-border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Handoff readiness</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {readinessDone} of {profileReadinessItems.length} continuity checkpoints are ready.
                        </p>
                      </div>
                      <ReadinessMeter value={profileReadiness(selectedProfile)} wide />
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <MetricTile label="Open" value={selectedProfile.currentIncompleteTasks.length} />
                    <MetricTile label="Recurring" value={selectedProfile.recurringTasks.length} />
                    <MetricTile label="Historical" value={selectedProfile.completedTasks.length} />
                    <MetricTile label="Tools" value={selectedProfile.accessItems.length || selectedProfile.tools.length} />
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <p className="mb-2 text-sm font-semibold text-foreground">Transition checklist</p>
                    <div className="space-y-2">
                      {profileReadinessItems.map((item) => (
                        <div key={item.label} className="flex items-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs">
                          <span className={`mt-0.5 flex size-4 items-center justify-center rounded-full ${item.done ? "bg-brand-green text-white" : "bg-muted text-muted-foreground"}`}>
                            {item.done ? <Check className="size-3" /> : ""}
                          </span>
                          <span>
                            <span className="block font-medium text-foreground">{item.label}</span>
                            <span className="text-muted-foreground">{item.detail}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {sheetTab === "work" && (
                <TaskListSection
                  title="Open work"
                  tasks={selectedProfile.currentIncompleteTasks}
                  empty="No open work is tied to this profile."
                  onTaskOpen={(task) => setSelectedProfileTaskId(String(task.id))}
                />
              )}
              {sheetTab === "recurring" && (
                <div className="space-y-3">
                  <InfoCard title="Task Profiles" icon={<ShieldCheck className="size-4" />}>
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3 rounded-md bg-brand-green/5 px-3 py-2">
                        <p className="text-xs leading-5 text-muted-foreground">
                          Build reusable workflows with ordered steps, tools, guidelines, and reference links. Each completed step can become the trigger for the next task.
                        </p>
                        <Button size="sm" onClick={() => openTaskMemoryBuilder(selectedProfile)} disabled={!canManageSelectedTaskMemory}>
                          <ListPlus className="size-4" />
                          Add workflow
                        </Button>
                      </div>
                      {taskMemoryQuery.isFetching ? (
                        <p className="text-xs text-muted-foreground">Loading stored task sequences...</p>
                      ) : taskMemories.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No Task Profile has been saved for this profile yet. Convert recurring work below to preserve the sequence, timing, and how-to context.
                        </p>
                      ) : (
                        taskMemories.map((memory) => (
                          <div key={String(memory.id)} className="rounded-md border border-border bg-muted/25 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-foreground">{memory.title}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {memory.cadence === "none" ? "Reusable sequence" : titleCase(memory.cadence)} / starts {memory.startOffsetDays} day{memory.startOffsetDays === 1 ? "" : "s"} before / v{memory.version}
                                </span>
                              </span>
                              <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                                {memory.steps.length} step{memory.steps.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            {memory.objective && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{memory.objective}</p>}
                            {memoryMetadataText(memory, "guidelines") && (
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">Guidelines:</span> {memoryMetadataText(memory, "guidelines")}
                              </p>
                            )}
                            {memoryMetadataText(memory, "attachmentReferences") && (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">References:</span> {memoryMetadataText(memory, "attachmentReferences")}
                              </p>
                            )}
                            {memoryAttachmentFiles(memory).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {memory.attachments.length > 0
                                  ? memory.attachments.slice(0, 4).map((file) => (
                                      <button
                                        key={String(file.id)}
                                        type="button"
                                        onClick={() => downloadTaskMemoryAttachment(memory, file.id)}
                                        className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                                      >
                                        <Paperclip className="size-3" />
                                        {file.fileName}
                                      </button>
                                    ))
                                  : memoryAttachmentFiles(memory).slice(0, 4).map((file) => (
                                      <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground">
                                        <Paperclip className="size-3" />
                                        {file.name}
                                      </span>
                                    ))}
                              </div>
                            )}
                            {memory.steps.length > 0 && (
                              <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                                {memory.steps.slice(0, 4).map((step, index) => (
                                  <li key={String(step.id)} className="flex gap-2">
                                    <span className="tabular-nums text-foreground">{index + 1}.</span>
                                    <span className="line-clamp-1">{step.title}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </InfoCard>
                  <TaskListSection
                    title="Recurring tasks"
                    tasks={selectedProfile.recurringTasks}
                    empty="No recurring tasks are tied to this profile yet."
                    onTaskOpen={(task) => setSelectedProfileTaskId(String(task.id))}
                    actionLabel="Save as Task Profile"
                    actionPendingId={createTaskMemoryFromTask.isPending ? "pending" : null}
                    onTaskAction={canManageSelectedTaskMemory ? (task) => createTaskMemoryFromTask.mutate(task) : undefined}
                  />
                  {learnedRecurringResponsibilities.length > 0 && (
                    <div className="rounded-md border border-border p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">Learned recurring responsibilities</p>
                      <div className="space-y-2">
                        {learnedRecurringResponsibilities.slice(0, 6).map((item) => (
                          <button
                            key={`${item.taskId}-${item.title}`}
                            type="button"
                            onClick={() => item.taskId && setSelectedProfileTaskId(String(item.taskId))}
                            className="w-full rounded-md bg-muted/30 px-3 py-2 text-left text-xs hover:bg-muted"
                          >
                            <span className="block font-medium text-foreground">{item.title}</span>
                            <span className="text-muted-foreground">{item.repeatDetails || item.cadence || "Recurring responsibility"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {sheetTab === "memory" && (
                <div className="space-y-3">
                  <InfoCard title="How-to notes" icon={<FileText className="size-4" />}>
                    {selectedProfile.howTo.length === 0 && learnedHowToNotes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Completion notes and task updates will appear here as practical instructions for the next person in this role.</p>
                    ) : (
                      <ul className="space-y-2 text-xs text-muted-foreground">
                        {[...selectedProfile.howTo, ...learnedHowToNotes.map((item) => `${item.title}: ${item.note}`)].slice(0, 10).map((item) => (
                          <li key={item} className="rounded-md bg-muted/30 px-3 py-2">{item}</li>
                        ))}
                      </ul>
                    )}
                  </InfoCard>
                  {lastLearnedAt && <p className="text-xs text-muted-foreground">Last learned {formatDate(lastLearnedAt)}.</p>}
                </div>
              )}
              {sheetTab === "tools" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Tools & access</p>
                    <Button size="sm" variant="outline" onClick={() => setToolsOpen(true)} disabled={!canManageProfiles}>
                      <KeyRound className="size-4" />
                      Manage tools
                    </Button>
                  </div>
                  <ToolsList profile={selectedProfile} />
                </div>
              )}
              {sheetTab === "activity" && (
                <div className="space-y-3">
                  <TaskListSection
                    title="Historical task memory"
                    tasks={selectedProfile.completedTasks}
                    empty="No completed work has been captured for this profile yet."
                    onTaskOpen={(task) => setSelectedProfileTaskId(String(task.id))}
                  />
                  {learnedTaskSignals.length > 0 && (
                    <InfoCard title="Recent learned signals" icon={<ShieldCheck className="size-4" />}>
                      <div className="space-y-2">
                        {learnedTaskSignals.slice(0, 6).map((item) => (
                          <button
                            key={`${item.taskId}-${item.eventType}`}
                            type="button"
                            onClick={() => item.taskId && setSelectedProfileTaskId(String(item.taskId))}
                            className="w-full rounded-md bg-muted/30 px-3 py-2 text-left text-xs hover:bg-muted"
                          >
                            <span className="block font-medium text-foreground">{item.title}</span>
                            <span className="text-muted-foreground">{titleCase(item.eventType)} / {titleCase(item.source)} / {urgencyLabel(item.urgency)}</span>
                          </button>
                        ))}
                      </div>
                    </InfoCard>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      <Dialog open={taskMemoryOpen} onOpenChange={setTaskMemoryOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-5xl`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Add Task Profile workflow</DialogTitle>
            <DialogDescription>
              Save a repeatable task sequence for {selectedProfile?.title ?? "this profile"} so future holders can complete the outcome step by step.
            </DialogDescription>
          </DialogHeader>
          <form
            className={`${dialogBodyClass} space-y-5`}
            onSubmit={(event) => {
              event.preventDefault();
              if (!taskMemoryDraft.title.trim()) {
                toast({ title: "Name the workflow", description: "Task Profile needs a clear outcome title.", variant: "destructive" });
                return;
              }
              if (!taskMemoryDraft.steps.some((step) => step.title.trim())) {
                toast({ title: "Add at least one step", description: "Task Profile should guide the next person through the work.", variant: "destructive" });
                return;
              }
              createTaskMemory.mutate(taskMemoryDraft);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="task-memory-profile">Position Profile</Label>
              <select
                id="task-memory-profile"
                value={selectedProfile?.id ?? ""}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-task-memory-profile"
              >
                {repositoryProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.title} / {profileAssignmentLabel(profile, users)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="task-memory-title">Workflow name</Label>
                  <Input
                    id="task-memory-title"
                    value={taskMemoryDraft.title}
                    onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Monthly CEO financial report"
                    maxLength={160}
                    data-testid="input-task-memory-title"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="task-memory-objective">Desired outcome</Label>
                  <Textarea
                    id="task-memory-objective"
                    value={taskMemoryDraft.objective}
                    onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, objective: event.target.value }))}
                    placeholder="Produce the financial report packet the CEO receives each month, with payroll, P&L, revenue, and EBITDA updates."
                    rows={3}
                    maxLength={1500}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="task-memory-cadence">Repeat</Label>
                    <select
                      id="task-memory-cadence"
                      value={taskMemoryDraft.cadence}
                      onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, cadence: event.target.value as TaskMemoryDraft["cadence"] }))}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="none">As needed</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-memory-start-offset">Start days before</Label>
                    <Input
                      id="task-memory-start-offset"
                      type="number"
                      min={0}
                      max={365}
                      value={taskMemoryDraft.startOffsetDays}
                      onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, startOffsetDays: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-memory-minutes">Default minutes</Label>
                    <Input
                      id="task-memory-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={taskMemoryDraft.defaultEstimatedMinutes}
                      onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, defaultEstimatedMinutes: Number(event.target.value) }))}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="task-memory-urgency">Default urgency</Label>
                    <select
                      id="task-memory-urgency"
                      value={taskMemoryDraft.defaultUrgency}
                      onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, defaultUrgency: event.target.value as TaskMemoryDraft["defaultUrgency"] }))}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-memory-due-rule">Timing rule</Label>
                    <Input
                      id="task-memory-due-rule"
                      value={taskMemoryDraft.dueRule}
                      onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, dueRule: event.target.value }))}
                      placeholder="First business day of each month, start 5 days before"
                      maxLength={500}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="task-memory-guidelines">Guidelines</Label>
                  <Textarea
                    id="task-memory-guidelines"
                    value={taskMemoryDraft.guidelines}
                    onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, guidelines: event.target.value }))}
                    placeholder="Formatting rules, approval expectations, quality bar, and anything that should stay consistent."
                    rows={4}
                    maxLength={4000}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="task-memory-important-info">Important information</Label>
                  <Textarea
                    id="task-memory-important-info"
                    value={taskMemoryDraft.importantInformation}
                    onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, importantInformation: event.target.value }))}
                    placeholder="Key contacts, judgment calls, exceptions, passwords stored elsewhere, or things that break first."
                    rows={4}
                    maxLength={4000}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="task-memory-attachments">Attachments / references</Label>
                  <div className="rounded-md border border-border bg-background p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Textarea
                        id="task-memory-attachments"
                        value={taskMemoryDraft.attachmentReferences}
                        onChange={(event) => setTaskMemoryDraft((current) => ({ ...current, attachmentReferences: event.target.value }))}
                        placeholder="Paste links, filenames, folder paths, or source systems."
                        rows={3}
                        maxLength={4000}
                      />
                      <Button type="button" variant="outline" onClick={() => taskMemoryAttachmentInputRef.current?.click()}>
                        <Paperclip className="size-4" />
                        Choose files
                      </Button>
                      <input
                        ref={taskMemoryAttachmentInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          captureTaskMemoryFiles(event.target.files);
                          event.target.value = "";
                        }}
                        data-testid="input-task-memory-attachments"
                      />
                    </div>
                    <div
                      className={`mt-2 rounded-md border border-dashed px-3 py-3 text-xs transition ${
                        taskMemoryDraggingFiles ? "border-brand-green bg-brand-green/10" : "border-border bg-muted/30"
                      }`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setTaskMemoryDraggingFiles(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setTaskMemoryDraggingFiles(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        setTaskMemoryDraggingFiles(false);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        captureTaskMemoryFiles(event.dataTransfer.files);
                        setTaskMemoryDraggingFiles(false);
                      }}
                      data-testid="dropzone-task-memory-attachments"
                    >
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <Paperclip className="size-3.5" />
                        Drop files here
                      </div>
                      {taskMemoryDraft.attachments.length > 0 ? (
                        <div className="mt-2 space-y-1">
                          {taskMemoryDraft.attachments.map((file, index) => (
                            <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1">
                              <span className="min-w-0 truncate">{file.name}</span>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">{file.kind}</span>
                                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => removeTaskMemoryAttachment(index)} aria-label={`Remove ${file.name}`}>
                                  <X className="size-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Chosen files are recorded with this Task Profile workflow.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Workflow steps</p>
                  <p className="text-xs text-muted-foreground">Each step can become the next task after the prior step is completed.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setTaskMemoryDraft((current) => ({ ...current, steps: [...current.steps, emptyTaskMemoryStep(current.steps.length)] }))}
                >
                  <ListPlus className="size-4" />
                  Add step
                </Button>
              </div>
              <div className="space-y-3">
                {taskMemoryDraft.steps.map((step, index) => (
                  <div key={index} className="rounded-md bg-muted/30 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Step {index + 1}</p>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeTaskMemoryStep(index)} disabled={taskMemoryDraft.steps.length <= 1}>
                        Remove
                      </Button>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Step title</Label>
                        <Input value={step.title} onChange={(event) => updateTaskMemoryStep(index, { title: event.target.value })} maxLength={180} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Tool</Label>
                          <Input value={step.toolName} onChange={(event) => updateTaskMemoryStep(index, { toolName: event.target.value })} placeholder="Payroll system" maxLength={160} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Link</Label>
                          <Input value={step.toolUrl} onChange={(event) => updateTaskMemoryStep(index, { toolUrl: event.target.value })} placeholder="https://..." maxLength={500} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Instructions</Label>
                        <Textarea value={step.instructions} onChange={(event) => updateTaskMemoryStep(index, { instructions: event.target.value })} rows={3} maxLength={4000} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Expected output</Label>
                        <Textarea value={step.expectedOutput} onChange={(event) => updateTaskMemoryStep(index, { expectedOutput: event.target.value })} rows={3} maxLength={1000} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Due offset days</Label>
                          <Input type="number" min={-365} max={365} value={step.relativeDueOffsetDays} onChange={(event) => updateTaskMemoryStep(index, { relativeDueOffsetDays: Number(event.target.value) })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Minutes</Label>
                          <Input type="number" min={5} max={1440} value={step.estimatedMinutes} onChange={(event) => updateTaskMemoryStep(index, { estimatedMinutes: Number(event.target.value) })} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className={dialogFooterClass}>
              <Button type="button" variant="outline" onClick={() => setTaskMemoryOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createTaskMemory.isPending || !canManageSelectedTaskMemory}>
                {createTaskMemory.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Save workflow
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TaskDetailDialog
        task={selectedProfileTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        positionProfiles={repositoryProfiles}
        open={Boolean(selectedProfileTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedProfileTaskId(null);
        }}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-lg`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Create Position Profile</DialogTitle>
            <DialogDescription>Create a job-title profile that can hold recurring work, history, and transition memory.</DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} space-y-3`}>
            <div className="space-y-1.5">
              <Label htmlFor="position-profile-title">Profile title</Label>
              <Input
                id="position-profile-title"
                value={newProfileTitle}
                onChange={(event) => setNewProfileTitle(event.target.value)}
                placeholder="Executive Assistant to the CEO"
                maxLength={160}
                data-testid="input-position-profile-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="position-profile-owner">Current owner</Label>
              <select
                id="position-profile-owner"
                value={newProfileOwnerId}
                onChange={(event) => setNewProfileOwnerId(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                data-testid="select-position-profile-owner"
              >
                {authenticated && <option value="">Vacant / no current owner</option>}
                {users.map((user) => (
                  <option key={String(user.id)} value={String(user.id)}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createProfile.isPending}>Cancel</Button>
            <Button onClick={addProfile} disabled={newProfileTitle.trim().length < 2 || createProfile.isPending} data-testid="button-position-profile-add">
              {createProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
              Add profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen && Boolean(selectedProfile)} onOpenChange={setEditOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-lg`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Edit profile details</DialogTitle>
            <DialogDescription>Keep the repository label and high-level state clean for admins.</DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} space-y-3`}>
            <div className="space-y-1.5">
              <Label htmlFor="position-profile-edit-title">Profile title</Label>
              <Input id="position-profile-edit-title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} data-testid="input-position-profile-rename" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="position-profile-edit-status">Status</Label>
              <select
                id="position-profile-edit-status"
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value as "active" | "vacant" | "covered")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                data-testid="select-position-profile-status"
              >
                <option value="active">Active</option>
                <option value="vacant">Vacant</option>
                <option value="covered">Covered</option>
              </select>
            </div>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateProfile.isPending}>Cancel</Button>
            <Button onClick={saveProfileEdits} disabled={editTitle.trim().length < 2 || updateProfile.isPending}>
              {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignmentDialogOpen && Boolean(selectedProfile)} onOpenChange={setAssignmentDialogOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-2xl`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>{mode === "transfer" ? "Transfer Position Profile" : "Delegate Position Profile"}</DialogTitle>
            <DialogDescription>
              Choose who should receive {selectedProfile?.title ?? "this profile"}. Employees can own more than one Position Profile.
            </DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} space-y-4`}>
            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-2">
              <div>
                <p className="ui-label">Selected profile</p>
                <select
                  value={selectedProfile?.id ?? ""}
                  onChange={(event) => {
                    const nextProfileId = event.target.value;
                    const nextProfile = repositoryProfiles.find((profile) => profile.id === nextProfileId) ?? null;
                    setSelectedProfileId(nextProfileId);
                    setTargetUserId(defaultTargetUserIdForProfile(nextProfile, users, currentUserId));
                  }}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground"
                  data-testid="select-profile-transfer-profile"
                >
                  {repositoryProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.title} - {profileAssignmentLabel(profile, users)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">Current owner: {selectedProfile ? profileAssignmentLabel(selectedProfile, users) : "Not selected"}</p>
              </div>
              <div>
                <p className="ui-label">Transition type</p>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "delegate" | "transfer")}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground"
                  data-testid="select-profile-transfer-mode"
                >
                  <option value="transfer">Transfer ownership</option>
                  <option value="delegate">Delegate temporary coverage</option>
                </select>
                {mode === "delegate" && (
                  <Input
                    type="date"
                    value={delegateUntil}
                    onChange={(event) => setDelegateUntil(event.target.value)}
                    className="mt-2 h-9 text-xs"
                    data-testid="input-profile-transfer-delegate-until"
                  />
                )}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-3" data-testid="panel-profile-transfer-preview">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Continuity preview</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Donnit will move current role work, preserve recurring timing, and keep historical context available behind the task history toggle.
                  </p>
                </div>
                {assignmentPreviewQuery.isFetching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
              </div>
              {assignmentPreviewQuery.isError ? (
                <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  Could not load the preview. The transfer can still run, but review the profile after it finishes.
                </p>
              ) : assignmentPreview ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <MetricTile label="Will move" value={assignmentPreview.summary.activeTasks} />
                    <MetricTile label="Recurring" value={assignmentPreview.summary.recurringTasks} />
                    <MetricTile label="History" value={assignmentPreview.summary.historicalTasks} />
                    <MetricTile label="Excluded" value={assignmentPreview.summary.personalTasksExcluded} />
                  </div>
                  {assignmentPreview.includedTasks.length > 0 ? (
                    <div className="space-y-1.5">
                      {assignmentPreview.includedTasks.slice(0, 4).map((task) => (
                        <div key={task.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/45 px-3 py-2 text-xs">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{task.title}</span>
                            <span className="block truncate text-muted-foreground">
                              {task.dueDate ?? "No date"} / {urgencyLabel(task.urgency)} / {task.recurrence === "none" ? "one-time" : task.recurrence}
                              {task.visibleFrom ? ` / visible ${task.visibleFrom}` : ""}
                            </span>
                          </span>
                          {task.visibility === "confidential" && <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700">Confidential</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No active profile tasks will move. Historical context will remain attached to the profile.
                    </p>
                  )}
                  {assignmentPreview.warnings.length > 0 && (
                    <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                      {assignmentPreview.warnings.map((warning) => (
                        <li key={warning} className="flex gap-2">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Choose a target employee to preview the transition.</p>
              )}
            </div>
            <div className="grid gap-3">
              {assignmentUsers.map((user) => {
                const userProfiles = profilesForUser(repositoryProfiles, user.id);
                const isCurrentOwner = selectedProfile && String(profilePrimaryOwnerId(selectedProfile)) === String(user.id);
                const isSelected = String(targetUserId) === String(user.id);
                return (
                  <button
                    key={String(user.id)}
                    type="button"
                    onClick={() => setTargetUserId(String(user.id))}
                    disabled={Boolean(isCurrentOwner && mode === "transfer")}
                    className={`rounded-md border px-3 py-3 text-left transition ${
                      isSelected ? "border-brand-green bg-brand-green/10" : "border-border bg-background hover:border-brand-green/60 hover:bg-muted/40"
                    } ${isCurrentOwner && mode === "transfer" ? "cursor-not-allowed opacity-60" : ""}`}
                    data-testid={`button-profile-transfer-target-${user.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{user.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{titleCase(user.role)} {isCurrentOwner ? "/ current owner" : ""}</p>
                      </div>
                      {isSelected && <Check className="size-4 shrink-0 text-brand-green" />}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {userProfiles.length === 0 ? (
                        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">No assigned Position Profiles</span>
                      ) : (
                        userProfiles.map((profile) => (
                          <span key={profile.id} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                            {profile.title}
                            {String(profile.delegateUserId ?? "") === String(user.id) ? " (delegate)" : ""}
                            {String(profile.temporaryOwnerId ?? "") === String(user.id) ? " (coverage)" : ""}
                          </span>
                        ))
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setAssignmentDialogOpen(false)} disabled={assign.isPending}>Cancel</Button>
            <Button onClick={() => assign.mutate()} disabled={!targetUserId || assign.isPending || !canManageProfiles} data-testid="button-profile-transfer-confirm">
              {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserCog className="size-4" />}
              {mode === "transfer" ? "Transfer profile" : "Start coverage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toolsOpen && Boolean(selectedProfile)} onOpenChange={setToolsOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-2xl`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Assign tools</DialogTitle>
            <DialogDescription>Track systems, access owners, billing notes, and reset status for this role.</DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} space-y-3`}>
            {selectedProfile && <ToolsList profile={selectedProfile} />}
            <div className="grid gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={accessDraft.toolName} onChange={(event) => setAccessDraft((current) => ({ ...current, toolName: event.target.value }))} placeholder="Tool or account" className="h-8 text-xs" data-testid="input-profile-access-tool" />
                <Input value={accessDraft.loginUrl} onChange={(event) => setAccessDraft((current) => ({ ...current, loginUrl: event.target.value }))} placeholder="Login URL or vault reference" className="h-8 text-xs" data-testid="input-profile-access-url" />
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
                <Input value={accessDraft.accountOwner} onChange={(event) => setAccessDraft((current) => ({ ...current, accountOwner: event.target.value }))} placeholder="Owner/contact" className="h-8 text-xs" data-testid="input-profile-access-owner" />
                <Input value={accessDraft.billingNotes} onChange={(event) => setAccessDraft((current) => ({ ...current, billingNotes: event.target.value }))} placeholder="Billing or reset notes" className="h-8 text-xs" data-testid="input-profile-access-notes" />
                <select value={accessDraft.status} onChange={(event) => setAccessDraft((current) => ({ ...current, status: event.target.value as ProfileAccessItem["status"] }))} className="h-8 rounded-md border border-input bg-background px-2 text-xs" data-testid="select-profile-access-status">
                  <option value="needs_grant">Grant access</option>
                  <option value="needs_reset">Reset needed</option>
                  <option value="remove_access">Remove access</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setToolsOpen(false)} disabled={updateProfile.isPending}>Close</Button>
            <Button onClick={addAccessItem} disabled={accessDraft.toolName.trim().length < 2 || updateProfile.isPending} data-testid="button-profile-access-add">
              {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
              Add access item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen && Boolean(selectedProfile)} onOpenChange={setMergeOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-lg`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Merge Position Profiles</DialogTitle>
            <DialogDescription>Merge is intentionally gated so role memory is not combined accidentally.</DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground`}>
            Choose the source and destination profile during the full UI refresh. For this MVP pass, use Export to review overlap before deletion or transfer.
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button onClick={() => setMergeOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmAction && selectedProfile)} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className={`${dialogShellClass} sm:max-w-md`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>{confirmAction === "delete" ? "Delete Position Profile?" : "Archive Position Profile?"}</DialogTitle>
            <DialogDescription>
              {confirmAction === "delete"
                ? "Deleting removes the saved admin record. Use archive when you want to keep historical continuity data."
                : "Archiving hides the profile from active work while retaining historical continuity data."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant={confirmAction === "delete" ? "destructive" : "default"} onClick={confirmAction === "delete" ? deleteProfile : archiveProfile} disabled={updateProfile.isPending || deletePersistedProfile.isPending}>
              {updateProfile.isPending || deletePersistedProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : confirmAction === "delete" ? <Trash2 className="size-4" /> : <Archive className="size-4" />}
              {confirmAction === "delete" ? "Delete" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function emptyProfileBase(owner: User): Omit<PositionProfile, "id" | "title" | "owner"> {
  return {
    persisted: false,
    currentOwnerId: owner.id,
    directManagerId: owner.managerId,
    temporaryOwnerId: null,
    delegateUserId: null,
    delegateUntil: null,
    status: "active",
    currentIncompleteTasks: [],
    recurringTasks: [],
    completedTasks: [],
    criticalDates: [],
    howTo: [],
    tools: [],
    stakeholders: [],
    accessItems: [],
    institutionalMemory: {},
    riskScore: 0,
    riskLevel: "low",
    riskReasons: [],
    transitionChecklist: [
      "Assign an owner for this job title.",
      "Add recurring responsibilities as they are discovered.",
      "Attach tool access and account ownership details.",
    ],
    lastUpdatedAt: null,
  };
}

function isProfileArchived(profile: PositionProfile) {
  return typeof profile.institutionalMemory.archivedAt === "string";
}

function profileStatusKey(profile: PositionProfile): "active" | "covered" | "at_risk" | "vacant" | "archived" {
  if (isProfileArchived(profile)) return "archived";
  if (profile.status === "vacant" || !profile.currentOwnerId) return "vacant";
  if (profile.status === "covered" || profile.delegateUserId || profile.temporaryOwnerId) return "covered";
  if (profile.riskScore >= 60) return "at_risk";
  return "active";
}

function profileStatusLabel(profile: PositionProfile) {
  const key = profileStatusKey(profile);
  if (key === "at_risk") return "At risk";
  return titleCase(key);
}

function profileReadiness(profile: PositionProfile) {
  return Math.max(0, Math.min(100, 100 - Math.round(profile.riskScore)));
}

function profileDepartment(profile: PositionProfile) {
  const memory = profile.institutionalMemory;
  if (typeof memory.department === "string" && memory.department.trim()) return memory.department.trim();
  if (typeof memory.team === "string" && memory.team.trim()) return memory.team.trim();
  if (profile.owner.role && profile.owner.role !== "member") return titleCase(profile.owner.role);
  const title = profile.title.toLowerCase();
  if (title.includes("finance") || title.includes("payroll")) return "Finance";
  if (title.includes("sales") || title.includes("client")) return "Revenue";
  if (title.includes("hr") || title.includes("people")) return "People";
  return "Operations";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function assignableUsersForProfile(profile: PositionProfile | null | undefined, users: User[]) {
  return users.filter(
    (user) =>
      profile &&
      isActiveUser(user) &&
      (!profile.currentOwnerId || String(user.id) !== String(profile.currentOwnerId)),
  );
}

function defaultTargetUserIdForProfile(profile: PositionProfile | null | undefined, users: User[], currentUserId: Id) {
  const candidates = assignableUsersForProfile(profile, users);
  const currentUserCandidate = candidates.find((user) => String(user.id) === String(currentUserId));
  return String((currentUserCandidate ?? candidates[0])?.id ?? "");
}

function canManageTaskMemoryForProfile(profile: PositionProfile, currentUser: User | null | undefined, currentUserId: Id, users: User[]) {
  if (!currentUser) return false;
  if (currentUser.role === "owner" || currentUser.role === "admin") return true;
  const actorId = String(currentUserId);
  if (
    String(profile.currentOwnerId ?? "") === actorId ||
    String(profile.temporaryOwnerId ?? "") === actorId ||
    String(profile.delegateUserId ?? "") === actorId ||
    String(profile.directManagerId ?? "") === actorId
  ) {
    return true;
  }
  if (currentUser.role !== "manager") return false;
  const owner = users.find((user) => String(user.id) === String(profile.currentOwnerId ?? ""));
  return String(owner?.managerId ?? "") === actorId;
}

function memoryMetadataText(memory: PositionProfileTaskMemory, key: "guidelines" | "importantInformation" | "attachmentReferences") {
  const value = memory.learnedFrom?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function memoryAttachmentFiles(memory: PositionProfileTaskMemory): CapturedAttachment[] {
  if (memory.attachments?.length > 0) {
    return memory.attachments.map((attachment) => ({
      name: attachment.fileName,
      kind: attachment.kind,
      size: attachment.fileSize,
      contentType: attachment.contentType,
    }));
  }
  const value = memory.learnedFrom?.attachmentFiles;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<CapturedAttachment>;
      if (!record.name || !record.kind) return null;
      return {
        name: String(record.name),
        kind: ["Document", "Image", "Spreadsheet", "Other"].includes(String(record.kind)) ? record.kind : "Other",
        size: Number(record.size ?? 0),
        contentType: String((record as { contentType?: unknown }).contentType ?? "application/octet-stream"),
      } satisfies CapturedAttachment;
    })
    .filter((item): item is CapturedAttachment => Boolean(item));
}

function buildReadinessItems(profile: PositionProfile, users: User[], learnedHowToCount: number, recurringGapCount: number) {
  const ownerId = profilePrimaryOwnerId(profile);
  const owner = ownerId ? users.find((user) => String(user.id) === String(ownerId)) : null;
  const temporary = users.find((user) => String(user.id) === String(profile.temporaryOwnerId));
  const delegate = users.find((user) => String(user.id) === String(profile.delegateUserId));
  return [
    {
      label: "Owner or coverage assigned",
      detail: temporary ? `Temporarily covered by ${temporary.name}` : delegate ? `Delegated to ${delegate.name}` : owner ? `Owned by ${owner.name}` : "No owner assigned",
      done: Boolean(owner || temporary || delegate),
    },
    {
      label: "Current work captured",
      detail: `${profile.currentIncompleteTasks.length} open task${profile.currentIncompleteTasks.length === 1 ? "" : "s"}`,
      done: profile.currentIncompleteTasks.length > 0 || profile.completedTasks.length > 0,
    },
    {
      label: "Recurring work mapped",
      detail: `${profile.recurringTasks.length} recurring responsibilit${profile.recurringTasks.length === 1 ? "y" : "ies"}`,
      done: profile.recurringTasks.length > 0,
    },
    {
      label: "Historical memory available",
      detail: `${profile.completedTasks.length} historical task${profile.completedTasks.length === 1 ? "" : "s"} plus ${learnedHowToCount} how-to note${learnedHowToCount === 1 ? "" : "s"}`,
      done: profile.completedTasks.length > 0 || learnedHowToCount > 0,
    },
    {
      label: "Recurring how-to context",
      detail: recurringGapCount === 0 ? "No recurring context gaps detected" : `${recurringGapCount} recurring item${recurringGapCount === 1 ? "" : "s"} need notes`,
      done: profile.recurringTasks.length > 0 && recurringGapCount === 0,
    },
    {
      label: "Tool access documented",
      detail: `${profile.accessItems.length} access item${profile.accessItems.length === 1 ? "" : "s"} recorded`,
      done: profile.accessItems.length > 0,
    },
  ];
}

function buildProfileSearchResults({
  profile,
  users,
  query,
  tasks,
  learnedHowToNotes,
  learnedRecurringResponsibilities,
  learnedTaskSignals,
}: {
  profile: PositionProfile;
  users: User[];
  query: string;
  tasks: Task[];
  learnedHowToNotes: Array<{ title: string; note: string; taskId?: Id | null }>;
  learnedRecurringResponsibilities: Array<{ title: string; cadence?: string | null; repeatDetails?: string | null; dueDate?: string | null; taskId?: Id | null }>;
  learnedTaskSignals: Array<{ title: string; eventType: string; source: string; urgency: string; taskId?: Id | null }>;
}) {
  const results: Array<{ id: string; label: string; detail: string; type: string; taskId?: Id | null }> = [];
  const matches = (parts: Array<string | number | null | undefined>) =>
    parts.filter((part) => part !== null && part !== undefined).join(" ").toLowerCase().includes(query);
  const add = (item: { id: string; label: string; detail: string; type: string; taskId?: Id | null }) => {
    if (!results.some((result) => result.id === item.id)) results.push(item);
  };

  if (matches([profile.title, profile.status, profileDepartment(profile), profileAssignmentLabel(profile, users)])) {
    add({ id: "profile-summary", type: "Profile", label: profile.title, detail: `${profileAssignmentLabel(profile, users)} / ${profileStatusLabel(profile)}` });
  }
  tasks.forEach((task) => {
    if (!matches([task.title, task.description, richNoteToPlainText(task.completionNotes), task.source, task.status, task.urgency, task.dueDate, taskRepeatLabel(task)])) return;
    add({
      id: `task-${task.id}`,
      type: task.status === "completed" ? "History" : task.recurrence !== "none" ? "Recurring task" : "Task",
      label: task.title,
      detail: `${task.dueDate ?? "No date"} / ${urgencyLabel(task.urgency)} / ${task.source}`,
      taskId: task.id,
    });
  });
  profile.howTo.forEach((item, index) => {
    if (matches([item])) add({ id: `how-to-${index}`, type: "How-to", label: item, detail: "Saved instruction" });
  });
  profile.tools.forEach((item, index) => {
    if (matches([item])) add({ id: `tool-${index}`, type: "Tool", label: item, detail: "Tool access summary" });
  });
  profile.stakeholders.forEach((item, index) => {
    if (matches([item])) add({ id: `stakeholder-${index}`, type: "Contact", label: item, detail: "Role relationship" });
  });
  profile.accessItems.forEach((item) => {
    if (!matches([item.toolName, item.loginUrl, item.accountOwner, item.billingNotes, item.status])) return;
    add({ id: `access-${item.id}`, type: "Access", label: item.toolName, detail: `${item.accountOwner || "No owner noted"} / ${accessStatusLabels[item.status]}` });
  });
  learnedRecurringResponsibilities.forEach((item) => {
    if (!matches([item.title, item.cadence, item.repeatDetails, item.dueDate])) return;
    add({ id: `learned-recurring-${item.taskId}-${item.title}`, type: "Learned recurring", label: item.title, detail: item.repeatDetails || item.cadence || "Recurring responsibility", taskId: item.taskId });
  });
  learnedHowToNotes.forEach((item) => {
    if (!matches([item.title, item.note])) return;
    add({ id: `learned-how-to-${item.taskId}-${item.note}`, type: "Learned note", label: item.title, detail: item.note, taskId: item.taskId });
  });
  learnedTaskSignals.forEach((item) => {
    if (!matches([item.title, item.eventType, item.source, item.urgency])) return;
    add({ id: `signal-${item.taskId}-${item.eventType}`, type: "Signal", label: item.title, detail: `${titleCase(item.eventType)} / ${titleCase(item.source)} / ${urgencyLabel(item.urgency)}`, taskId: item.taskId });
  });
  return results.slice(0, 12);
}

function StatusPill({ profile }: { profile: PositionProfile }) {
  const key = profileStatusKey(profile);
  const tone =
    key === "active"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : key === "covered"
        ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
        : key === "at_risk"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : key === "vacant"
            ? "bg-red-500/10 text-red-700 dark:text-red-300"
            : "bg-muted text-muted-foreground";
  return <span className={`inline-flex w-fit rounded-md px-2 py-1 text-[11px] font-semibold ${tone}`}>{profileStatusLabel(profile)}</span>;
}

function ReadinessMeter({ value, wide = false }: { value: number; wide?: boolean }) {
  const tone = value >= 80 ? "bg-brand-green" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={wide ? "w-36" : "w-24"}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  primary = false,
  danger = false,
  testId,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      variant={primary ? "default" : danger ? "outline" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={danger ? "border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950" : ""}
      data-testid={testId}
    >
      {icon}
      {label}
    </Button>
  );
}

function MiniWorkCard({
  title,
  icon,
  tasks,
  empty,
  onTaskOpen,
}: {
  title: string;
  icon: ReactNode;
  tasks: Task[];
  empty: string;
  onTaskOpen: (task: Task) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold text-foreground">{icon}{title}</p>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1">
          {tasks.slice(0, 4).map((task) => (
            <button key={String(task.id)} type="button" onClick={() => onTaskOpen(task)} className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">{task.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{task.dueDate ?? "No date"} / {urgencyLabel(task.urgency)}</span>
              </span>
              <Eye className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskMemorySummaryCard({
  profile,
  onOpen,
  onCreate,
  canCreate,
}: {
  profile: PositionProfile;
  onOpen: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const sequenceCount = profile.recurringTasks.length;
  const historicalCount = profile.completedTasks.length;
  return (
    <div
      className="rounded-md border border-brand-green/40 bg-brand-green/5 p-3 text-left"
      data-testid={`button-position-profile-task-memory-card-${profile.id}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <ShieldCheck className="size-4 text-brand-green" />
          Task Profiles
        </p>
        <span className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground">
          {sequenceCount} source{sequenceCount === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Store repeatable work as step-by-step workflows. Completed steps can trigger the next task for the profile holder.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-background/80 px-2 py-1">
          {sequenceCount} recurring
        </span>
        <span className="rounded-md bg-background/80 px-2 py-1">
          {historicalCount} historical
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={onOpen}>
          Open
        </Button>
        <Button type="button" size="sm" className="h-8 px-2 text-xs" onClick={onCreate} disabled={!canCreate}>
          Add workflow
        </Button>
      </div>
    </div>
  );
}

function TaskListSection({
  title,
  tasks,
  empty,
  onTaskOpen,
  actionLabel,
  onTaskAction,
  actionPendingId,
}: {
  title: string;
  tasks: Task[];
  empty: string;
  onTaskOpen: (task: Task) => void;
  actionLabel?: string;
  onTaskAction?: (task: Task) => void;
  actionPendingId?: string | null;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.slice(0, 12).map((task) => (
            <div key={String(task.id)} className="flex items-start justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
              <button type="button" onClick={() => onTaskOpen(task)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {task.dueDate ?? "No date"} / {urgencyLabel(task.urgency)} / {task.recurrence === "none" ? task.status : taskRepeatLabel(task) || task.recurrence}
                </span>
              </button>
              {actionLabel && onTaskAction ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  onClick={() => onTaskAction(task)}
                  disabled={Boolean(actionPendingId)}
                >
                  {actionPendingId ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                  {actionLabel}
                </Button>
              ) : (
                <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
    </div>
  );
}

function InfoCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</p>
      {children}
    </div>
  );
}

function ToolsList({ profile }: { profile: PositionProfile }) {
  const items = profile.accessItems.length > 0
    ? profile.accessItems
    : profile.tools.map((tool, index) => ({
        id: `tool-${index}`,
        toolName: tool,
        loginUrl: "",
        accountOwner: "",
        billingNotes: "",
        status: "pending" as const,
        updatedAt: profile.lastUpdatedAt ?? "",
      }));
  if (items.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No tools recorded for this role yet.</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-border bg-muted/25 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{item.toolName}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.accountOwner || "No owner noted"}{item.loginUrl ? ` / ${item.loginUrl}` : ""}</span>
            </span>
            <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">{accessStatusLabels[item.status]}</span>
          </div>
          {item.billingNotes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.billingNotes}</p>}
        </div>
      ))}
    </div>
  );
}
