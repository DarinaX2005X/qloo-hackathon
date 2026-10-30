"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  CornerDownRight,
  HelpCircle,
  RotateCcw,
  X,
} from "lucide-react";
import type { GoalState } from "./types";
import {
  deriveTurn,
  isSettled,
  isStaleResult,
  liveSteps,
  orderResults,
  turnOutcome,
  type DerivedTurn,
  type TurnEntry,
} from "./turn";
import type { AgentEventV2 } from "./types";
import { ResultCard, type OpenHandlers } from "./Results";
import { Spinner } from "@/components/ui/primitives";
import { WaitNote } from "./WaitNote";
import { GOAL_LABEL, GOAL_STATUS, sentence, unmetText } from "@/lib/explain";

const ease = [0.2, 0.8, 0.2, 1] as const;

function GoalIcon({ status }: { status: GoalState["status"] }) {
  switch (status) {
    case "satisfied":
      return <Check size={14} strokeWidth={2.6} className="text-[var(--ok)]" />;
    case "partial":
      return (
        <CircleDashed
          size={14}
          strokeWidth={2.4}
          className="text-[color-mix(in_oklch,var(--warn)_70%,var(--ink))]"
        />
      );
    case "failed":
      return <X size={14} strokeWidth={2.6} className="text-[var(--err)]" />;
    case "needs_input":
      return (
        <HelpCircle size={14} strokeWidth={2.2} className="text-you-deep" />
      );
    case "running":
      return <Spinner size={13} />;
    default:
      return <Circle size={12} strokeWidth={2} className="text-ink-3" />;
  }
}

