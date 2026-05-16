import { describe, expect, it } from "vitest";
import type { DonnitTaskResolutionEvent } from "../donnit-store";
import {
  adminResolutionView,
  memberResolutionView,
  previewCandidates,
  summarizeResolvedEntities,
} from "./task-resolution-view";

function event(overrides: Partial<DonnitTaskResolutionEvent> = {}): DonnitTaskResolutionEvent {
  return {
    id: overrides.id ?? "evt-1",
    org_id: overrides.org_id ?? "org-a",
    actor_id: overrides.actor_id ?? null,
    source: overrides.source ?? "chat",
    original_text: overrides.original_text ?? "assign the assistant to prep the board packet",
    parsed_slots: overrides.parsed_slots ?? {
      assignee_phrase: "the assistant",
      object_phrase: "prep the board packet",
      temporal_phrase: "by eod friday",
    },
    candidate_snapshot: overrides.candidate_snapshot ?? {},
    resolution_output: overrides.resolution_output ?? {},
    decision: overrides.decision ?? "created",
    confidence_score: overrides.confidence_score ?? 0.92,
    created_task_id: overrides.created_task_id ?? "task-1",
    correction: overrides.correction ?? {},
    signal_type: overrides.signal_type ?? null,
    signal_strength: overrides.signal_strength ?? null,
    latency_ms: overrides.latency_ms ?? 1200,
    model: overrides.model ?? "gpt-5-mini",
    cost_usd: overrides.cost_usd ?? 0.0042,
    created_at: overrides.created_at ?? "2026-05-14T18:30:00Z",
  };
}

describe("summarizeResolvedEntities", () => {
  it("returns one summary per resolved field", () => {
    const out = summarizeResolvedEntities({
      resolved: {
        assignee: { value: "user-jordan", confidence: 0.96, inferred: false, reason: "scoped alias matched" },
        title: { value: "Prepare the board packet", confidence: 0.91, inferred: false, reason: "cleaned object phrase" },
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ field: "assignee", value: "user-jordan", confidence: 0.96, inferred: false });
    expect(out[1]).toMatchObject({ field: "title", value: "Prepare the board packet" });
  });

  it("marks inferred fields and preserves the reason", () => {
    const out = summarizeResolvedEntities({
      resolved: {
        position_profile: { value: "profile-ea-ceo", confidence: 0.9, inferred: true, reason: "owner's primary profile" },
      },
    });
    expect(out[0].inferred).toBe(true);
    expect(out[0].reason).toBe("owner's primary profile");
  });

  it("returns an empty array when resolved is missing", () => {
    expect(summarizeResolvedEntities({})).toEqual([]);
    expect(summarizeResolvedEntities({ resolved: null as unknown as Record<string, unknown> })).toEqual([]);
  });

  it("tolerates primitive values under resolved.*", () => {
    const out = summarizeResolvedEntities({ resolved: { intent: "create_task" } });
    expect(out[0]).toMatchObject({ field: "intent", value: "create_task", confidence: null, inferred: false });
  });
});

describe("previewCandidates", () => {
  it("flattens a record-of-arrays candidate snapshot into a limited preview", () => {
    const out = previewCandidates({
      assignee: [
        { display_name: "Jordan Lee", confidence: 0.96, source: "scoped_alias" },
        { display_name: "Joran Lou", confidence: 0.71, source: "fuzzy" },
        { display_name: "Jane Doe", confidence: 0.55 },
      ],
      profile: [{ display_name: "Executive Assistant", confidence: 0.9 }],
    }, 3);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.field).sort()).toEqual(["assignee", "assignee", "profile"]);
  });

  it("returns an empty array when the snapshot is empty or malformed", () => {
    expect(previewCandidates({})).toEqual([]);
    expect(previewCandidates({ foo: "not-an-array" as unknown as never[] })).toEqual([]);
  });

  it("respects the limit", () => {
    const snapshot = { assignee: [{ display_name: "A" }, { display_name: "B" }, { display_name: "C" }, { display_name: "D" }] };
    expect(previewCandidates(snapshot, 2)).toHaveLength(2);
  });
});

describe("adminResolutionView", () => {
  it("preserves model, cost, latency, and candidate preview", () => {
    const view = adminResolutionView(event({
      candidate_snapshot: {
        assignee: [{ display_name: "Jordan Lee", confidence: 0.96 }],
      },
    }));
    expect(view.view).toBe("admin");
    expect(view.model).toBe("gpt-5-mini");
    expect(view.cost_usd).toBe(0.0042);
    expect(view.latency_ms).toBe(1200);
    expect(view.candidate_preview).toHaveLength(1);
    expect(view.candidate_preview[0]?.display_name).toBe("Jordan Lee");
  });
});

describe("memberResolutionView", () => {
  it("omits model, cost, latency, and candidate snapshot", () => {
    const view = memberResolutionView(event({
      candidate_snapshot: { assignee: [{ display_name: "Jordan Lee", confidence: 0.96 }] },
    }));
    expect(view.view).toBe("member");
    expect(view).not.toHaveProperty("model");
    expect(view).not.toHaveProperty("cost_usd");
    expect(view).not.toHaveProperty("latency_ms");
    expect(view).not.toHaveProperty("candidate_preview");
  });

  it("still includes parsed slots and resolved entities", () => {
    const view = memberResolutionView(event({
      resolution_output: {
        resolved: {
          assignee: { value: "user-jordan", confidence: 0.96, inferred: false },
        },
      },
    }));
    expect(view.parsed_slots).toHaveProperty("assignee_phrase", "the assistant");
    expect(view.resolved[0]).toMatchObject({ field: "assignee", value: "user-jordan" });
  });
});
