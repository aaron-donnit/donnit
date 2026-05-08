# Donnit Codex Project History

Last updated: 2026-05-08

This document captures the working history, product decisions, implementation progress, testing notes, and standing context from the Codex build thread for Donnit. It is intended to preserve continuity across future development sessions.

## Core Product Definition

Donnit is a workforce continuity and AI work-capture product for employers, managers, and admins.

The product goal is to prevent work from being lost when:

- Employees leave the organization.
- Employees change roles internally.
- Managers temporarily cover vacant positions.
- Work starts informally in Slack, email, SMS, documents, meetings, or chat.
- Recurring institutional knowledge lives in a person's head instead of a durable system.

Donnit should:

- Capture loose work from chat, email, Slack, SMS, documents, and future tools.
- Use AI to interpret source text into clean, professional tasks instead of copying raw text.
- Ask for approval before turning scraped or imported content into tasks.
- Prioritize tasks by urgency, due date, and estimated completion time.
- Build daily agendas from tasks and calendar availability.
- Sync approved agenda blocks to calendar as timed events.
- Support assigning, reassigning, delegating, and collaborating on tasks.
- Track task progress, notes, subtasks, attachments, and source context.
- Give managers team visibility without making the product feel like surveillance.
- Maintain admin-only Position Profiles tied to jobs, not people.
- Preserve institutional knowledge in Position Profiles so a new employee can inherit the role's recurring work, how-to context, tools, responsibilities, and active tasks.

## Founder/CEO Product Direction

The founder asked Codex to act as CTO, senior engineer, chief product officer, UI/UX lead, and product-market-fit reviewer for Donnit.

Important CEO preferences and product rules:

- Position Profiles are tied to job titles, not individual people.
- Position Profiles are admin-only.
- Admins should see a repository list of Position Profiles titled by job title, such as "Executive Assistant to the CEO".
- Admins can create, rename, assign, reassign, delegate access, and delete/archive Position Profiles.
- Temporary vacancy coverage should not mix the vacant role with the manager's own profile. Managers should switch views.
- A new employee assigned a Position Profile should see only the assigned profile's work, not the manager's own work.
- During vacancy, managers/admins can assign a delegate for a predetermined time or indefinitely.
- Current incomplete tasks should be included in Position Profiles.
- Recurring tasks should be detected and preserved.
- Institutional knowledge should update automatically, but with clear rules to avoid losing valuable context.
- "How to complete this task" context should be available in the task box through a small question/help icon.
- Login/access credentials are currently expected to live on Donnit's backend, with admin controls to reset, remove, grant access, and create accounts. This remains a future high-security feature.
- Popup windows must fit within the screen and should not touch viewport borders on any side. Dialogs should use internal scrolling.
- The UI should prioritize high-frequency user actions and hide lower-frequency sync/settings tools behind menus.
- The product should feel simple, clear, modern, and effective, not like a dense settings document.

## Market and Go-To-Market Context

Donnit was assessed as a potentially viable SaaS product if positioned around workforce continuity rather than generic task management.

Positioning notes:

- Avoid competing head-on as another project manager.
- Lead with workforce continuity, institutional knowledge, AI task capture, role handoff, and operational continuity.
- Buyers are likely HR leaders, operations leaders, department heads, agency owners, office managers, and managers at medium-sized businesses.
- The product must be palatable to both employers and employees. Avoid language that dehumanizes employee churn.
- Emphasize support, clarity, smoother transitions, and reduced lost work.
- Avoid manager-tracking or surveillance language.

Landing page conversion priorities discussed:

- Primary CTA: Book a demo.
- Secondary CTA: Start trial or See pricing.
- Add pricing or at least a pricing path.
- Add social proof, integrations, AI mention, footer links, and clear ICP framing.
- Use a premium but approachable design.
- Use subtle motion and actual product visuals.
- Use brand colors, with natural supporting color.
- Use a more traditional, cleaner font than the initial page.
- Add a workforce continuity section.
- Fix favicon to better match the brand/logo, such as the green checkmark.

## Infrastructure and Deployment Context

Repository:

- GitHub: https://github.com/Rosterstack/donnit-1.git
- Primary deployed app: https://donnit-1.vercel.app
- Vercel deployment/project referenced earlier: donnit-1-eq6j6ws2t-aaron-9095s-projects.vercel.app

