# Donnit Language Lexicon

This is the working interpretation guide Donnit uses for chat, Slack, email, SMS, and document inputs. The goal is not to copy user text. The goal is to understand plain English work language, infer a clean task only when the intent is clear, and ask a clarifying question when ownership, action, or timing is unclear.

## Task Creation Phrases

Donnit treats these as signals that the user wants work captured:

- add, create, make, log, capture, track
- remind me, remember to, don't forget
- I need to, we need to, need to, have to, should, must
- can you, could you, please handle
- make sure, take care of, look into, check on
- follow up, circle back, close the loop
- get done, knock out

## Ownership And Assignment

These phrases mean the named person is probably the task owner:

- assign Maya to review the contract
- delegate the renewal follow-up to Jordan
- reassign this to Nina
- route this to Finance
- hand this off to Operations
- transfer this to Maya
- put this on Jordan's plate
- have Nina prepare the deck
- get Maya to update the CRM
- ask Jordan to review the SOW

These phrases usually mean the named person is the contact/object, not the owner:

- call Maya
- email Nina
- message Jordan
- text Maya
- Slack Nina
- ping Jordan
- follow up with Maya
- check in with Nina
- meet with Jordan
- sync with Maya
- ask Nina about the budget
- send Jordan a note

Rule: if there is no explicit assignment language, Donnit keeps the task owned by the user and preserves the named person in the title/context.

## Timing And Date Language

Donnit recognizes:

- today, tomorrow
- this Monday, next Friday
- morning, afternoon, evening
- noon, midnight
- at 3pm, by 4:30pm, from 2-3pm
- all day
- EOD, EOB, COB: due today
- EOW: end of week
- EOM: end of month
- EOQ: end of quarter
- EOY: end of year

Rule: "by 3pm" is a deadline. "meeting at 3pm" or "call at 3pm" is a fixed-time task.

## Urgency Language

Critical:

- critical, emergency, blocker, fire drill, drop everything, immediately, P0, Sev1

High:

- urgent, ASAP, high priority, important, time sensitive, P1

Normal:

- normal, standard, regular priority, P2, not urgent, no rush, when you can

Low:

- low priority, whenever, someday, backlog, nice to have, P3

## Recurrence Language

Donnit treats these as recurrence signals:

- daily, weekly, monthly, quarterly, annually, annual
- every day, every week, every month, every quarter
- each quarter
- first Monday
- last Friday
- every May 15

## Privacy Language

Confidential:

- confidential, sensitive, privileged, restricted, need to know, attorney-client, private work

Personal:

- personal, private, non-work, non work

## Business Acronyms

- EOD: end of day
- EOB: end of business day
- COB: close of business
- EOW: end of week
- EOM: end of month
- EOQ: end of quarter
- EOY: end of year
- OOO: out of office
- PTO: paid time off
- RIF: reduction in force
- SOW: statement of work
- MSA: master services agreement
- NDA: non-disclosure agreement
- QBR: quarterly business review
- OKR: objectives and key results
- KPI: key performance indicator
- SLA: service level agreement
- RFP: request for proposal
- ROI: return on investment
- ARR: annual recurring revenue
- MRR: monthly recurring revenue
- CRM: customer relationship management
- ATS: applicant tracking system

## Clarification Rule

Donnit should ask a clarifying question before creating a task when:

- the text has no clear action
- the user used assignment language but the assignee cannot be matched
- there are multiple possible position profiles and the profile matters
- the AI extraction confidence is low
- the text appears to be pure FYI, status, receipt, newsletter, or context-only

When the action is clear enough, Donnit creates the task immediately.
