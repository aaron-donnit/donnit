# Donnit — App.tsx Module Split Plan

This document describes how to split `client/src/App.tsx` (12,695 lines, 541kb) into focused modules without changing behavior. The goal is **maintainability and AI-edit-ability** — once the split is done, future UI changes can target a single 200–800 line file instead of a 12k-line monolith.

**Apply with Claude Code.** This split is purely mechanical (move code, add imports). It must not change runtime behavior. See `CLAUDE_CODE_PROMPT.md` for the exact execution prompt to give Claude Code locally.

---

## Target folder structure

All new files live under `client/src/app/` (a sibling of the existing `client/src/components/`):

```
client/src/
├── App.tsx                          [SHRINKS to ~50 lines: just App + QueryClientProvider + AppShell + AppRouter]
└── app/
    ├── types.ts                     Types + Bootstrap + AppView (lines 95–504)
    ├── constants.ts                 DEFAULT_AGENDA_*, dialog class constants, REPEAT_DETAILS_PREFIX, EMAIL_SIGNATURE_*
    ├── lib/
    │   ├── date.ts                  localDateIso, addLocalDays, localTimeHHMM, normalizeTimeLabel, taskDueLabel (150–196)
    │   ├── urgency.ts               urgencyClass, urgencyLabel, statusLabels (506–525)
    │   ├── tasks.ts                 sortSubtasks, normalizeLocalSubtasks, apiErrorMessage, parseInheritedTaskContext (535–610)
    │   ├── task-text.ts             titleCase, positionTitleForUser, inferTaskCadence, taskRepeatLabel, taskKnowledgeText, inferToolsFromTasks (611–668)
    │   ├── repeat.ts                extractRepeatDetails, stripRepeatDetails, descriptionWithRepeatDetails, defaultRepeatDetails (1394–1422)
    │   ├── memory.ts                memoryStringArray, memoryRecordArray, memoryHowToNotes, memoryRecurringResponsibilities, recurringResponsibilitiesFromTasks, mergeRecurringResponsibilities, memoryRecentSignals, memorySourceMix, memoryAccessItems, LearnedHowToNote/LearnedRecurringResponsibility/LearnedTaskSignal types (670–833)
    │   ├── profiles.ts              mergeProfileRecord, buildEmptyPositionProfile, buildPositionProfiles, profilePrimaryOwnerId, profilesForUser, profileAssignmentLabel (836–1110)
    │   ├── permissions.ts           canAdministerProfiles, canManageWorkspaceMembers, canViewManagerReports, isActiveUser, teamMembersForUser, isVisibleWorkTask, latestOpenUpdateRequest (1045–1116)
    │   ├── agenda.ts                escapeIcsText, formatIcsLocalDateTime, formatAgendaTime, formatAgendaSlot, normalizeAgendaPreferences, normalizeAgendaSchedule, isTimeAtOrAfter, orderAgendaItems, downloadAgendaCalendar (1118–1231)
    │   ├── notifications.ts         buildNotifications, DerivedNotification type (8268–8363)
    │   ├── activity.ts              activityEventLabel, eventSearchText (7940–7963)
    │   ├── suggestions.ts           formatReceivedAt, parseSuggestionInsight, readCustomEmailSignature, readPreferredEmailSignatureTemplate, resolveEmailSignature, applyEmailSignature, EMAIL_SIGNATURE_TEMPLATES (7327–7395)
    │   └── hooks.ts                 useBootstrap, invalidateWorkspace (527–533)
    ├── chrome/
    │   ├── Wordmark.tsx             (1233–1264)
    │   ├── ThemeToggle.tsx          (1265–1293)
    │   ├── FunctionBar.tsx          FunctionAction type + FunctionActionButton + FunctionBar (1294–1386)
    │   ├── WorkspaceMenu.tsx        (1933–2002)
    │   ├── AppShellNav.tsx          (2003–2127)
    │   ├── SupportRail.tsx          (8102–8267)
    │   └── NotificationCenter.tsx   (8364–8435)
    ├── screens/
    │   ├── LandingPage.tsx          (1600–1932)  -- NOTE: there's also a DonnitLandingPage.tsx; consider deleting this duplicate after split
    │   ├── CommandCenter.tsx        (10758–12539) -- BIG: the main view orchestrator
    │   └── home/
    │       ├── ChatPanel.tsx        (1424–1599)
    │       ├── DueTodayPanel.tsx    (4339–4375)
    │       ├── OnboardingChecklist.tsx (2128–2202)
    │       ├── DemoWorkspaceGuide.tsx (2203–2331)
    │       └── MvpReadinessPanel.tsx (2332–2408)
    ├── tasks/
    │   ├── TaskRow.tsx              (2409–2586)
    │   ├── TaskList.tsx             (2587–3020)
    │   ├── TaskDetailDialog.tsx     (3021–3986)  -- BIG
    │   ├── RichNoteEditor.tsx       (3987–4071)
    │   ├── FloatingTaskBox.tsx      (4072–4338)
    │   ├── AcceptancePanel.tsx      (7188–7326)
    │   └── AssignTaskDialog.tsx     (8619–9073)
    ├── agenda/
    │   ├── AgendaPanel.tsx          (4376–4701)
    │   └── AgendaWorkDialog.tsx     (4702–4866)
    ├── inbox/
    │   ├── SuggestionCard.tsx       (7396–7883)
    │   ├── ApprovalInboxDialog.tsx  (8436–8618)
    │   ├── ManualEmailImportDialog.tsx (9074–9188)
    │   └── DocumentImportDialog.tsx (9189–9280)
    ├── reports/
    │   ├── ReportingPanel.tsx       (4867–5032)
    │   ├── TeamViewPanel.tsx        (5033–5423)
    │   └── ReportMetric.tsx         (5424–5432)
    ├── profiles/
    │   └── PositionProfilesPanel.tsx (5433–7187)  -- BIG, may need internal splits
    ├── activity/
    │   ├── DoneLogPanel.tsx         (7884–7939)
    │   └── ActivityLogPanel.tsx     (7964–8101)
    └── admin/
        ├── CalendarExportDialog.tsx (9281–9396)
        ├── ToolStatusBadge.tsx      (9397–9411)
        ├── ConnectedToolRow.tsx     (9412–9485)
        ├── WorkspaceMembersPanel.tsx (9486–9695)
        ├── WorkspaceMemberRow.tsx   (9696–10004)
        ├── TaskTemplatesPanel.tsx   (10005–10259)
        └── WorkspaceSettingsDialog.tsx (10260–10757)
```

