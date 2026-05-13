# UI refresh — mapping the prototype to your existing codebase

This document maps the design changes shown in `Donnit Command Center.html` (and the matching `Donnit Landing Page.html`) onto your real codebase. Apply these after the App.tsx module split is complete.

**Your brand stays the brand.** Brand green `#00C27A`, warm-white `#F7F5F0`, charcoal `#1C1F24`, DM Sans + Syne — none of these change. The prototype was re-skinned to your brand tokens in `client/src/index.css`. What changes is the **visual rhythm, density, and color richness** of individual screens.

---

## What the prototype demonstrates

1. **Colored bucket-header tints** for grouped task lists (red for Overdue, amber for Today, green for Upcoming/Done). Semantic, not branded.
2. **Project tags as color-tinted pills** — each project gets its own accent (Finance green, Board indigo, Operations amber, etc), used consistently across task rows, detail panels, and reports.
3. **KPI cells with 2px colored top accents** — at-a-glance variety in status strips.
4. **Tinted priority badges** — soft background fill behind the urgency icon (red tint for urgent, amber for high, green for medium).
5. **Polished detail-panel rhythm** — meta grid with mono labels, dashed-rule between subtasks, mono dates.
6. **Hover-to-expand nav rail** with section labels + counts.
7. **Reports screen** — KPI cards with 2px top accents, throughput dual-bars, project distribution stacked bar, continuity-readiness bars colored by health, 6-week activity heatmap.
8. **Team screen** — color-coded member cards with capacity meters that turn amber/red over 90%/100%, workload breakdown bars.
9. **Refreshed landing page** — Syne headline with green-accented punchline, embedded product mock, dark "how it works" flow section, profile-card mock, three-tier pricing with "Most Popular" green halo.

---

## Token additions you may want

These extend (not replace) your existing tokens in `client/src/index.css`:

```css
:root {
  /* Tinted backgrounds — useful for soft fills behind icons/badges/headers */
  --tint-danger: 13 90% 95%;        /* #fde8e0 */
  --tint-warning: 46 90% 92%;       /* #fcf2d2 */
  --tint-success: var(--brand-green-pale);
  --tint-info: 217 75% 94%;         /* #e6eef9 */

  /* Project palette — for project tags / category chips. Pick HSLs from your existing chart-* */
  --proj-finance: 145 50% 50%;
  --proj-board: 280 50% 60%;
  --proj-operations: 60 65% 50%;
  --proj-people: 350 60% 65%;
  --proj-customer: 200 60% 55%;
}

.dark {
  --tint-danger: 13 50% 18%;
  --tint-warning: 46 50% 18%;
  --tint-success: 156 35% 18%;
  --tint-info: 217 50% 22%;
}
```

Then in `tailwind.config.ts`:

```ts
colors: {
  // ... existing
  "tint-danger": "hsl(var(--tint-danger) / <alpha-value>)",
  "tint-warning": "hsl(var(--tint-warning) / <alpha-value>)",
  "tint-success": "hsl(var(--tint-success) / <alpha-value>)",
  "tint-info": "hsl(var(--tint-info) / <alpha-value>)",
}
```

---

## Per-screen guidance

### Task list (`app/tasks/TaskList.tsx` after the split)

- **Group rows by bucket** (Overdue / Today / Upcoming / Delegated / Done) with sticky tinted-gradient headers. The gradient fades the tint into the surface over 240px.
- **Compact density** — row height 38px (comfy), 30px (compact), 48px (spacious). Drive from a `data-density` attribute or CSS variable on the list container.
- **Row layout** — `[checkbox] [priority pill] [title + source chip] [project tag] [subtask count] [recurrence icon] [due] [assignee]`. Use grid columns, not inline flow.
- **Priority pill** — `bg-tint-danger text-destructive` for urgent, `bg-tint-warning text-brand-amber` for high, `bg-brand-green-pale text-brand-green` for medium.
- **Source chip** — mono-font, neutral background, 1px border — distinguishes Gmail / Slack / Manual / Doc / Cal at a glance.

### Task detail panel (`app/tasks/TaskDetailDialog.tsx`)

- Right-side panel layout: `[id + source + actions]`, `[h2 title]`, `[meta grid: 90px label / value]`, `[notes textarea]`, `[subtasks with checkboxes]`, `[related sources]`, `[activity feed]`.
- Meta labels in **mono uppercase 10px tracking-wide** — gives the panel its structured feel.
- Activity feed uses 16px icons in `text-muted-foreground` + colored "who" + muted "what" + mono "when".

### Home (`app/screens/home/...`)

- **Status strip** with 4–5 cells, each cell has a 2px colored top accent matching its meaning (danger/warn/success/info/accent). Numbers in 22px Syne, labels in 10.5px mono uppercase.
- **Chat composer** — keep your existing live-parse chip pattern (you already have `.composer-chip`/`.composer-preview`). When a chip is set, fill it with `bg-brand-green-pale text-brand-green`.

### Agenda (`app/agenda/AgendaPanel.tsx`)