Connected tools/plugins:

- Vercel connected to Codex.
- Supabase connected to Codex, though the founder previously could not see the Donnit project in their Supabase dashboard.
- Google/Gmail OAuth has been configured and tested.
- Slack and SMS bridges have been built for testing and future MVP use.

Known environment variables and secrets mentioned:

- `DONNIT_HEALTH_TOKEN` was added.
- `OPENAI_API_KEY` is required for AI task interpretation.
- `DONNIT_AI_MODEL` is optional.
- `DONNIT_SLACK_WEBHOOK_TOKEN` protects Slack suggestion/event test calls.
- `SLACK_SIGNING_SECRET` verifies Slack Events API calls.
- `SLACK_BOT_TOKEN` enables Slack user lookup and direct outbound Slack replies.
- `DONNIT_SMS_WEBHOOK_TOKEN` protects SMS inbound test calls.
- `TWILIO_AUTH_TOKEN` verifies Twilio webhooks and is required for direct SMS send.
- `TWILIO_ACCOUNT_SID` and `TWILIO_FROM_NUMBER` are required for direct SMS replies.
- Google OAuth currently uses Gmail read access and Calendar access. Direct Gmail sending is not yet enabled because it requires adding Gmail send scope.

Important migrations referenced:

- `0008_task_relationships.sql`
- `0009` migration, exact filename not captured in current context.
- `0010_document_source_and_future_task_primitives`, required for subtasks/document/future task primitives. The founder applied it after a 500 subtask error.

## AI and Model Context

The AI task generator and cross-source task interpreter use OpenAI through the server route.

Implementation note:

- `OPENAI_API_KEY` powers AI interpretation for chat, Gmail/email, Slack, SMS, and document task suggestions.
- `DONNIT_AI_MODEL` can override the model.
- If no OpenAI key is set, Donnit falls back to deterministic parsing.

Product quality expectations for AI:

- AI should interpret source text, not copy and paste it.
- Example: a receipt for ChatGPT at $55 should become something like "Reconcile ChatGPT expense ($55.00)" or "You received a receipt for ChatGPT at $55.00. Do you want to create a task to reconcile this expense?"
- Assignment prompts should not produce titles like "Assign Jordan". The title should be the work, while Jordan should be treated as the assignee hint if a user named Jordan exists.
- If Jordan is not a user in the workspace, Donnit should clean up the title and avoid pretending assignment succeeded.
- Time parsing should preserve exact estimates, such as 1.5 hours = 90 minutes, not 300 minutes.
- Past due dates should be recognized and urgency should reflect that.
- Example problematic prompt: "For me thats , due on may 4, 2026 for me to create the 2026 Q3 HR roadmap" did not parse the due date or cleanly interpret the task. This remains a quality benchmark.

## Completed Product Milestones

The CEO-approved milestone plan lives in `docs/PRODUCT_LEAD_MVP_EXECUTION_PLAN.md`.

Completed/approved steps:

- Step 1: Stabilize the Daily Work Surface.
- Step 2: Make Position Profiles the Flagship Feature.
- Step 3: Persist Serious Work Data.
- Step 4: Improve AI Task Interpretation and Trust.
- Step 5: Build the Manager Dashboard.
- Step 6: Finish Agenda Intelligence.
- Step 7.1: Gmail and Google Calendar production hardening.
- Step 7.2: Slack event bridge controls.
- Step 7.3: SMS inbound bridge.
- Step 7.4: Outbound reply actions from Donnit.

Recent important commits:

- `f667a12` Expose email import actions.
- `8c696f1` Add outbound reply actions.
- `6f3f188` Harden SMS inbound bridge.
- `724a9fb` Add Slack event bridge controls.
- `cc50dd9` Keep app open during Google reconnect.
- `0d30c57` Fix Gmail reconnect app redirect.
- `e939e0c` Harden Google integration controls.
- `b28863a` Finish agenda intelligence.
- `3866877` Add manager task update requests.
- `6a01d98` Add demo team seed for manager testing.
- `3d1c00c` Build manager team dashboard.
- `e37eb14` Improve AI task interpretation trust.

## Current App Capabilities

Core work surface:

