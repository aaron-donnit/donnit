# Claude Code prompt — split App.tsx into modules

**Paste this into Claude Code from the repo root.** It assumes you have read access to `client/src/App.tsx` and write access to the repo. Execute in batches; commit after each batch.

---

## Context

`client/src/App.tsx` is currently 12,695 lines / 541kb — every type, helper, screen, and dialog lives in a single file. This makes AI-driven UI changes (Cursor, Claude Code, Copilot) effectively impossible because the file doesn't fit in their context windows.

We need to split it into focused modules under `client/src/app/`. The full module map is in `handoff/MIGRATION_PLAN.md`. This prompt walks you through the extraction one batch at a time.

**Hard constraints, do not violate:**
- No behavior changes. Code moves; logic stays identical.
- Match the existing path alias: `@` → `client/src` (from `vite.config.ts`).
- Use named exports for utilities, default exports for screen-level components.
- Preserve every `// @ts-...` and ESLint disable comment exactly.
- Run `npm run check` and `npm run test` after each batch. Both must pass before committing.

---

## Batch 1 — Types + leaf utilities

Create these files by **moving** the corresponding line ranges out of `App.tsx` and into new files. After moving, add appropriate `import` statements at the top of `App.tsx` so the remaining code still resolves.

| New file | Source lines | Exports |
|---|---|---|
| `client/src/app/types.ts` | 95–504 | `type Id`, `type AgendaItem`, `type AgendaPreference`, `type AgendaPreferences`, `type AgendaSchedule`, `type User`, `type Task`, `type TaskEvent`, `type InheritedTaskContext`, `type LocalSubtask`, `type TaskSubtask`, `type TaskTemplateSubtask`, `type TaskTemplate`, `type WorkspaceState`, `type ChatMessage`, `type EmailSuggestion`, `type SuggestionReplyResult`, `type SuggestionDraftReplyResult`, `type SuggestionPatch`, `type Bootstrap`, `type PositionProfile`, `type ProfileAccessItem`, `type PersistedPositionProfile`, `type ContinuityPreviewTask`, `type ContinuityAssignmentPreview`, `type UrgencyClass` |
| `client/src/app/constants.ts` | 130–148, 1387–1392, plus `EMAIL_SIGNATURE_*` constants near 7371 | `DEFAULT_AGENDA_PREFERENCES`, `DEFAULT_AGENDA_SCHEDULE`, `CLIENT_TIME_ZONE`, `dialogShellClass`, `dialogHeaderClass`, `dialogBodyClass`, `dialogFooterClass`, `REPEAT_DETAILS_PREFIX`, `EMAIL_SIGNATURE_TEMPLATE_KEY`, `EMAIL_SIGNATURE_CUSTOM_KEY`, `EMAIL_SIGNATURE_TEMPLATES` |
| `client/src/app/lib/date.ts` | 150–196 | `localDateIso`, `addLocalDays`, `localTimeHHMM`, `normalizeTimeLabel`, `taskDueLabel` |
| `client/src/app/lib/urgency.ts` | 506–525 | `urgencyClass`, `urgencyLabel`, `statusLabels` |
| `client/src/app/lib/hooks.ts` | 527–533 | `useBootstrap`, `invalidateWorkspace` |

After moving:
- Run `npm run check`. Fix any import-resolution errors by adding `import { … } from "@/app/types"` etc. to `App.tsx`.
- Run `npm run test`.
- Commit: `chore(app): extract types + leaf utilities from App.tsx`.

---

## Batch 2 — Mid-level utilities

