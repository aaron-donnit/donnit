# Donnit Starter Memory

Last updated: 2026-05-14

This is the global operating memory Donnit should load for every workspace before customer-specific memory exists. It is not private client data and should not be written into a customer's Position Profile memory by default.

## Why This Exists

Position Profile memory should preserve how a specific role works inside a specific customer workspace. Donnit also needs a product-level memory layer that teaches the LLM how Donnit itself should interpret messages, route tasks, speak naturally, and protect workspace boundaries.

## Current Implementation

The starter memory lives in `server/intelligence/donnit-starter-memory.ts` and is passed into the task extraction prompt as `donnitStarterMemory`.

## Starter Categories

- Task interpretation: rewrite messy user input into clean action titles.
- Assignment: distinguish task owners from contacts.
- Position Profiles: treat profile names as routing targets and attach tasks to matching profiles.
- Conversation: ask short clarifying questions when owner, due date, task title, or time is ambiguous.
- Natural responses: answer like an operator with owner, task, date, recurrence, privacy, and profile context.
- Navigation: understand Donnit's main surfaces such as chat, tasks, needs review, agenda, team view, admin, and Position Profiles.
- Safety: keep memory workspace-scoped, exclude personal tasks from role memory, and preserve confidential work with restricted visibility.

## Next Step

Once the MVP is stable, promote this from a static backend seed into an editable workspace-level AI memory table so admins can add customer-specific vocabulary, department names, role names, tool names, and response preferences.