- Chat to task.
- Approval inbox for suggested/imported tasks and pending assigned tasks.
- Task list with task detail opening.
- Task assignment, reassignment, delegation, and collaborators.
- Donnit button to complete tasks.
- Subtasks.
- Notes/progress updates.
- Bell notifications.
- Active work floating box.
- Agenda panel and agenda work screen.
- Reporting/source mix.
- Team dashboard for managers.
- Admin/workspace settings.
- Position Profiles repository and controls.

Integrations:

- Gmail scan for unread Gmail.
- Manual email import, now exposed in the UI.
- Google Calendar agenda export.
- Slack suggest endpoint.
- Slack Events API bridge endpoint.
- SMS inbound endpoint supporting Donnit JSON and Twilio form payloads.
- Outbound reply actions from suggestions:
  - Email: opens prefilled mail draft.
  - Slack: sends through bot token when available, otherwise copy fallback.
  - SMS: sends through Twilio when configured, otherwise copy fallback.

## Key Bugs and Resolutions

Resolved:

- Assign task function initially unavailable; later confirmed working.
- Task opening under the to-do list initially failed; later fixed.
- Agenda built but location unclear; later agenda UI/work screen improved.
- Calendar export initially created all-day events; fixed to create timed agenda blocks around current calendar availability.
- Gmail scan initially errored because Gmail API was not enabled; later fixed.
- Email suggestions had invalid input syntax for timestamp/time zone; fixed.
- Slack webhook testing failed with placeholder `YOUR_DEPLOYED_APP_URL`; corrected to deployed app URL.
- Slack token was typed as a command instead of a PowerShell variable; corrected.
- Slack `/api/integrations/slack/suggest` initially returned auth/token errors; fixed after proper Vercel env token configuration.
- Approval inbox was hard to find; later exposed through function bar/hamburger.
- Reporting source mix was hard to find; reporting action exposed.
- Gmail reconnect forced logout; fixed by using popup flow and polling so Donnit stays open.
- Subtask 500 error resolved after applying migration `0010_document_source_and_future_task_primitives`.
- Active work window close X did not close; fixed.
- Active work window did not persist across tabs; fixed.
- Approval inbox had no visible email import path in production because manual import was dev-only/conditional; fixed in `f667a12`.

Current/recent issue:

- Founder reported no emails in the Approval inbox. Explanation: the inbox only shows pending suggestions. If Gmail has no unread actionable email, the queue is empty. Manual email import is now visible to create a test suggestion.

## Manual Email Import Current UX

After commit `f667a12`, email import should be visible in production in these places:

- Add task dropdown -> Import email.
- Hamburger menu -> Tools sync -> Import email.
- Empty Approval inbox -> Scan email and Import email buttons.

Recommended test email:

- From: `alex@example.com`
- Subject: `Action needed: vendor contract`
- Body: `Please review the ACME vendor contract by Friday and confirm whether we should renew.`

Expected flow:

1. Import email.
2. The email becomes a pending suggestion.
3. Open Approval inbox.
4. Review the AI-created task suggestion.
5. Edit, approve, dismiss, or reply.

## Slack and SMS Context to Remember

Slack:

- Slack manual test endpoint:
  - `POST https://donnit-1.vercel.app/api/integrations/slack/suggest`
  - Header: `x-donnit-ingest-token: <DONNIT_SLACK_WEBHOOK_TOKEN>`
- Slack Events API endpoint:
  - `/api/integrations/slack/events`
- Slack bridge should eventually support unread-delay logic so Donnit suggests tasks only if a Slack remains unread/unanswered for a configurable period, such as 2 minutes.
- Slack direct outbound replies require `SLACK_BOT_TOKEN`, channel availability, and bot permissions such as `chat:write`.

SMS:

- SMS inbound endpoint:
  - `/api/integrations/sms/inbound`
