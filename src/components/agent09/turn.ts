/**
 * One assistant turn, read from the v2 event stream. Pure: the store appends validated events, the UI calls
 * `deriveTurn(events)` and draws what it returns. Nothing here invents a status the backend did not send,
 * except one guard: a goal that was planned and then missing from `done` is shown as not reported, never dropped.
 */
import type { AgentCardV2, AgentEventV2, Claim, GoalState, ResultMeta, SessionMemory } from "./types";

export type TurnStep = { id: string; status: "running" | "done" | "failed"; text: string };
export type TurnResult = { meta: ResultMeta; card: AgentCardV2; key: string };
export type TurnError = { goalId?: string; retryable: boolean; message: string };
export type TurnReplan = { reason: string; nextAction: string };

/** What happened, in the order it happened, for the "What changed" list. */
export type TurnEntry =
  | { kind: "step"; step: TurnStep }
  | { kind: "observation"; goalId: string; text: string }
  | { kind: "replan"; replan: TurnReplan }
  | { kind: "error"; error: TurnError };

export type DerivedTurn = {
  turnId: string | null;
  ack: string | null;
  goals: GoalState[];
  plannedSteps: string[];
  steps: TurnStep[];
  replans: TurnReplan[];
  timeline: TurnEntry[];
  results: TurnResult[];
  claims: Claim[];
  errors: TurnError[];
  done: boolean;
  memory: SessionMemory | null;
  /** goals the plan announced that the final ledger left out; shown as not reported */
  unreported: GoalState[];
};

const GOAL_OF_CARD: Record<AgentCardV2["kind"], GoalState["kind"]> = {
  areas: "choose_area",
  home: "choose_area",
  explanation: "choose_area",
  comparison: "compare_cities",
  address: "evaluate_address",
  venues: "find_venues",
  visit: "build_visit",
};

const cardKey = (meta: ResultMeta, card: AgentCardV2) => `${card.kind}:${meta.analysisId}`;

export function deriveTurn(events: readonly AgentEventV2[]): DerivedTurn {
  const out: DerivedTurn = {
    turnId: null,
    ack: null,
    goals: [],
    plannedSteps: [],
    steps: [],
    replans: [],
    timeline: [],
    results: [],
    claims: [],
    errors: [],
    done: false,
    memory: null,
    unreported: [],
  };
  let planned: GoalState[] = [];
  const stepAt = new Map<string, number>();
  for (const e of events) {
    out.turnId ??= e.turnId;
    switch (e.type) {
      case "ack":
        out.ack = e.text;
        break;
      case "plan":
        planned = e.goals;
        out.goals = e.goals.map((g) => ({ ...g }));
        out.plannedSteps = e.steps;
        break;
      case "step": {
        const i = stepAt.get(e.stepId);
        const step = { id: e.stepId, status: e.status, text: e.text };
        if (i === undefined) {
          stepAt.set(e.stepId, out.steps.length);
          out.steps.push(step);
          out.timeline.push({ kind: "step", step });
        } else {
          out.steps[i] = step;
          const t = out.timeline.find((x) => x.kind === "step" && x.step.id === e.stepId);
          if (t && t.kind === "step") t.step = step;
        }
        break;
      }
      case "observation":
        out.timeline.push({ kind: "observation", goalId: e.goalId, text: e.text });
        break;
      case "replan": {
        const r = { reason: e.reason, nextAction: e.nextAction };
        out.replans.push(r);
        out.timeline.push({ kind: "replan", replan: r });
        break;
      }
      case "result": {
        // a recovery may send a newer result for the same analysis and kind: it replaces the earlier one in place
        const key = cardKey(e.meta, e.card);
        const r = { meta: e.meta, card: e.card, key };
        const i = out.results.findIndex((x) => x.key === key);
        if (i >= 0) out.results[i] = r;
        else out.results.push(r);
        break;
      }
      case "answer":
        out.claims = e.claims.filter((c) => c.text.trim());
        break;
      case "error": {
        const err = { goalId: e.goalId, retryable: e.retryable, message: e.message };
        out.errors.push(err);
        out.timeline.push({ kind: "error", error: err });
        // provisional until `done` brings the ledger: the goal this error belongs to did not finish
        if (e.goalId) out.goals = out.goals.map((g) => (g.id === e.goalId && !isSettled(g.status) ? { ...g, status: "failed" } : g));
        break;
      }
      case "done":
        out.done = true;
        out.goals = e.goals;
        out.memory = e.memory;
        break;
      case "patch":
        break;
    }
  }
  if (out.done) {
    const seen = new Set(out.goals.map((g) => g.id));
    out.unreported = planned.filter((g) => !seen.has(g.id)).map((g) => ({ ...g, status: "failed" as const, unmet: [...g.unmet, "not_reported"] }));
  } else {
    // while the turn runs and the backend has not moved a goal itself: a goal whose result has arrived is being
    // checked, and the next open goal is the one the running step works on. Nothing is shown as done before `done`.
    const withResult = new Set(out.results.map((r) => GOAL_OF_CARD[r.card.kind]));
    let next = out.steps.some((s) => s.status === "running");
    out.goals = out.goals.map((g) => {
      if (g.status !== "pending") return g;
      if (withResult.has(g.kind)) return { ...g, status: "running" };
      if (next) {
        next = false;
        return { ...g, status: "running" };
      }
      return g;
    });
  }
  return out;
}

export const isSettled = (s: GoalState["status"]) => s === "satisfied" || s === "partial" || s === "failed" || s === "needs_input";

/** The few steps worth showing while the agent works: anything running plus the latest finished ones. */
export function liveSteps(steps: readonly TurnStep[], max = 3): TurnStep[] {
  const running = steps.filter((s) => s.status === "running");
  const rest = steps.filter((s) => s.status !== "running");
  const keep = Math.max(0, max - running.length);
  return [...rest.slice(rest.length - keep), ...running].slice(-max).sort((a, b) => steps.indexOf(a) - steps.indexOf(b));
}

/** Overall state of a turn for its one-line header. */
export function turnOutcome(t: DerivedTurn): "working" | "complete" | "partial" | "failed" | "needs_input" {
  if (!t.done) return "working";
  const all = [...t.goals, ...t.unreported];
  if (!all.length) return t.errors.length ? "failed" : "complete";
  if (all.some((g) => g.status === "needs_input")) return "needs_input";
  if (all.every((g) => g.status === "satisfied")) return "complete";
  if (all.every((g) => g.status === "failed")) return "failed";
  return "partial";
}

/** A result made for an older version of the inputs: shown, but marked as earlier. */
export const isStaleResult = (meta: ResultMeta, currentRevision: number | null | undefined) =>
  typeof currentRevision === "number" && meta.stateRevision < currentRevision;

/** Card order in the turn: the end of a chain sits last, the answer reads first. */
const ORDER: AgentCardV2["kind"][] = ["comparison", "home", "areas", "explanation", "address", "venues", "visit"];
export function orderResults(results: readonly TurnResult[]): TurnResult[] {
  return [...results].sort((a, b) => ORDER.indexOf(a.card.kind) - ORDER.indexOf(b.card.kind));
}

/** Plain text of the answer, for the history sent with the next question. */
export const claimsText = (claims: readonly Claim[]) => claims.map((c) => c.text.trim()).join(" ");
