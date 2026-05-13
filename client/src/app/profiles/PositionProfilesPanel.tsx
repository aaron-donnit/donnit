import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArchiveRestore, BriefcaseBusiness, Check, ChevronDown, Eye, HelpCircle, History, KeyRound, ListChecks, ListPlus, Loader2, MoreHorizontal, Plus, Repeat2, Search, Shield, ShieldCheck, Sparkles, UserCog, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { ContinuityAssignmentPreview, Id, PersistedPositionProfile, PositionProfile, ProfileAccessItem, Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import { urgencyLabel } from "@/app/lib/urgency";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { titleCase, taskKnowledgeText, inferTaskCadence, taskRepeatLabel } from "@/app/lib/task-text";
import { memoryHowToNotes, memoryRecurringResponsibilities, memoryRecentSignals, memorySourceMix, mergeRecurringResponsibilities, recurringResponsibilitiesFromTasks } from "@/app/lib/memory";
import { canAdministerProfiles, isActiveUser } from "@/app/lib/permissions";
import { profilePrimaryOwnerId, profilesForUser, profileAssignmentLabel } from "@/app/lib/profiles";
import ReportMetric from "@/app/reports/ReportMetric";
import ToolStatusBadge from "@/app/admin/ToolStatusBadge";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";

export default function PositionProfilesPanel({
  profiles,
  users,
  currentUserId,
  authenticated,
  subtasks = [],
  events = [],
  focusProfileId = null,
}: {
  profiles: PositionProfile[];
  users: User[];
  currentUserId: Id;
  authenticated: boolean;
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
  focusProfileId?: string | null;
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
  const [newProfileTitle, setNewProfileTitle] = useState("");
  const [newProfileOwnerId, setNewProfileOwnerId] = useState(String(users[0]?.id ?? ""));
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignmentFocus, setAssignmentFocus] = useState<"delegate" | "transfer" | null>(null);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const customProfiles = useMemo(
    () =>
      customProfileMetas
        .map((meta): PositionProfile | null => {
          const owner = users.find((user) => String(user.id) === meta.ownerId) ?? users[0];
          if (!owner) return null;
          const base = profiles.find((profile) => String(profile.owner.id) === String(owner.id));
          return {
            ...(base ?? {
              persisted: false,
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
              riskLevel: "low" as const,
              riskReasons: [],
              transitionChecklist: [
                "Assign an owner for this job title.",
                "Add recurring responsibilities as they are discovered.",
                "Attach tool access and account ownership details.",
              ],
              lastUpdatedAt: null,
              status: "active" as const,
              currentOwnerId: owner.id,
              directManagerId: owner.managerId,
              temporaryOwnerId: null,
              delegateUserId: null,
              delegateUntil: null,
            }),
            id: meta.id,
            title: meta.title,
            owner,
            currentOwnerId: owner.id,
          } satisfies PositionProfile;
        })
        .filter((profile): profile is PositionProfile => Boolean(profile)),
    [customProfileMetas, profiles, users],
  );
  const repositoryProfiles = useMemo(
    () => {
      if (authenticated) return [...profiles].sort((a, b) => a.title.localeCompare(b.title));
      return [
        ...profiles
          .filter((profile) => !deletedProfileIds.has(profile.id))
          .map((profile) => ({ ...profile, title: renamedProfileTitles[profile.id] ?? profile.title })),
        ...customProfiles,
      ].sort((a, b) => a.title.localeCompare(b.title));
    },
    [authenticated, customProfiles, deletedProfileIds, profiles, renamedProfileTitles],
  );
  const [selectedProfileId, setSelectedProfileId] = useState(repositoryProfiles[0]?.id ?? "");
  const selectedProfile = repositoryProfiles.find((profile) => profile.id === selectedProfileId);
  const targetUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          selectedProfile &&
          isActiveUser(user) &&
          (!selectedProfile.currentOwnerId || String(user.id) !== String(selectedProfile.currentOwnerId)),
      ),
    [selectedProfile, users],
  );
  const assignmentUsers = useMemo(() => users.filter(isActiveUser), [users]);
  const [targetUserId, setTargetUserId] = useState("");
  const [mode, setMode] = useState<"delegate" | "transfer">("delegate");
  const [delegateUntil, setDelegateUntil] = useState("");
  const [showProfileHistory, setShowProfileHistory] = useState(false);
  const [profileListSearch, setProfileListSearch] = useState("");
  const [profileListFilter, setProfileListFilter] = useState<"current" | "vacant" | "delegated" | "archived" | "all">("current");
  const [profileTaskSearch, setProfileTaskSearch] = useState("");
  const [selectedProfileTaskId, setSelectedProfileTaskId] = useState<string | null>(null);
  const [accessDraft, setAccessDraft] = useState<{
    toolName: string;
    loginUrl: string;
    accountOwner: string;
    billingNotes: string;
    status: ProfileAccessItem["status"];
  }>({ toolName: "", loginUrl: "", accountOwner: "", billingNotes: "", status: "needs_grant" });
  const assignmentRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (repositoryProfiles.length === 0) {
      if (selectedProfileId) setSelectedProfileId("");
      setViewMode("list");
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
    setSelectedProfileId(profile.id);
    setShowProfileHistory(false);
    setProfileTaskSearch("");
    setSelectedProfileTaskId(null);
    setCreateOpen(false);
    setViewMode("detail");
  }, [focusProfileId, repositoryProfiles]);

  useEffect(() => {
    if (!selectedProfile) {
      setTargetUserId("");
      return;
    }
    const fallback = targetUsers.find((user) => String(user.id) === String(currentUserId)) ?? targetUsers[0];
    setTargetUserId(fallback ? String(fallback.id) : "");
  }, [selectedProfile?.id, currentUserId, targetUsers]);

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
      setViewMode("detail");
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
      setViewMode("list");
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

  const persistCustomProfiles = (next: Array<{ id: string; title: string; ownerId: string }>) => {
    setCustomProfileMetas(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.customPositionProfiles", JSON.stringify(next));
    }
  };
  const persistDeletedProfiles = (next: Set<string>) => {
    setDeletedProfileIds(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.deletedPositionProfiles", JSON.stringify(Array.from(next)));
    }
  };
  const persistRenamedProfiles = (next: Record<string, string>) => {
    setRenamedProfileTitles(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.renamedPositionProfiles", JSON.stringify(next));
    }
  };
  const renameProfile = (profileId: string, title: string) => {
    const trimmed = title.trim();
    if (trimmed.length < 2) return;
    if (authenticated) {
      const profile = repositoryProfiles.find((item) => item.id === profileId);
      if (!profile) return;
      if (profile.persisted) {
        updateProfile.mutate({ id: profile.id, patch: { title: trimmed } });
      } else {
        createProfile.mutate({ title: trimmed, ownerId: profile.owner.id, status: profile.status });
      }
      return;
    }
    if (profileId.startsWith("custom-position-")) {
      persistCustomProfiles(
        customProfileMetas.map((profile) => (profile.id === profileId ? { ...profile, title: trimmed } : profile)),
      );
      return;
    }
    persistRenamedProfiles({ ...renamedProfileTitles, [profileId]: trimmed });
  };
  const addProfile = () => {
    const title = newProfileTitle.trim();
    if (!title) return;
    if (authenticated) {
      createProfile.mutate({
        title,
        ownerId: newProfileOwnerId || null,
        status: newProfileOwnerId ? "active" : "vacant",
      });
      setNewProfileTitle("");
      setCreateOpen(false);
      return;
    }
    if (!newProfileOwnerId) return;
    const id = `custom-position-${Date.now()}`;
    persistCustomProfiles([...customProfileMetas, { id, title, ownerId: newProfileOwnerId }]);
    setSelectedProfileId(id);
    setNewProfileTitle("");
    setCreateOpen(false);
    setViewMode("detail");
  };
  const deleteProfile = () => {
    if (!selectedProfile) return;
    if (authenticated) {
      if (!selectedProfile.persisted) {
        toast({
          title: "Save this Position Profile first",
          description: "This profile is still being assembled from task history. Save it as an admin record before deleting it.",
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
    setViewMode("list");
  };
  const archiveProfile = () => {
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
  };
  const restoreProfile = () => {
    if (!selectedProfile || !selectedProfile.persisted) return;
    const { archivedAt, archivedBy, ...memory } = selectedProfile.institutionalMemory;
    void archivedAt;
    void archivedBy;
    updateProfile.mutate({
      id: selectedProfile.id,
      patch: {
        institutionalMemory: memory,
        riskSummary: "Restored by admin from archive.",
      },
    });
  };
  const openProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setShowProfileHistory(false);
    setProfileTaskSearch("");
    setSelectedProfileTaskId(null);
    setCreateOpen(false);
    setViewMode("detail");
  };
  const assignableUsersForProfile = (profile: PositionProfile | null | undefined) =>
    users.filter(
      (user) =>
        profile &&
        isActiveUser(user) &&
        (!profile.currentOwnerId || String(user.id) !== String(profile.currentOwnerId)),
    );
  const defaultTargetUserIdForProfile = (profile: PositionProfile | null | undefined) => {
    const candidates = assignableUsersForProfile(profile);
    const currentUserCandidate = candidates.find((user) => String(user.id) === String(currentUserId));
    return String((currentUserCandidate ?? candidates[0])?.id ?? "");
  };
  const openAssignment = (nextMode: "delegate" | "transfer") => {
    const profileToAssign = selectedProfile ?? repositoryProfiles[0] ?? null;
    if (!profileToAssign) return;
    setMode(nextMode);
    setAssignmentFocus(nextMode);
    setCreateOpen(false);
    setSelectedProfileId(profileToAssign.id);
    setTargetUserId(defaultTargetUserIdForProfile(profileToAssign));
    setSelectedProfileTaskId(null);
    setViewMode("detail");
    setAssignmentDialogOpen(true);
  };

  const saveAccessInventory = (items: ProfileAccessItem[]) => {
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
  };
  const addAccessItem = () => {
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
  };
  const setAccessStatus = (id: string, status: ProfileAccessItem["status"]) => {
    if (!selectedProfile) return;
    saveAccessInventory(
      selectedProfile.accessItems.map((item) =>
        item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
      ),
    );
  };
  const removeAccessItem = (id: string) => {
    if (!selectedProfile) return;
    saveAccessInventory(selectedProfile.accessItems.filter((item) => item.id !== id));
  };

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
  const normalizedProfileTaskSearch = profileTaskSearch.trim().toLowerCase();
  const normalizedProfileListSearch = profileListSearch.trim().toLowerCase();
  const isProfileArchived = (profile: PositionProfile) => typeof profile.institutionalMemory.archivedAt === "string";
  const archivedProfiles = repositoryProfiles.filter(isProfileArchived);
  const activeRepositoryProfiles = repositoryProfiles.filter((profile) => !isProfileArchived(profile));
  const vacantProfiles = activeRepositoryProfiles.filter((profile) => profile.status === "vacant" || !profile.currentOwnerId);
  const delegatedProfiles = activeRepositoryProfiles.filter((profile) => profile.status === "covered" || profile.delegateUserId || profile.temporaryOwnerId);
  const currentProfiles = activeRepositoryProfiles.filter((profile) => !vacantProfiles.includes(profile) && !delegatedProfiles.includes(profile));
  const filteredRepositoryProfiles = repositoryProfiles.filter((profile) => {
    if (profileListFilter === "all") return true;
    if (profileListFilter === "archived") return isProfileArchived(profile);
    if (isProfileArchived(profile)) return false;
    if (profileListFilter === "vacant") return vacantProfiles.includes(profile);
    if (profileListFilter === "delegated") return delegatedProfiles.includes(profile);
    return currentProfiles.includes(profile);
  });
  const visibleRepositoryProfiles = normalizedProfileListSearch
    ? filteredRepositoryProfiles.filter((profile) => {
        const ownerLabel = profileAssignmentLabel(profile, users);
        const haystack = [
          profile.title,
          profile.status,
          ownerLabel,
          ...profile.tools,
          ...profile.stakeholders,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedProfileListSearch);
      })
    : filteredRepositoryProfiles;
  const allSelectedProfileTasks = selectedProfile
    ? [
        ...selectedProfile.currentIncompleteTasks,
        ...selectedProfile.recurringTasks,
        ...selectedProfile.completedTasks,
      ].filter((task, index, items) => items.findIndex((item) => String(item.id) === String(task.id)) === index)
    : [];
  const selectedProfileTask = allSelectedProfileTasks.find((task) => String(task.id) === selectedProfileTaskId) ?? null;
  const profileTaskMatches = (task: Task) => {
    if (!normalizedProfileTaskSearch) return true;
    const haystack = [
      task.title,
      task.description,
      task.completionNotes,
      task.source,
      task.urgency,
      task.status,
      task.dueDate ?? "",
      users.find((user) => String(user.id) === String(task.assignedToId))?.name ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedProfileTaskSearch);
  };
  const visibleProfileCurrentTasks = selectedProfile?.currentIncompleteTasks.filter(profileTaskMatches) ?? [];
  const visibleProfileRecurringTasks = selectedProfile?.recurringTasks.filter(profileTaskMatches) ?? [];
  const visibleProfileCompletedTasks = selectedProfile?.completedTasks.filter(profileTaskMatches) ?? [];
  const handoffOwner = selectedProfile ? users.find((user) => String(user.id) === String(selectedProfile.currentOwnerId)) : null;
  const temporaryOwner = selectedProfile ? users.find((user) => String(user.id) === String(selectedProfile.temporaryOwnerId)) : null;
  const delegateOwner = selectedProfile ? users.find((user) => String(user.id) === String(selectedProfile.delegateUserId)) : null;
  const handoffReadiness = !selectedProfile
    ? null
    : selectedProfile.status === "vacant"
      ? {
          label: "Coverage needed",
          tone: "warning" as const,
          action: "Assign temporary coverage or transfer the profile before showing this in a live handoff.",
        }
      : selectedProfile.recurringTasks.length === 0 && selectedProfile.completedTasks.length === 0
          ? {
              label: "Learning",
              tone: "setup" as const,
              action: "Capture recurring tasks and completion notes so this role has transferable memory.",
            }
          : {
              label: "Handoff ready",
              tone: "ready" as const,
              action: "This profile has enough work memory to support a coverage or replacement conversation.",
            };
  const accessStatusLabels: Record<ProfileAccessItem["status"], string> = {
    active: "Active",
    needs_grant: "Grant access",
    needs_reset: "Reset needed",
    remove_access: "Remove access",
    pending: "Pending",
  };
  const selectedMemory = selectedProfile?.institutionalMemory ?? {};
  const learnedHowToNotes = memoryHowToNotes(selectedMemory);
  const learnedRecurringResponsibilities = mergeRecurringResponsibilities(
    memoryRecurringResponsibilities(selectedMemory),
    recurringResponsibilitiesFromTasks(selectedProfile?.recurringTasks ?? []),
  );
  const learnedTaskSignals = memoryRecentSignals(selectedMemory);
  const learnedSourceMix = memorySourceMix(selectedMemory);
  const learnedStats = selectedMemory.stats && typeof selectedMemory.stats === "object" && !Array.isArray(selectedMemory.stats)
    ? selectedMemory.stats as Record<string, unknown>
    : {};
  const learnedRecurringCount = Math.max(Number(learnedStats.recurringTasks ?? 0) || 0, learnedRecurringResponsibilities.length);
  const recurringKnowledgeGaps = (selectedProfile?.recurringTasks ?? [])
    .filter((task) => taskKnowledgeText(task).length < 30)
    .slice(0, 4);
  const profileReadinessItems = selectedProfile
    ? [
        {
          label: "Owner or coverage assigned",
          detail: temporaryOwner
            ? `Temporarily covered by ${temporaryOwner.name}`
            : delegateOwner
              ? `Delegated to ${delegateOwner.name}`
              : handoffOwner
                ? `Owned by ${handoffOwner.name}`
                : "No owner assigned",
          done: Boolean(handoffOwner || temporaryOwner || delegateOwner),
        },
        {
          label: "Current work captured",
          detail: `${selectedProfile.currentIncompleteTasks.length} open task${selectedProfile.currentIncompleteTasks.length === 1 ? "" : "s"}`,
          done: selectedProfile.currentIncompleteTasks.length > 0 || selectedProfile.completedTasks.length > 0,
        },
        {
          label: "Recurring work mapped",
          detail: `${selectedProfile.recurringTasks.length} recurring responsibilit${selectedProfile.recurringTasks.length === 1 ? "y" : "ies"}`,
          done: selectedProfile.recurringTasks.length > 0,
        },
        {
          label: "Historical memory available",
          detail: `${selectedProfile.completedTasks.length} historical task${selectedProfile.completedTasks.length === 1 ? "" : "s"} plus ${learnedHowToNotes.length} how-to note${learnedHowToNotes.length === 1 ? "" : "s"}`,
          done: selectedProfile.completedTasks.length > 0 || learnedHowToNotes.length > 0,
        },
        {
          label: "Recurring how-to context",
          detail: recurringKnowledgeGaps.length === 0
            ? "No recurring context gaps detected"
            : `${recurringKnowledgeGaps.length} recurring item${recurringKnowledgeGaps.length === 1 ? "" : "s"} need notes`,
          done: selectedProfile.recurringTasks.length > 0 && recurringKnowledgeGaps.length === 0,
        },
        {
          label: "Tool access documented",
          detail: `${selectedProfile.accessItems.length} access item${selectedProfile.accessItems.length === 1 ? "" : "s"} recorded`,
          done: selectedProfile.accessItems.length > 0,
        },
      ]
    : [];
  const profileReadinessDone = profileReadinessItems.filter((item) => item.done).length;
  const handoffPacketSections = selectedProfile
    ? [
        {
          label: "Open work",
          empty: "No open work captured",
          items: selectedProfile.currentIncompleteTasks
            .slice(0, 3)
            .map((task) => `${task.title}${task.dueDate ? ` / due ${task.dueDate}` : ""}`),
        },
        {
          label: "Recurring work",
          empty: "No recurring rhythm mapped",
          items: selectedProfile.recurringTasks
            .slice(0, 3)
            .map((task) => `${task.title}${taskRepeatLabel(task) ? ` / ${taskRepeatLabel(task)}` : ""}`),
        },
        {
          label: "Knowledge gaps",
          empty: "No recurring gaps detected",
          items: recurringKnowledgeGaps.slice(0, 3).map((task) => `${task.title} needs notes`),
        },
        {
          label: "Tool access",
          empty: "No access items recorded",
          items: selectedProfile.accessItems.slice(0, 3).map((item) => `${item.toolName} / ${accessStatusLabels[item.status]}`),
        },
        {
          label: "Historical memory",
          empty: "No historical work captured",
          items: [
            ...selectedProfile.completedTasks.slice(0, 2).map((task) => task.title),
            ...learnedHowToNotes.slice(0, 1).map((item) => `${item.title}: ${item.note.slice(0, 90)}`),
          ].slice(0, 3),
        },
      ]
    : [];
  const profileSearchResults = selectedProfile && normalizedProfileTaskSearch
    ? (() => {
        const query = normalizedProfileTaskSearch;
        const results: Array<{ id: string; label: string; detail: string; type: string; taskId?: Id }> = [];
        const matches = (parts: Array<string | number | null | undefined>) =>
          parts.filter((part) => part !== null && part !== undefined).join(" ").toLowerCase().includes(query);
        const add = (item: { id: string; label: string; detail: string; type: string; taskId?: Id }) => {
          if (!results.some((result) => result.id === item.id)) results.push(item);
        };

        if (matches([selectedProfile.title, selectedProfile.status, profileAssignmentLabel(selectedProfile, users)])) {
          add({
            id: "profile-summary",
            type: "Profile",
            label: selectedProfile.title,
            detail: `${profileAssignmentLabel(selectedProfile, users)} / ${selectedProfile.status}`,
          });
        }

        allSelectedProfileTasks.forEach((task) => {
          if (!matches([task.title, task.description, task.completionNotes, task.source, task.status, task.urgency, task.dueDate, taskRepeatLabel(task)])) return;
          add({
            id: `task-${task.id}`,
            type: task.status === "completed" ? "History" : task.recurrence !== "none" ? "Recurring task" : "Task",
            label: task.title,
            detail: `${task.dueDate ?? "No date"} / ${urgencyLabel(task.urgency)} / ${task.source}`,
            taskId: task.id,
          });
        });

        selectedProfile.howTo.forEach((item, index) => {
          if (matches([item])) add({ id: `how-to-${index}`, type: "How-to", label: item, detail: "Saved instruction" });
        });
        selectedProfile.tools.forEach((item, index) => {
          if (matches([item])) add({ id: `tool-${index}`, type: "Tool", label: item, detail: "Tool access summary" });
        });
        selectedProfile.stakeholders.forEach((item, index) => {
          if (matches([item])) add({ id: `stakeholder-${index}`, type: "Contact", label: item, detail: "Role relationship" });
        });
        selectedProfile.accessItems.forEach((item) => {
          if (!matches([item.toolName, item.loginUrl, item.accountOwner, item.billingNotes, item.status])) return;
          add({
            id: `access-${item.id}`,
            type: "Access",
            label: item.toolName,
            detail: `${item.accountOwner || "No owner noted"} / ${accessStatusLabels[item.status]}`,
          });
        });
        selectedProfile.transitionChecklist.forEach((item, index) => {
          if (matches([item])) add({ id: `checklist-${index}`, type: "Checklist", label: item, detail: "Transition step" });
        });
        learnedRecurringResponsibilities.forEach((item) => {
          if (!matches([item.title, item.cadence, item.repeatDetails, item.dueDate])) return;
          add({
            id: `learned-recurring-${item.taskId}-${item.title}`,
            type: "Learned recurring",
            label: item.title,
            detail: item.repeatDetails || item.cadence || "Recurring responsibility",
            taskId: item.taskId,
          });
        });
        learnedHowToNotes.forEach((item) => {
          if (!matches([item.title, item.note])) return;
          add({
            id: `learned-how-to-${item.taskId}-${item.note}`,
            type: "Learned note",
            label: item.title,
            detail: item.note,
            taskId: item.taskId,
          });
        });
        learnedTaskSignals.forEach((item) => {
          if (!matches([item.title, item.eventType, item.source, item.urgency])) return;
          add({
            id: `signal-${item.taskId}-${item.eventType}`,
            type: "Signal",
            label: item.title,
            detail: `${titleCase(item.eventType)} / ${titleCase(item.source)} / ${urgencyLabel(item.urgency)}`,
            taskId: item.taskId,
          });
        });
        learnedSourceMix.forEach((item) => {
          if (matches([item.source, item.count])) add({ id: `source-${item.source}`, type: "Source", label: titleCase(item.source), detail: `${item.count} captured item${item.count === 1 ? "" : "s"}` });
        });

        return results.slice(0, 12);
      })()
    : [];
  const lastLearnedAt = typeof selectedMemory.lastAutoUpdatedAt === "string" ? selectedMemory.lastAutoUpdatedAt : null;
  const renderProfileTaskButton = (task: Task, meta: string) => (
    <button
      key={String(task.id)}
      type="button"
      onClick={() => setSelectedProfileTaskId(String(task.id))}
      className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
      data-testid={`button-position-profile-task-${task.id}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">{task.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
      </span>
      <Eye className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
  const renderProfileSection = (
    title: string,
    detail: string,
    icon: ReactNode,
    count: string | number | null,
    children: ReactNode,
    defaultOpen = false,
  ) => (
    <details className="profile-disclosure rounded-md border border-border bg-background" open={defaultOpen}>
      <summary className="profile-disclosure-summary">
        <span className="profile-disclosure-icon">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        {count !== null && (
          <span className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{count}</span>
        )}
        <ChevronDown className="profile-disclosure-chevron size-4 text-muted-foreground" />
      </summary>
      <div className="profile-disclosure-body">{children}</div>
    </details>
  );

  return (
    <div className="position-profiles-shell rounded-md border border-border" data-testid="panel-position-profiles">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="display-font text-sm font-bold">Position Profiles</h3>
            <p className="ui-label mt-1">Admin repository by job title</p>
          </div>
          <BriefcaseBusiness className="size-4 text-brand-green" />
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {!canManageProfiles && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Position Profiles are restricted to admins.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setCreateOpen((open) => !open);
              setViewMode("list");
            }}
            disabled={!canManageProfiles}
            data-testid="button-position-profile-create"
          >
            <ListPlus className="size-4" />
            Create Position Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openAssignment("transfer")}
            disabled={!canManageProfiles || repositoryProfiles.length === 0}
            data-testid="button-position-profile-reassign"
          >
            <UserCog className="size-4" />
            Reassign Position Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openAssignment("delegate")}
            disabled={!canManageProfiles || repositoryProfiles.length === 0}
            data-testid="button-position-profile-delegate"
          >
            <UserPlus className="size-4" />
            Delegate Access
          </Button>
        </div>
        {canManageProfiles && (
          <div className={`${createOpen ? "block" : "hidden"} rounded-md border border-border bg-background px-3 py-3`}>
            <p className="mb-2 text-xs font-medium text-foreground">Create a job-title profile</p>
            <div className="grid gap-2">
              <Input
                value={newProfileTitle}
                onChange={(event) => setNewProfileTitle(event.target.value)}
                placeholder="Executive Assistant to the CEO"
                maxLength={160}
                data-testid="input-position-profile-title"
              />
              <select
                value={newProfileOwnerId}
                onChange={(event) => setNewProfileOwnerId(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-position-profile-owner"
              >
                {authenticated && <option value="">Vacant / no current owner</option>}
                {users.map((user) => (
                  <option key={String(user.id)} value={String(user.id)}>
                    {user.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={addProfile}
                disabled={newProfileTitle.trim().length < 2 || createProfile.isPending}
                data-testid="button-position-profile-add"
              >
                {createProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                Add profile
              </Button>
            </div>
          </div>
        )}

        {viewMode === "list" || !selectedProfile ? (
          <div className="space-y-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Current Position Profiles</h4>
              <p className="text-xs text-muted-foreground">
                Start with the job-title repository, then click into a profile when you need assignments, memory, or transition controls.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-5" data-testid="position-profile-status-filters">
              {([
                ["current", "Current", currentProfiles.length],
                ["vacant", "Vacant", vacantProfiles.length],
                ["delegated", "Delegated", delegatedProfiles.length],
                ["archived", "Archived", archivedProfiles.length],
                ["all", "All", repositoryProfiles.length],
              ] as Array<[typeof profileListFilter, string, number]>).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProfileListFilter(id)}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    profileListFilter === id ? "border-brand-green bg-brand-green/10" : "border-border bg-background hover:bg-muted/40"
                  }`}
                  data-testid={`button-position-profile-filter-${id}`}
                >
                  <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
                  <span className="mt-0.5 block text-lg font-semibold tabular-nums text-foreground">{count}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={profileListSearch}
                onChange={(event) => setProfileListSearch(event.target.value)}
                placeholder="Search profiles by job, owner, tools, or status"
                className="h-9 pl-9 text-xs"
                data-testid="input-position-profile-list-search"
              />
            </div>
            {repositoryProfiles.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No role memory yet. Create a profile or let Donnit build one as tasks are assigned and completed.
              </div>
            ) : visibleRepositoryProfiles.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No Position Profiles match that search.
              </div>
            ) : (
              <div className="profile-list-grid" data-testid="position-profile-list">
                {visibleRepositoryProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => openProfile(profile.id)}
                    className="profile-item-card w-full rounded-md border border-border bg-background px-3 py-3 text-left transition hover:border-brand-green/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    data-testid={`position-profile-row-${profile.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{profile.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {profileAssignmentLabel(profile, users)} - {profile.status}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {isProfileArchived(profile) && (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-5">
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.currentIncompleteTasks.length}</strong>
                        open
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.recurringTasks.length}</strong>
                        recurring
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.completedTasks.length}</strong>
                        learned
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.tools.length}</strong>
                        tools
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.stakeholders.length}</strong>
                        contacts
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAssignmentFocus(null);
                  setViewMode("list");
                }}
                data-testid="button-position-profile-list"
              >
                <BriefcaseBusiness className="size-4" />
                All profiles
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canManageProfiles}
                    data-testid="button-position-profile-actions"
                  >
                    <MoreHorizontal className="size-4" />
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Profile actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => openAssignment("transfer")} data-testid="menu-position-profile-transfer">
                    <UserCog className="mr-2 size-4" />
                    Transfer or reassign
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openAssignment("delegate")} data-testid="menu-position-profile-delegate">
                    <UserPlus className="mr-2 size-4" />
                    Delegate coverage
                  </DropdownMenuItem>
                  {selectedProfile.persisted && (
                    <DropdownMenuItem
                      onClick={() =>
                        updateProfile.mutate({
                          id: selectedProfile.id,
                          patch: {
                            status: "vacant",
                            currentOwnerId: null,
                            temporaryOwnerId: null,
                            delegateUserId: null,
                            delegateUntil: null,
                            riskSummary: "Marked vacant by admin. Use delegate access or transfer when coverage is assigned.",
                          },
                        })
                      }
                      disabled={updateProfile.isPending}
                      data-testid="menu-position-profile-vacant"
                    >
                      <AlertTriangle className="mr-2 size-4" />
                      Mark vacant
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={isProfileArchived(selectedProfile) ? restoreProfile : archiveProfile}
                    disabled={updateProfile.isPending || (authenticated && !selectedProfile.persisted)}
                    data-testid={isProfileArchived(selectedProfile) ? "button-position-profile-restore-top" : "button-position-profile-archive-top"}
                  >
                    {isProfileArchived(selectedProfile) ? <ArchiveRestore className="mr-2 size-4" /> : <Archive className="mr-2 size-4" />}
                    {isProfileArchived(selectedProfile) ? "Restore profile" : "Archive profile"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-3" data-testid="panel-position-profile-search">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">Search</p>
                  <p className="text-xs text-muted-foreground">
                    Search tasks, history, recurring work, notes, tools, access, contacts, and transition items.
                  </p>
                </div>
                <Search className="size-4 text-muted-foreground" />
              </div>
              <Input
                value={profileTaskSearch}
                onChange={(event) => setProfileTaskSearch(event.target.value)}
                placeholder="Search this profile"
                className="h-9 text-xs"
                data-testid="input-position-profile-task-search"
              />
              {normalizedProfileTaskSearch && (
                <div className="mt-3 rounded-md border border-border bg-muted/25 p-2" data-testid="position-profile-search-results">
                  {profileSearchResults.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">No profile results found.</p>
                  ) : (
                    <div className="grid gap-1.5">
                      {profileSearchResults.map((result) => {
                        const content = (
                          <>
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-foreground">{result.label}</span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{result.detail}</span>
                            </span>
                            <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                              {result.type}
                            </span>
                          </>
                        );
                        return result.taskId ? (
                          <button
                            key={result.id}
                            type="button"
                            onClick={() => setSelectedProfileTaskId(String(result.taskId))}
                            className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-left transition hover:bg-background"
                            data-testid={`button-position-profile-search-result-${result.id}`}
                          >
                            {content}
                          </button>
                        ) : (
                          <div key={result.id} className="flex items-start justify-between gap-3 rounded-md px-2 py-2">
                            {content}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              ref={assignmentRef}
              className={`profile-detail-hero rounded-md border bg-background px-3 py-3 ${
                assignmentFocus ? "border-brand-green shadow-sm shadow-brand-green/10" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{selectedProfile.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {profileAssignmentLabel(selectedProfile, users)} - {selectedProfile.status}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">
                    {selectedProfile.currentIncompleteTasks.length}
                  </p>
                  <p className="text-muted-foreground">open</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{selectedProfile.recurringTasks.length}</p>
                  <p className="text-muted-foreground">recurring</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{selectedProfile.completedTasks.length}</p>
                  <p className="text-muted-foreground">learned</p>
                </div>
              </div>
              {handoffReadiness && (
                <details className="profile-disclosure mt-3 rounded-md border border-border bg-background">
                  <summary className="profile-disclosure-summary">
                    <span className="profile-disclosure-icon"><ShieldCheck className="size-4 text-brand-green" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">Transition snapshot</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{handoffReadiness.action}</span>
                    </span>
                    <ToolStatusBadge status={handoffReadiness.tone} label={handoffReadiness.label} />
                    <ChevronDown className="profile-disclosure-chevron size-4 text-muted-foreground" />
                  </summary>
                  <div className="profile-disclosure-body">
                <div className="rounded-md border border-brand-green/25 bg-brand-green/5 px-3 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">Handoff packet</p>
                        <ToolStatusBadge status={handoffReadiness.tone} label={handoffReadiness.label} />
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Built for HR/Ops and people managers: current work, recurring responsibilities, historical context, and coverage controls in one place.
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          selectedProfile.persisted &&
                          updateProfile.mutate({
                            id: selectedProfile.id,
                            patch: {
                              status: "vacant",
                              currentOwnerId: null,
                              temporaryOwnerId: null,
                              delegateUserId: null,
                              delegateUntil: null,
                              riskSummary: "Marked vacant by admin. Use delegate access or transfer when coverage is assigned.",
                            },
                          })
                        }
                        disabled={!canManageProfiles || !selectedProfile.persisted || updateProfile.isPending}
                        data-testid="button-handoff-mark-vacant"
                      >
                        <AlertTriangle className="size-4" />
                        Mark vacant
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openAssignment("delegate")}
                        disabled={!canManageProfiles}
                        data-testid="button-handoff-delegate"
                      >
                        <UserPlus className="size-4" />
                        Delegate
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openAssignment("transfer")}
                        disabled={!canManageProfiles}
                        data-testid="button-handoff-transfer"
                      >
                        <UserCog className="size-4" />
                        Transfer
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                    <div className="rounded-md bg-background px-3 py-2">
                      <p className="ui-label">Coverage</p>
                      <p className="mt-1 text-foreground">
                        {selectedProfile.status === "vacant"
                          ? "Vacant"
                          : temporaryOwner
                            ? `Covered by ${temporaryOwner.name}`
                            : delegateOwner
                              ? `Delegated to ${delegateOwner.name}`
                              : handoffOwner
                                ? `Owned by ${handoffOwner.name}`
                                : "Vacant"}
                      </p>
                      {selectedProfile.delegateUntil && (
                        <p className="mt-1 text-muted-foreground">Through {selectedProfile.delegateUntil}</p>
                      )}
                    </div>
                    <div className="rounded-md bg-background px-3 py-2">
                      <p className="ui-label">Included</p>
                      <p className="mt-1 text-foreground">
                        {selectedProfile.currentIncompleteTasks.length} open / {selectedProfile.recurringTasks.length} recurring / {selectedProfile.completedTasks.length} historical
                      </p>
                      <p className="mt-1 text-muted-foreground">Personal work excluded; confidential work access-controlled.</p>
                    </div>
                    <div className="rounded-md bg-background px-3 py-2">
                      <p className="ui-label">Next action</p>
                      <p className="mt-1 leading-5 text-foreground">{handoffReadiness.action}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-md border border-border bg-background px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">Replacement brief</p>
                      <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        Live packet
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {handoffPacketSections.map((section) => (
                        <div key={section.label} className="rounded-md bg-muted/45 px-2 py-2">
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                            {section.label}
                          </p>
                          {section.items.length > 0 ? (
                            <ul className="space-y-1 text-xs text-foreground">
                              {section.items.map((item) => (
                                <li key={item} className="line-clamp-2">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">{section.empty}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                  </div>
                </details>
              )}
              {canManageProfiles && (
                <details className="profile-disclosure mt-3 rounded-md border border-border bg-background">
                  <summary className="profile-disclosure-summary">
                    <span className="profile-disclosure-icon"><UserCog className="size-4 text-muted-foreground" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">Profile actions</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">Rename, change status, transfer, delegate, or archive this profile.</span>
                    </span>
                    <ChevronDown className="profile-disclosure-chevron size-4 text-muted-foreground" />
                  </summary>
                  <div className="profile-disclosure-body space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="position-profile-rename" className="ui-label">
                    Admin name
                  </Label>
                  <Input
                    id="position-profile-rename"
                    key={selectedProfile.id}
                    defaultValue={selectedProfile.title}
                    maxLength={160}
                    disabled={updateProfile.isPending || createProfile.isPending}
                    onBlur={(event) => renameProfile(selectedProfile.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        renameProfile(selectedProfile.id, event.currentTarget.value);
                        event.currentTarget.blur();
                      }
                    }}
                    data-testid="input-position-profile-rename"
                  />
                </div>
              {authenticated && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {!selectedProfile.persisted ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        createProfile.mutate({
                          title: selectedProfile.title,
                          ownerId: selectedProfile.owner.id,
                          status: selectedProfile.status,
                        })
                      }
                      disabled={createProfile.isPending}
                      data-testid="button-position-profile-save-generated"
                    >
                      {createProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                      Save admin record
                    </Button>
                  ) : (
                    <>
                      <select
                        value={selectedProfile.status}
                        onChange={(event) =>
                          updateProfile.mutate({
                            id: selectedProfile.id,
                            patch: {
                              status: event.target.value,
                              currentOwnerId: event.target.value === "vacant" ? null : selectedProfile.currentOwnerId ?? null,
                            },
                          })
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        data-testid="select-position-profile-status"
                      >
                        <option value="active">Active</option>
                        <option value="vacant">Vacant</option>
                        <option value="covered">Covered temporarily</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateProfile.mutate({
                            id: selectedProfile.id,
                            patch: {
                              status: "vacant",
                              currentOwnerId: null,
                              temporaryOwnerId: null,
                              delegateUserId: null,
                              delegateUntil: null,
                              riskSummary: "Marked vacant by admin. Use delegate access or transfer when coverage is assigned.",
                            },
                          })
                        }
                        disabled={updateProfile.isPending}
                        data-testid="button-position-profile-vacant"
                      >
                        {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
                        Mark vacant
                      </Button>
                    </>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Transfer, delegate, vacancy, and archive controls live in the Actions menu at the top of this profile.
              </p>
                  </div>
                </details>
              )}
            </div>

            {renderProfileSection(
              "Role intelligence",
              "Learned recurring work, recent signals, how-to notes, and source mix.",
              <Sparkles className="size-4 text-brand-green" />,
              learnedRecurringCount + learnedHowToNotes.length,
              <div className="rounded-md border border-border bg-background px-3 py-3" data-testid="panel-position-role-intelligence">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Sparkles className="size-4 text-brand-green" />
                    Role intelligence
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Automatically learned from task creation, completions, notes, recurrence, and handoffs.
                  </p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  {lastLearnedAt ? `Updated ${new Date(lastLearnedAt).toLocaleDateString()}` : "Learning"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{Number(learnedStats.taskSignals ?? learnedTaskSignals.length) || 0}</p>
                  <p className="text-muted-foreground">signals</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{learnedRecurringCount}</p>
                  <p className="text-muted-foreground">recurring</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{learnedHowToNotes.length}</p>
                  <p className="text-muted-foreground">instructions</p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Learned recurring work</p>
                  {learnedRecurringResponsibilities.length > 0 ? (
                    <div className="space-y-1.5">
                      {learnedRecurringResponsibilities.slice(0, 4).map((item) => (
                        <div key={`${item.taskId}-${item.title}`} className="rounded-md bg-background px-2 py-2 text-xs">
                          <p className="truncate font-medium text-foreground">{item.title}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {item.repeatDetails || item.cadence}{item.dueDate ? ` / due ${item.dueDate}` : ""}{item.showEarlyDays > 0 ? ` / shows ${item.showEarlyDays} days early` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      No recurring pattern has been learned yet.
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Recent learned signals</p>
                  {learnedTaskSignals.length > 0 ? (
                    <div className="space-y-1.5">
                      {learnedTaskSignals.slice(0, 4).map((item) => (
                        <div key={`${item.taskId}-${item.eventType}`} className="rounded-md bg-background px-2 py-2 text-xs">
                          <p className="truncate font-medium text-foreground">{item.title}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {titleCase(item.eventType)} / {titleCase(item.source)} / {urgencyLabel(item.urgency)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      Donnit will populate this as tasks are added or completed.
                    </p>
                  )}
                </div>
              </div>
              {recurringKnowledgeGaps.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-foreground">Recurring work needs context</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Add notes or completion details so a replacement can run these without guessing.
                      </p>
                    </div>
                    <span className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      {recurringKnowledgeGaps.length}
                    </span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {recurringKnowledgeGaps.map((task) => (
                      <button
                        key={String(task.id)}
                        type="button"
                        onClick={() => setSelectedProfileTaskId(String(task.id))}
                        className="rounded-md bg-background px-2 py-2 text-left text-xs transition hover:bg-muted"
                        data-testid={`button-position-profile-knowledge-gap-${task.id}`}
                      >
                        <span className="block truncate font-medium text-foreground">{task.title}</span>
                        <span className="mt-0.5 block truncate text-muted-foreground">{taskRepeatLabel(task) || "Recurring responsibility"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Instructions Donnit captured</p>
                  {learnedHowToNotes.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                      {learnedHowToNotes.slice(0, 4).map((item) => (
                        <li key={`${item.taskId}-${item.note}`} className="rounded-md bg-background px-2 py-2">
                          <span className="block font-medium text-foreground">{item.title}</span>
                          <span className="mt-0.5 line-clamp-2 block">{item.note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      Add completion notes to recurring tasks to build role instructions.
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Source mix</p>
                  {learnedSourceMix.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {learnedSourceMix.map((item) => (
                        <span key={item.source} className="rounded-md bg-background px-2 py-1 text-xs text-muted-foreground">
                          {titleCase(item.source)}: {item.count}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      Sources appear after chat, email, Slack, SMS, or document tasks are captured.
                    </p>
                  )}
                </div>
              </div>
              </div>,
            )}

            {renderProfileSection(
              "Tools",
              "Role systems, accounts, billing context, and access reset status.",
              <KeyRound className="size-4 text-muted-foreground" />,
              selectedProfile.accessItems.length,
              <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <KeyRound className="size-4 text-muted-foreground" />
                    Tools
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Admin record for role systems, access owner, billing context, and reset/removal status.
                  </p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
                  {selectedProfile.accessItems.length}
                </span>
              </div>
              <div className="grid gap-2">
                {selectedProfile.accessItems.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                    No tools recorded for this role yet.
                  </p>
                ) : (
                  selectedProfile.accessItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">{item.toolName}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {item.accountOwner || "No owner noted"}{item.loginUrl ? ` / ${item.loginUrl}` : ""}
                          </p>
                        </div>
                        <span className="rounded-md bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {accessStatusLabels[item.status]}
                        </span>
                      </div>
                      {item.billingNotes && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.billingNotes}</p>
                      )}
                      {canManageProfiles && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(["active", "needs_grant", "needs_reset", "remove_access"] as ProfileAccessItem["status"][]).map((status) => (
                            <Button
                              key={`${item.id}-${status}`}
                              type="button"
                              variant={item.status === status ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAccessStatus(item.id, status)}
                              disabled={updateProfile.isPending}
                              data-testid={`button-profile-access-${status}-${item.id}`}
                            >
                              {accessStatusLabels[status]}
                            </Button>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => removeAccessItem(item.id)}
                            disabled={updateProfile.isPending}
                            data-testid={`button-profile-access-remove-${item.id}`}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              {canManageProfiles && (
                <div className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={accessDraft.toolName}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, toolName: event.target.value }))}
                      placeholder="Tool or account"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-tool"
                    />
                    <Input
                      value={accessDraft.loginUrl}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, loginUrl: event.target.value }))}
                      placeholder="Login URL or vault reference"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-url"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
                    <Input
                      value={accessDraft.accountOwner}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, accountOwner: event.target.value }))}
                      placeholder="Owner/contact"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-owner"
                    />
                    <Input
                      value={accessDraft.billingNotes}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, billingNotes: event.target.value }))}
                      placeholder="Billing or reset notes"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-notes"
                    />
                    <select
                      value={accessDraft.status}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, status: event.target.value as ProfileAccessItem["status"] }))}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      data-testid="select-profile-access-status"
                    >
                      <option value="needs_grant">Grant access</option>
                      <option value="needs_reset">Reset needed</option>
                      <option value="remove_access">Remove access</option>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                    </select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={addAccessItem}
                    disabled={accessDraft.toolName.trim().length < 2 || updateProfile.isPending}
                    data-testid="button-profile-access-add"
                  >
                    {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                    Add access item
                  </Button>
                </div>
              )}
              </div>,
            )}

            {renderProfileSection(
              "Tasks",
              "Current and recurring work tied to this position.",
              <ListChecks className="size-4 text-muted-foreground" />,
              selectedProfile.currentIncompleteTasks.length + selectedProfile.recurringTasks.length,
              <div className="grid gap-3" data-testid="panel-position-profile-tasks">
                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <ListChecks className="size-4 text-muted-foreground" />
                      Current work
                    </p>
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
                      {selectedProfile.currentIncompleteTasks.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {selectedProfile.currentIncompleteTasks.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                        No current work is tied to this profile.
                      </p>
                    ) : visibleProfileCurrentTasks.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                        No current work matches this search.
                      </p>
                    ) : (
                      visibleProfileCurrentTasks
                        .slice(0, 6)
                        .map((task) => renderProfileTaskButton(task, `${task.dueDate ?? "No date"} / ${urgencyLabel(task.urgency)} / ${task.estimatedMinutes} min`))
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Repeat2 className="size-4 text-muted-foreground" />
                      Recurring tasks
                    </p>
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
                      {selectedProfile.recurringTasks.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {selectedProfile.recurringTasks.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                        No recurring tasks are tied to this profile yet.
                      </p>
                    ) : visibleProfileRecurringTasks.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                        No recurring task matches this search.
                      </p>
                    ) : (
                      visibleProfileRecurringTasks
                        .slice(0, 6)
                        .map((task) => renderProfileTaskButton(task, `${inferTaskCadence(task)} / due ${task.dueDate ?? "not set"} / visible ${task.visibleFrom ?? "now"}`))
                    )}
                  </div>
                </div>
              </div>,
              true,
            )}

            {renderProfileSection(
              "Historical task memory",
              "Completed work and retained context for the next person in the role.",
              <History className="size-4 text-muted-foreground" />,
              selectedProfile.completedTasks.length,
              <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <History className="size-4 text-muted-foreground" />
                  Historical task memory
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowProfileHistory((value) => !value)}
                  data-testid="button-position-profile-history-toggle"
                >
                  {showProfileHistory ? "Hide context" : "Show context"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Personal tasks are excluded. Confidential work stays in role memory but remains access-controlled.
              </p>
              {showProfileHistory && (
                <div className="mt-3 space-y-2">
                  {selectedProfile.completedTasks.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No completed work has been captured for this profile yet.
                    </p>
                  ) : visibleProfileCompletedTasks.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No historical task matches this search.
                    </p>
                  ) : (
                    visibleProfileCompletedTasks.slice(0, 10).map((task) => (
                      <div key={String(task.id)} className="rounded-md bg-muted/45 px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedProfileTaskId(String(task.id))}
                            className="min-w-0 text-left font-medium text-foreground hover:text-brand-green"
                            data-testid={`button-position-profile-history-task-${task.id}`}
                          >
                            {task.title}
                          </button>
                          <span className="shrink-0 text-muted-foreground">{task.completedAt ? new Date(task.completedAt).toLocaleDateString() : task.dueDate ?? ""}</span>
                        </div>
                        {(task.description || task.completionNotes) && (
                          <p className="mt-1 line-clamp-3 text-muted-foreground">
                            {[task.description, task.completionNotes].filter(Boolean).join(" ")}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              </div>,
            )}

            {renderProfileSection(
              "Instructions",
              "Steps, notes, and context Donnit has learned from completed work.",
              <HelpCircle className="size-4 text-muted-foreground" />,
              selectedProfile.howTo.length,
              <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                <HelpCircle className="size-4 text-muted-foreground" />
                Instructions
              </p>
              {selectedProfile.howTo.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {selectedProfile.howTo.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Completion notes and task updates will appear here as practical instructions for the next person in this role.
                </p>
              )}
              </div>,
            )}

          </>
        )}
      </div>
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
      <Dialog open={assignmentDialogOpen && Boolean(selectedProfile)} onOpenChange={setAssignmentDialogOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-2xl`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>
              {mode === "transfer" ? "Transfer Position Profile" : "Delegate Position Profile"}
            </DialogTitle>
            <DialogDescription>
              Choose who should receive {selectedProfile?.title ?? "this profile"}. Employees can own more than one Position Profile.
            </DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} space-y-4`}>
            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-[1fr_1fr]">
              <div>
                <p className="ui-label">Selected profile</p>
                <select
                  value={selectedProfile?.id ?? ""}
                  onChange={(event) => {
                    const nextProfileId = event.target.value;
                    const nextProfile = repositoryProfiles.find((profile) => profile.id === nextProfileId) ?? null;
                    setSelectedProfileId(nextProfileId);
                    setTargetUserId(defaultTargetUserIdForProfile(nextProfile));
                    setSelectedProfileTaskId(null);
                  }}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="select-profile-transfer-profile"
                >
                  {repositoryProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.title} - {profileAssignmentLabel(profile, users)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current owner: {selectedProfile ? profileAssignmentLabel(selectedProfile, users) : "Not selected"}
                </p>
              </div>
              <div>
                <p className="ui-label">Transition type</p>
                <select
                  value={mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as "delegate" | "transfer";
                    setMode(nextMode);
                    setAssignmentFocus(nextMode);
                  }}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    <ReportMetric label="Will move" value={String(assignmentPreview.summary.activeTasks)} />
                    <ReportMetric label="Recurring" value={String(assignmentPreview.summary.recurringTasks)} />
                    <ReportMetric label="History" value={String(assignmentPreview.summary.historicalTasks)} />
                    <ReportMetric label="Excluded" value={String(assignmentPreview.summary.personalTasksExcluded)} />
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
                          {task.visibility === "confidential" && (
                            <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                              Confidential
                            </span>
                          )}
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
                      isSelected
                        ? "border-brand-green bg-brand-green/10"
                        : "border-border bg-background hover:border-brand-green/60 hover:bg-muted/40"
                    } ${isCurrentOwner && mode === "transfer" ? "cursor-not-allowed opacity-60" : ""}`}
                    data-testid={`button-profile-transfer-target-${user.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{user.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {titleCase(user.role)} {isCurrentOwner ? "/ current owner" : ""}
                        </p>
                      </div>
                      {isSelected && <Check className="size-4 shrink-0 text-brand-green" />}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {userProfiles.length === 0 ? (
                        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                          No assigned Position Profiles
                        </span>
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
            <Button variant="outline" onClick={() => setAssignmentDialogOpen(false)} disabled={assign.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => assign.mutate()}
              disabled={!targetUserId || assign.isPending || !canManageProfiles}
              data-testid="button-profile-transfer-confirm"
            >
              {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserCog className="size-4" />}
              {mode === "transfer" ? "Transfer profile" : "Start coverage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