After the split, the new `App.tsx` becomes roughly:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/components/AuthGate";
import NotFound from "@/pages/not-found";
import LandingPage from "@/app/screens/LandingPage";
import CommandCenter from "@/app/screens/CommandCenter";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/app">{() => <AuthGate>{(auth) => <CommandCenter auth={auth} />}</AuthGate>}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  return (
    <Router hook={useHashLocation}>
      <AppRouter />
    </Router>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppShell />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
```

---

## Ordering matters

Extract in this exact order so dependencies are always satisfied before they're imported:

1. **types.ts** — depends on nothing. Other modules import types from it.
2. **constants.ts** — depends on types only.
3. **lib/date.ts**, **lib/urgency.ts**, **lib/hooks.ts** — leaf utilities.
4. **lib/repeat.ts**, **lib/tasks.ts**, **lib/task-text.ts** — depend on types + date + repeat.
5. **lib/memory.ts** — depends on types + task-text.
6. **lib/profiles.ts** — depends on types + memory + permissions + task-text.
7. **lib/permissions.ts**, **lib/agenda.ts**, **lib/notifications.ts**, **lib/activity.ts**, **lib/suggestions.ts** — depend on earlier libs.
8. **chrome/** — small UI components, depend only on libs + shadcn primitives.
9. **screens/home/**, **tasks/**, **agenda/**, **inbox/**, **reports/**, **profiles/**, **activity/**, **admin/** — depend on libs + chrome.
10. **screens/LandingPage.tsx** — standalone, can extract any time.
11. **screens/CommandCenter.tsx** — the big orchestrator, extract LAST. It imports from everything above.
12. **App.tsx** — rewrite to the slim ~50-line version above.

---

## Hard rules (don't break the build)

1. **No behavior changes.** Code moves; logic stays identical. Don't rename variables, change types, or refactor inside extractions.
2. **Match the existing path alias.** `vite.config.ts` defines `@` → `client/src`. New imports use `@/app/...`.
3. **Default exports for screen-level components**, **named exports for utilities and small components.** Match what was already in scope.
4. **Re-exports at bottom of App.tsx**: lines 12684–end have `// Type-only re-exports kept for compatibility with any other modules that` — preserve those re-exports so external imports of `App.tsx` named exports still resolve. Forward them from the new modules.
5. **Keep `// @ts-...` comments and ESLint disables exactly where they are** — they often pin around specific behaviors.
6. **One PR per ~5 extracted modules.** Run `npm run check` (tsc) and `npm run test` after each PR. Vercel preview deploy confirms runtime works.
7. **Do not split `CommandCenter.tsx` or `PositionProfilesPanel.tsx` further in this pass.** Those internal splits are a separate, second pass once the top-level split is shipped.

---

## Verification per PR

After each batch:

```bash
npm run check       # tsc — must pass
npm run test        # vitest — must pass
npm run dev         # smoke-test the affected screen
```

For the Position Profiles PR, manually click through:
- Render profiles list
- Open a profile, check risk score
- Trigger a transfer/delegate (preview dialog renders)
- Edit handoff how-to memory (persists via mutation)

For the CommandCenter PR, smoke-test every primary action: Add Task, Assign, Approve from inbox, Build agenda, Open settings.

---

## What this gets you

After the split:

- **Editing the Tasks screen** = opening one 434-line `TaskList.tsx`, not scrolling through 12k lines.
- **Adding a new screen** = creating one file in `app/screens/`, not finding a place inside `App.tsx`.
- **AI-driven UI changes** (Cursor / Claude Code) finally work — these tools struggle when the entire app is in one file because they can't fit it in context.
- **Faster typechecking** — TypeScript can incrementally check changed modules.
- **Easier code review** — diffs target the actual component being changed.

No new dependencies. No behavior changes. No new tests required. Just a mechanical reorganization that makes everything after it cheaper.