/** What this question asked for, one row per goal, with its state and, when it fell short, why. */
function GoalLedger({
  t,
  onRetry,
}: {
  t: DerivedTurn;
  onRetry?: (goalId: string) => void;
}) {
  const goals = [...t.goals, ...t.unreported];
  if (!goals.length) return null;
  const live = !t.done ? liveSteps(t.steps) : [];
  const retryable = new Set(
    t.errors.filter((e) => e.retryable && e.goalId).map((e) => e.goalId!),
  );
  return (
    <div
      className="rounded-[16px] bg-paper-sunk/60 px-3 py-2"
      data-testid="goal-ledger"
    >
      <ul>
        {goals.map((g, i) => {
          const short =
            g.status === "partial" ||
            g.status === "failed" ||
            g.status === "needs_input";
          const reasons = [...new Set(g.unmet.map(unmetText))];
          return (
            <li
              key={g.id}
              data-goal-kind={g.kind}
              data-goal-status={g.status}
              className={`py-1.5 ${i ? "border-t border-line/70" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  <GoalIcon status={g.status} />
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-[580] leading-snug text-ink">
                  {GOAL_LABEL[g.kind]}
                </span>
                <span
                  className={`shrink-0 text-[12px] font-[560] ${short ? "text-ink-2" : "text-ink-3"}`}
                >
                  {GOAL_STATUS[g.status]}
                </span>
              </div>
              {short && reasons.length > 0 && (
                <p className="ml-7 text-[12.5px] leading-snug text-ink-2">
                  {reasons.map(sentence).join(" ")}
                </p>
              )}
              {short &&
                onRetry &&
                t.done &&
                (retryable.has(g.id) || g.status === "failed") &&
                g.status !== "needs_input" && (
                  <button
                    onClick={() => onRetry(g.id)}
                    className="ml-6 mt-0.5 flex items-center gap-1 rounded-[8px] px-1.5 py-1 text-[12.5px] font-[600] text-ink-2 hover:bg-paper-raised hover:text-ink"
                  >
                    <RotateCcw size={12} /> Try this step again
                  </button>
                )}
            </li>
          );
        })}
      </ul>
      <AnimatePresence initial={false}>
        {live.length > 0 && (
          <motion.ul
            key="live"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden border-t border-line/70"
            aria-live="polite"
            data-testid="live-steps"
          >
            {live.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 pt-1.5 text-[12.5px] leading-snug text-ink-2 first:pt-2"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  {s.status === "running" ? (
                    <Spinner size={11} />
                  ) : s.status === "failed" ? (
                    <X size={11} className="text-[var(--err)]" />
                  ) : (
                    <Check size={11} className="text-[var(--ok)]" />
                  )}
                </span>
                <span>{s.text}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The changes of approach the agent made after looking at a result: what it saw, and what it did next. */
function Replans({ list }: { list: readonly { reason: string; nextAction: string }[] }) {
  if (!list.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease }}
      data-testid="replan"
      className="rounded-[12px] border-l-[3px] border-[var(--them)] bg-[color-mix(in_oklch,var(--them)_7%,var(--paper-raised))] px-3 py-2 text-[13.5px] leading-snug"
    >
      <p className="text-[12.5px] font-[620] text-ink">{list.length === 1 ? "Changed approach after checking" : `Changed approach ${list.length} times after checking`}</p>
      <ul className="mt-1 space-y-1.5">
        {list.map((r, i) => (
          <li key={i}>
            <p className="text-ink">{endStop(r.reason)}</p>
            <p className="flex items-start gap-1.5 text-ink-2">
              <CornerDownRight size={14} className="mt-[2px] shrink-0 text-[var(--them)]" />
              <span>{endStop(r.nextAction)}</span>
            </p>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function entryLine(
  e: TurnEntry,
): { icon: React.ReactNode; text: string } | null {
  switch (e.kind) {
    case "step":
      return {
        icon:
          e.step.status === "failed" ? (
            <X size={12} className="text-[var(--err)]" />
          ) : e.step.status === "running" ? (
            <Circle size={10} className="text-ink-3" />
          ) : (
            <Check size={12} className="text-[var(--ok)]" />
          ),
        text: e.step.text,
      };
    case "observation":
      return {
        icon: <span className="block h-1.5 w-1.5 rounded-full bg-ink-3" />,
        text: e.text,
      };
    case "replan":
      return {
        icon: <CornerDownRight size={12} className="text-[var(--them)]" />,
        text: `${endStop(e.replan.reason)} ${endStop(e.replan.nextAction)}`,
      };
    case "error":
      return {
        icon: <X size={12} className="text-[var(--err)]" />,
        text: e.error.message,
      };
  }
}

/** Everything the agent did, in order, folded away once the turn is done. */
function WhatChanged({ t }: { t: DerivedTurn }) {
  const [open, setOpen] = useState(false);
  if (!t.done || !t.timeline.length) return null;
  const n = t.steps.length;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-8 items-center gap-1.5 rounded-[8px] text-left text-[12.5px] font-[580] text-ink-3 hover:text-ink"
      >
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
        What the assistant did{n ? `, ${n} ${n === 1 ? "step" : "steps"}` : ""}
        {t.replans.length
          ? `, changed approach ${t.replans.length === 1 ? "once" : `${t.replans.length} times`}`
          : ""}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="space-y-1 overflow-hidden pl-5 pt-1"
          >
            {t.timeline.map((e, i) => {
              const l = entryLine(e);
              if (!l) return null;
              return (
                <li
                  key={i}
                  className={`flex items-start gap-2 text-[12.5px] leading-snug ${e.kind === "observation" ? "text-ink-3" : "text-ink-2"}`}
                >
                  <span className="mt-[3px] grid h-3 w-3 shrink-0 place-items-center">
                    {l.icon}
                  </span>
                  <span>{l.text}</span>
                </li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One assistant turn from the v2 stream: the acknowledgement, the goals with live steps, any change of approach,
 * the answer (built from checked claims), the result cards, and errors with a retry of just that step.
 */
export function AgentTurnV2({
  events,
  currentRevision,
  onRetryGoal,
  handlers,
  stopped,
  ended,
  hideTurnErrors,
}: {
  events: readonly AgentEventV2[];
  currentRevision?: number | null;
  onRetryGoal?: (goalId: string) => void;
  handlers?: OpenHandlers;
  stopped?: boolean;
  /** the stream is over (the store no longer waits for it), whether or not `done` arrived */
  ended?: boolean;
  /** the screen already shows the turn-level error with its own retry */
  hideTurnErrors?: boolean;
}) {
  const t = settleEnded(
    deriveTurn(events),
    stopped ? "stopped" : ended ? "interrupted" : null,
  );
  const outcome = turnOutcome(t);
  const results = orderResults(t.results);
  const loose = hideTurnErrors ? [] : t.errors.filter(
    (e) => !e.goalId || !t.goals.some((g) => g.id === e.goalId),
  );
  return (
    <div
      className="space-y-2.5"
      data-testid="agent-turn-v2"
      data-outcome={outcome}
    >
      {t.ack && (
        <p
          className="text-[14px] leading-relaxed text-ink-2"
          data-testid="agent-ack"
        >
          {t.ack}
        </p>
      )}
      {!t.goals.length && !t.done && (
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Spinner size={13} />{" "}
          {t.steps.length
            ? t.steps[t.steps.length - 1].text
            : "Reading your question"}
        </div>
      )}
      <GoalLedger t={t} onRetry={onRetryGoal} />
      <WaitNote active={!t.done} />
      <Replans list={t.replans} />
      {t.claims.length > 0 && (
        <p
          data-testid="assistant-reply"
          className="text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]"
        >
          {t.claims.map((c, i) => (
            <span key={i} data-evidence={c.evidenceIds.length || undefined}>
              {i ? " " : ""}
              {c.text.trim()}
            </span>
          ))}
        </p>
      )}
      {results.map((r) => (
        <motion.div
          key={r.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease }}
        >
          <ResultCard
            card={r.card}
            sourceName={t.memory?.sourceHome?.name ?? null}
            meta={r.meta}
            stale={isStaleResult(r.meta, currentRevision)}
            handlers={handlers}
          />
        </motion.div>
      ))}
      {loose.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-[13.5px] text-[var(--err)]">{e.message}</p>
        </div>
      ))}
      {stopped && (
        <p className="text-[12.5px] text-ink-3">
          You stopped this answer. Results that already arrived stay; unfinished
          steps are marked above.
        </p>
      )}
      <WhatChanged t={t} />
    </div>
  );
}

/** A turn whose stream ended without `done` (stopped, dropped): unfinished goals say so instead of spinning. */
function settleEnded(
  t: DerivedTurn,
  why: "stopped" | "interrupted" | null,
): DerivedTurn {
  if (t.done || !why) return t;
  return {
    ...t,
    done: true,
    goals: t.goals.map((g) =>
      isSettled(g.status)
        ? g
        : { ...g, status: "failed" as const, unmet: [...g.unmet, why] },
    ),
  };
}


const endStop = sentence;
