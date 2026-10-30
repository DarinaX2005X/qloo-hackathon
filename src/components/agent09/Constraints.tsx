"use client";

import { AnimatePresence, motion } from "motion/react";
import { Lock, X } from "lucide-react";
import type { Constraint } from "./types";
import { constraintLabel, constraintStrengthText } from "@/lib/explain";

/**
 * The rules a question or a walk keeps, as chips. A rule that must hold has a lock and a solid plate; a
 * preference the assistant may bend has a dashed outline. Removing one is the person's call, never automatic.
 */
export function ConstraintChips({
  constraints,
  names,
  onRemove,
  disabled,
  label = "Kept every time",
  testId = "constraint-chips",
  oneLine = false,
}: {
  constraints: readonly Constraint[];
  /** place ID → name, so "exclude_place" chips can say which place */
  names?: Record<string, string>;
  onRemove?: (c: Constraint) => void;
  disabled?: boolean;
  label?: string | null;
  testId?: string;
  /** one scrollable row instead of wrapping (phones, above a composer) */
  oneLine?: boolean;
}) {
  const list = dedupe(constraints);
  if (!list.length) return null;
  return (
    <div data-testid={testId}>
      {label && <p className="text-[12.5px] font-[560] text-ink-3">{label}</p>}
      <ul className={`flex gap-1.5 ${oneLine ? "hm-scroll -mx-1 flex-nowrap overflow-x-auto px-1 pb-0.5" : "flex-wrap"} ${label ? "mt-1.5" : ""}`}>
        <AnimatePresence initial={false}>
          {list.map((c) => {
            const text = constraintLabel(c, names);
            const hard = c.strength === "hard";
            return (
              <motion.li
                key={c.id}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.16 }}
                title={constraintStrengthText(c)}
                data-strength={c.strength}
                className={`flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-[9px] pl-2.5 text-[13px] font-[560] ${onRemove ? "pr-0.5" : "pr-2.5"} ${
                  hard ? "bg-ink text-paper" : "border border-dashed border-[var(--line-strong)] text-ink-2"
                }`}
              >
                {hard && <Lock size={11} strokeWidth={2.4} className="shrink-0 opacity-70" aria-hidden />}
                <span className="truncate">{text}</span>
                {!hard && <span className="sr-only">, a preference</span>}
                {onRemove && (
                  <button
                    onClick={() => onRemove(c)}
                    disabled={disabled}
                    aria-label={`Remove the rule “${text}”`}
                    title="Remove this rule"
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] disabled:opacity-40 ${hard ? "text-paper/70 hover:bg-white/15 hover:text-paper" : "text-ink-3 hover:bg-paper-sunk hover:text-ink"}`}
                  >
                    <X size={13} />
                  </button>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/** "bars" and "bar" are the same rule; budgets are one rule whatever the level. */
export const ruleKey = (c: Constraint) => (c.kind === "budget" ? "budget" : `${c.kind}:${String(c.value).trim().toLowerCase().replace(/s$/, "")}`);

/** One chip per rule: the same kind and value said twice (user and default) shows once, the hard one wins. */
export function dedupe(list: readonly Constraint[]): Constraint[] {
  const by = new Map<string, Constraint>();
  for (const c of list) {
    const key = ruleKey(c);
    const cur = by.get(key);
    if (!cur || (cur.strength === "soft" && c.strength === "hard")) by.set(key, c);
  }
  return [...by.values()];
}