| New file | Source lines | Exports |
|---|---|---|
| `client/src/app/lib/repeat.ts` | 1394–1422 | `extractRepeatDetails`, `stripRepeatDetails`, `descriptionWithRepeatDetails`, `defaultRepeatDetails` |
| `client/src/app/lib/tasks.ts` | 535–610 | `sortSubtasks`, `normalizeLocalSubtasks`, `apiErrorMessage`, `parseInheritedTaskContext` |
| `client/src/app/lib/task-text.ts` | 611–668 | `titleCase`, `positionTitleForUser`, `inferTaskCadence`, `taskRepeatLabel`, `taskKnowledgeText`, `inferToolsFromTasks` |
| `client/src/app/lib/memory.ts` | 670–833 | `LearnedHowToNote`, `LearnedRecurringResponsibility`, `LearnedTaskSignal`, `memoryStringArray`, `memoryRecordArray`, `memoryHowToNotes`, `memoryRecurringResponsibilities`, `recurringResponsibilitiesFromTasks`, `mergeRecurringResponsibilities`, `memoryRecentSignals`, `memorySourceMix`, `memoryAccessItems` |
| `client/src/app/lib/permissions.ts` | 1045–1116 | `canAdministerProfiles`, `canManageWorkspaceMembers`, `canViewManagerReports`, `isActiveUser`, `teamMembersForUser`, `isVisibleWorkTask`, `latestOpenUpdateRequest` |
| `client/src/app/lib/profiles.ts` | 836–1110 (minus permissions) | `mergeProfileRecord`, `buildEmptyPositionProfile`, `buildPositionProfiles`, `profilePrimaryOwnerId`, `profilesForUser`, `profileAssignmentLabel` |
| `client/src/app/lib/agenda.ts` | 1118–1231 | `escapeIcsText`, `formatIcsLocalDateTime`, `formatAgendaTime`, `formatAgendaSlot`, `normalizeAgendaPreferences`, `normalizeAgendaSchedule`, `isTimeAtOrAfter`, `orderAgendaItems`, `downloadAgendaCalendar` |
| `client/src/app/lib/activity.ts` | 7940–7963 | `activityEventLabel`, `eventSearchText` |
| `client/src/app/lib/suggestions.ts` | 7327–7395 | `formatReceivedAt`, `parseSuggestionInsight`, `readCustomEmailSignature`, `readPreferredEmailSignatureTemplate`, `resolveEmailSignature`, `applyEmailSignature` |
| `client/src/app/lib/notifications.ts` | 8268–8363 | `buildNotifications`, `DerivedNotification` (type) |

Test + commit: `chore(app): extract mid-level utilities`.

---

## Batch 3 — Chrome (top-level UI)

Each becomes a `.tsx` file with a default export and named props type.

| New file | Source lines |
|---|---|
| `client/src/app/chrome/Wordmark.tsx` | 1233–1264 |
| `client/src/app/chrome/ThemeToggle.tsx` | 1265–1293 |
| `client/src/app/chrome/FunctionBar.tsx` | 1294–1386 (includes `FunctionAction` type, `FunctionActionButton`, `FunctionBar`) |
| `client/src/app/chrome/WorkspaceMenu.tsx` | 1933–2002 |
| `client/src/app/chrome/AppShellNav.tsx` | 2003–2127 |
| `client/src/app/chrome/SupportRail.tsx` | 8102–8267 |
| `client/src/app/chrome/NotificationCenter.tsx` | 8364–8435 |

Test + commit: `chore(app): extract chrome components`.

---

## Batch 4 — Home screen components

| New file | Source lines |
|---|---|
| `client/src/app/screens/home/ChatPanel.tsx` | 1424–1599 |
| `client/src/app/screens/home/DueTodayPanel.tsx` | 4339–4375 |
| `client/src/app/screens/home/OnboardingChecklist.tsx` | 2128–2202 |
| `client/src/app/screens/home/DemoWorkspaceGuide.tsx` | 2203–2331 |
| `client/src/app/screens/home/MvpReadinessPanel.tsx` | 2332–2408 |

Test + commit: `chore(app): extract home screen panels`.

---

## Batch 5 — Tasks

| New file | Source lines |
|---|---|
| `client/src/app/tasks/TaskRow.tsx` | 2409–2586 |
| `client/src/app/tasks/TaskList.tsx` | 2587–3020 |
| `client/src/app/tasks/TaskDetailDialog.tsx` | 3021–3986 |
| `client/src/app/tasks/RichNoteEditor.tsx` | 3987–4071 |
| `client/src/app/tasks/FloatingTaskBox.tsx` | 4072–4338 |
| `client/src/app/tasks/AcceptancePanel.tsx` | 7188–7326 |
| `client/src/app/tasks/AssignTaskDialog.tsx` | 8619–9073 |

Smoke-test: open a task, edit it, mark complete, assign to a teammate. Test + commit.

---

## Batch 6 — Agenda

| New file | Source lines |
|---|---|
| `client/src/app/agenda/AgendaPanel.tsx` | 4376–4701 |
| `client/src/app/agenda/AgendaWorkDialog.tsx` | 4702–4866 |

Smoke-test: build agenda, export ICS. Test + commit.

---

## Batch 7 — Inbox / suggestions

| New file | Source lines |
|---|---|
| `client/src/app/inbox/SuggestionCard.tsx` | 7396–7883 |
| `client/src/app/inbox/ApprovalInboxDialog.tsx` | 8436–8618 |
| `client/src/app/inbox/ManualEmailImportDialog.tsx` | 9074–9188 |
| `client/src/app/inbox/DocumentImportDialog.tsx` | 9189–9280 |