- It accepts Donnit JSON or Twilio form payloads (`Body`, `From`, `To`, `MessageSid`).
- It can use `DONNIT_SMS_WEBHOOK_TOKEN` for testing or Twilio signature verification with `TWILIO_AUTH_TOKEN`.
- SMS direct outbound replies require `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.
- Founder wants a future mobile/app experience where partial functionality allows adding/completing tasks and texting Donnit commands such as "add a task" or "mark this task complete".

## UI/UX Standing Notes

Important UI rules from the founder:

- All popup windows must fit within the viewport.
- Dialogs should not hit the top, bottom, left, or right screen borders.
- Long popup content should scroll internally.
- The UI should not feel like a long document.
- High-frequency actions should be obvious.
- Lower-frequency tools should live in dropdowns/hamburger menus.
- Chat box should be stable, not grow past the screen, and should support scrolling previous messages.
- Pressing Enter in chat should submit; Shift+Enter should create a new line.
- The task detail popup should put reassignment/delegation/collaboration at bottom left as a dropdown.
- The task detail popup should put the Donnit completion button at bottom right.
- Donnit icon at top should take the user home/main page.
- Notifications should not clear on hover. They should clear only when clicked/reviewed or the task is completed.
- Clicking a notification should open the notification source and remove it from notifications.

## Landing Page Context

The landing page is meant to convert visitors to demo, trial/purchase, or login.

Brand/design references:

- Brand guidelines were provided in `donnit_brand_guidelines.pdf` outside the repo context.
- Semrush.com was used as a design reference for templating, color, static/kinetic visuals, font, and whitespace.

Landing page decisions:

- Tone should be between simple and premium, leaning premium.
- Hero should use simple text and subtle motion.
- Maintain brand colors while allowing natural supporting color.
- Primary CTA should be Book a demo.
- Copy must be punchy, clear, modern, and human.
- Avoid dehumanizing language such as "People change, the work still needs a home."
- Avoid overemphasizing manager tracking.
- Add workforce continuity section.
- Reduce too much rigid structure and robotic feel.
- Use actual visuals/animations from the tool interface.

## Product-Market-Fit Review Feedback to Remember

As a manager at a medium-sized business, the product should prove value through:

- A central place for all tasks.
- Easy agenda creation.
- Task visibility across team members.
- Work process clarity.
- Position Profiles that protect against lost institutional knowledge.
- Task capture from real work sources.
- Smooth handoff and vacancy coverage.

Priority product improvements from the PMF review:

- Make the first value moment clearer.
- Make approval inbox and imported suggestions easier to find.
- Improve AI task clarity and trust.
- Make Position Profiles feel like the flagship feature.
- Make Team view actionable for managers.
- Make agenda review/edit/export flow obvious.
- Keep outside tool integrations as Step 7 and build each individually.

## Future Product Backlog

Requested or discussed future features:

- Upload PDF/Word and parse into tasks.
- Auto-group tasks that should be done at the same time.
- Send messages back to outside tools from Donnit.
- Reply to an imported/scraped email from Donnit.
- Connect to a tool/vault that stores logins for all tools associated with a position.
- Admin controls for credentials: reset, remove access, grant access, create accounts.
- Tasks with subtasks.
- Adjustable custom times for tasks.
- Notifications clear after reviewed.
- Send SMS to a Donnit number to create tasks.
- SMS command layer for adding, completing, or updating tasks.
- Mobile app or app-like experience with partial task functionality.
- Active task floating work box that stays visible above other browser tabs/windows unless minimized or closed. Note: staying above other browser tabs is limited by web platform constraints and may require native app/PWA/browser extension.
- Customized agendas based on batches and AI grouping.
- Agenda approval before calendar export.
- Admin can change names of Position Profiles.
- Automatic scraping from Slack/email as messages arrive, with unread-delay logic.
- Manager Team dropdown with assigned team members, overdue/current/completed task views, and request-update actions.
- Direct Gmail send with `gmail.send` scope.
- Teams, Outlook, Drive, and credential/access vault integrations.
- First-login onboarding.
- Pilot analytics.
- Trust/security pages.

## Immediate Next Step in the Milestone Plan

The next planned milestone after Step 7.4 is Step 8: Onboarding and Pilot Readiness.

Step 8 goals:

- Add first-login setup.
- Help a design partner connect tools, invite team, create first Position Profile, and send first chat-to-task entry.
- Add demo workspace seed data where needed.
- Add pilot analytics such as tasks captured, suggestions approved/dismissed, agenda usage, overdue reduction, and Position Profile usefulness.
- Add trust/security posture for buyers.

## Current Production Checkpoint

As of 2026-05-08:

- Latest pushed commit: `f667a12`.
- Vercel status for that commit returned success.
- TypeScript check passed.
- Production build passed when run outside the sandbox due to a local Vite config read permission issue inside the sandbox.