- Hourly grid 56px tall per hour. Time labels on a 64px left column in mono.
- Events positioned absolute by hour offset, colored by project, with a 3px left-border in project color + tinted background fill.
- "Now" line — 1.5px brand-green line with a pulsing dot anchored at the left margin.
- "Next up" focus card with the brand-green gradient background; "Today's shape" stacked-bar showing focus / meetings / buffer in different colors.

### Reports (`app/reports/ReportingPanel.tsx`)

- 12-column grid. KPIs span 3 cols each. Charts span 6 or 12.
- KPI cards have a 2px top border in their semantic color (success/info/warning/danger).
- Throughput chart: dual bars per day (created in `accent`, completed in `success`). 56–110px tall.
- Project distribution: horizontal stacked bar 10px tall, color blocks per project.
- Activity heatmap: 7-day × 6-week grid, color intensity mapped to value via `color-mix(in srgb, var(--accent) ${10 + v * 18}%, transparent)`.

### Team (`app/reports/TeamViewPanel.tsx`)

- Card grid `repeat(auto-fill, minmax(280px, 1fr))`.
- Each card has a 3px left-border in the member's color, 36px rounded avatar in that color with a soft glow.
- Stats row: Open / Today / Overdue — Overdue values turn `text-destructive` when >0.
- Capacity meter — turns amber over 85%, red over 95%. Over 100% shows a 4px red right-edge mark.
- Workload breakdown — small horizontal bars per work category.

### Position Profiles (`app/profiles/PositionProfilesPanel.tsx`)

This is the 1,755-line file — touch it carefully. Visual changes worth landing:

- **Profile list** in a 280px sidebar — each item shows name, holder, and a one-line stat (`{open} open · {recurring} recurring · {readiness}%`). Status dot before stat: green (good), amber (warn), red (gap risk).
- **Hero** — 56×56 avatar with member-color gradient, name in 19px Syne, sub-line with department + tenure, right-aligned stats (Open / Recurring / Completed).
- **Readiness bar** at the top — 6px meter, gradient ends in green/amber by score.
- **2×2+ grid below** — Current open work, Recurring responsibilities, How-to memory, Tools & access (as colored pills), Transition context (captured / partial), Continuity activity timeline.

### Settings / Admin

- Sidebar nav (220px) with grouped sections (Account / Workspace), brand-green left accent on the active item.
- Right pane: section h2 in 16px Syne, sub-text in muted, then a series of `[label + hint] / [control]` rows separated by 1px borders.
- Switches use brand-green when on.
- Integrations: card grid, each card has a colored icon chip in the integration's brand color (Gmail red, Slack purple, Calendar green, etc).

---

## Landing page

`Donnit Landing Page.html` shows the marketing-side version of the same design language. Hero with Syne headline + green-accented punchline, embedded mini-app preview, sources band as colored pills, 3 feature pillars, stats band, dark "how it works" flow section that flips to charcoal background, Position Profiles section with profile-card mock, 3-tier pricing with green-halo "Most Popular" middle card, gradient CTA band, 4-col footer.

To port this to your real `DonnitLandingPage.tsx`:

1. Keep your existing structure and copy where it's working — you may not want a full rewrite, just selective updates.
2. Lift these specific patterns: the **eyebrow pill** style (`bg-brand-green-pale text-brand-green` rounded-full), the **green-accented headline** treatment (color two-word phrases inside the h1 with `text-brand-green`), the **dark "how it works" section** as a visual break in the page rhythm, the **product mock embedded in the hero** showing the actual app UI.
3. The pricing tier card with `border-brand-green + box-shadow: 0 30px 60px -30px color-mix(in srgb, var(--brand-green) 40%, transparent)` makes the featured plan pop without going neon.

---

## What NOT to port

- The Tweaks panel (`tweaks-panel.jsx`) — that's a prototype-only tool.
- The mock data files (`data.jsx`, `extras-data.jsx`) — replace with your real Supabase queries.
- The hand-drawn SVG icons in `ICONS` — you have `lucide-react` already.
- The font-pair switcher — you've committed to DM Sans + Syne.
- The CSS in `styles.css` — it's a parallel system to your `client/src/index.css`. Use the prototype as a visual reference, but write your styles in your existing Tailwind + CSS-variable conventions.

---

## Order of operations

1. Land the App.tsx module split (`handoff/CLAUDE_CODE_PROMPT.md`).
2. Add the optional tint tokens to `client/src/index.css` if you want them.
3. Refresh one screen at a time, starting with the highest-impact / lowest-risk pair:
   - **Tasks** (`TaskList.tsx`, `TaskRow.tsx`, `TaskDetailDialog.tsx`) — biggest visual win, well-isolated.
   - **Home** (`ChatPanel.tsx`, `DueTodayPanel.tsx`) — small files, immediate value.
   - **Reports** — high-impact, brand-new visualizations.
   - **Profiles** — touch last; biggest file, riskiest change.
4. Run smoke-tests after each screen. Each screen refresh = its own PR.

Reference for every refresh: open `Donnit Command Center.html` side-by-side with the file you're editing. The prototype is the visual spec.