Smoke-test: approve a suggestion, manual-import an email. Test + commit.

---

## Batch 8 — Reports + team

| New file | Source lines |
|---|---|
| `client/src/app/reports/ReportingPanel.tsx` | 4867–5032 |
| `client/src/app/reports/TeamViewPanel.tsx` | 5033–5423 |
| `client/src/app/reports/ReportMetric.tsx` | 5424–5432 |

Smoke-test: open Reports + Team views. Test + commit.

---

## Batch 9 — Position Profiles

| New file | Source lines |
|---|---|
| `client/src/app/profiles/PositionProfilesPanel.tsx` | 5433–7187 |

This is a 1,755-line file. **Do not split it further in this pass** — moving it whole is enough. A second-pass refactor (separate PR) can break it into sub-components: profile list, profile detail header, current open work, recurring responsibilities, how-to memory, tools/access, transition checklist, continuity activity.

Smoke-test: open profiles list, open a profile, run risk audit. Test + commit.

---

## Batch 10 — Activity + admin

| New file | Source lines |
|---|---|
| `client/src/app/activity/DoneLogPanel.tsx` | 7884–7939 |
| `client/src/app/activity/ActivityLogPanel.tsx` | 7964–8101 |
| `client/src/app/admin/CalendarExportDialog.tsx` | 9281–9396 |
| `client/src/app/admin/ToolStatusBadge.tsx` | 9397–9411 |
| `client/src/app/admin/ConnectedToolRow.tsx` | 9412–9485 |
| `client/src/app/admin/WorkspaceMembersPanel.tsx` | 9486–9695 |
| `client/src/app/admin/WorkspaceMemberRow.tsx` | 9696–10004 |
| `client/src/app/admin/TaskTemplatesPanel.tsx` | 10005–10259 |
| `client/src/app/admin/WorkspaceSettingsDialog.tsx` | 10260–10757 |

Test + commit.

---

## Batch 11 — Landing page

| New file | Source lines |
|---|---|
| `client/src/app/screens/LandingPage.tsx` | 1600–1932 |

Note: there's also a `client/src/components/DonnitLandingPage.tsx`. After moving, check whether `App.tsx` references one or both. If `LandingPage` is the one in the `<Route path="/">`, you can delete `components/DonnitLandingPage.tsx` if it's unused — but **only** after confirming with grep that it has no imports anywhere.

Smoke-test: open `/`, verify landing renders. Test + commit.

---

## Batch 12 — CommandCenter (the big one)

| New file | Source lines |
|---|---|
| `client/src/app/screens/CommandCenter.tsx` | 10758–12539 |
| (kept inline in CommandCenter for now) | `Stat` (12540–12552), `RestrictedView` (12553–~12650) |

This is the main orchestrator — 1,782 lines that wire every panel together. Move it whole; do not split internals in this pass.

Smoke-test: every primary action — Add Task, Assign, Approve from inbox, Build agenda, Open settings, switch between Home/Tasks/Agenda/Inbox/Team/Profiles/Reports/Admin.

Test + commit.

---

## Batch 13 — Slim down App.tsx

Now `App.tsx` should only contain:
- imports from the new modules
- `AppRouter`, `AppShell`, `App` (lines 12652–12682)
- any "type-only re-exports kept for compatibility" comment at the bottom (12684–end) — preserve these but re-export from the new modules.

End state: `App.tsx` is roughly 50 lines. Run `npm run check`, `npm run test`, `npm run build`. Deploy preview to Vercel and smoke-test the production build. Commit: `chore(app): App.tsx is now a thin shell`.

---

## After the split — what's now possible

1. **Targeted UI updates** — Cursor / Claude Code can fit `TaskList.tsx` (434 lines) in context and refactor it cleanly. Same for any other screen.
2. **Second-pass splits** — `CommandCenter.tsx` (1,782) and `PositionProfilesPanel.tsx` (1,755) are still big but isolated. They can be split into sub-components in follow-up PRs without touching anything else.
3. **Visual refresh** — applying the design changes from the prototype (the indigo→green re-skin, new agenda layout, polished reports) becomes per-file work, not a re-platforming of the entire app.

The next thing I'd ask Claude Code to do, after this split lands, is:

> Read `handoff/UI_REFRESH.md` and update `client/src/app/tasks/TaskList.tsx` to match. Preserve all data props and event handlers exactly. Only change the JSX structure and Tailwind classes.
