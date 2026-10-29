"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import type { TagRef } from "@/shared/contracts";
import { LIMITS } from "@/shared/contracts";
import { useExplore } from "./store";
import { api } from "./api";
import { Segmented, Spinner } from "@/components/ui/primitives";

/** One-tap must-haves people ask for most; each resolves to a real Qloo place tag on first use. */
const QUICK = ["Cozy", "Live music", "Free wifi", "Outdoor seating", "Vegetarian", "Quiet", "Rooftop", "Late night"];

function MustHaves() {
  const ex = useExplore();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<TagRef[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const full = ex.state.refinements.length >= LIMITS.refinements;

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setFound([]);
    const ac = new AbortController();
    const t = setTimeout(() => api.tags(q, ac.signal).then(setFound, () => setFound([])), 220);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [text]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const add = (tag: TagRef) => {
    ex.patch([{ op: "add_refinement", tag }]);
    setText("");
    setOpen(false);
  };
  const quick = async (label: string) => {
    setBusy(label);
    try {
      const tags = await api.tags(label);
      const tag = tags.find((t) => t.name.toLowerCase() === label.toLowerCase()) ?? tags[0];
      if (tag) add(tag);
      else ex.notify(`Qloo has no place tag for “${label}” yet`);
    } catch {
      ex.notify("Couldn't reach the taste graph. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };
  const has = new Set(ex.state.refinements.map((t) => t.name.toLowerCase()));

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[15px] font-[620] tracking-[-0.01em]">Must-haves</h3>
        <span className="tnum text-[12px] text-ink-3">
          {ex.state.refinements.length}/{LIMITS.refinements}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {ex.state.refinements.map((t) => (
            <motion.span
              layout
              key={t.id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              className="flex h-8 items-center gap-1 rounded-[9px] bg-ink pl-2.5 pr-1 text-[13px] font-[540] text-paper"
            >
              {t.name}
              <button
                aria-label={`Remove ${t.name}`}
                onClick={() => {
                  ex.patch([{ op: "remove_refinement", id: t.id }]);
                  ex.notify(`Removed ${t.name}`, () => ex.patch([{ op: "add_refinement", tag: t }]));
                }}
                className="grid h-6 w-6 place-items-center rounded-[7px] text-paper/70 hover:bg-white/15 hover:text-paper"
              >
                <X size={13} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        {!full &&
          QUICK.filter((q) => !has.has(q.toLowerCase()))
            .slice(0, 6 - Math.min(ex.state.refinements.length, 3))
            .map((q) => (
              <button
                key={q}
                onClick={() => quick(q)}
                disabled={!!busy}
                className="flex h-8 items-center gap-1 rounded-[9px] bg-paper-sunk px-2.5 text-[13px] font-[520] text-ink-2 transition-colors hover:bg-[color-mix(in_oklch,var(--you)_12%,var(--paper-sunk))] hover:text-ink disabled:opacity-60"
              >
                {busy === q ? <Spinner size={12} /> : <Plus size={13} />} {q}
              </button>
            ))}
      </div>
      {!full && (
        <div ref={box} className="relative mt-2">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && found[0]) (e.preventDefault(), add(found[0]));
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Something else: dog friendly, natural wine…"
            aria-label="Add a must-have"
            className="h-10 w-full rounded-[11px] bg-paper-sunk px-3 text-[14px] text-ink outline-none ring-1 ring-transparent placeholder:text-ink-3 focus:ring-2 focus:ring-you"
          />
          {open && found.length > 0 && (
            <ul className="hm-scroll absolute left-0 right-0 z-40 mt-1 max-h-56 overflow-auto rounded-[12px] bg-paper-raised p-1 shadow-[var(--shadow-overlay)] ring-1 ring-line">
              {found.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <button
                    onMouseDown={(e) => (e.preventDefault(), add(t))}
                    className="flex w-full items-baseline justify-between gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[14px] hover:bg-paper-sunk"
                  >
                    <span className="text-ink">{t.name}</span>
                    <span className="text-[12px] text-ink-3">{t.kind.replace(/_/g, " ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <span className="w-[56px] shrink-0 text-[13px] font-[560] text-ink-2">Budget</span>
        <div className="flex-1">
          <Segmented
            size="sm"
            label="Budget"
            value={String(ex.state.budget ?? 0)}
            onChange={(v) => ex.patch([{ op: "set_budget", budget: v === "0" ? null : Number(v) }])}
            options={[
              { value: "0", label: "Any" },
              { value: "1", label: "$" },
              { value: "2", label: "$$" },
              { value: "3", label: "$$$" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

export function TripControls() {
  return <MustHaves />;
}

/** Days, pace and when the day starts; every change replans if a plan is open. */
export function PlanSettings() {
  const ex = useExplore();
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-[14px] bg-paper-sunk/60 p-2.5">
      <span className="text-[12.5px] font-[560] text-ink-2">Days</span>
      <Segmented
        size="sm"
        label="Days"
        value={String(ex.state.days) as "1" | "2" | "3"}
        onChange={(v) => ex.patch([{ op: "set_days", days: Number(v) as 1 | 2 | 3 }])}
        options={[
          { value: "1", label: "1" },
          { value: "2", label: "2" },
          { value: "3", label: "3" },
        ]}
      />
      <span className="text-[12.5px] font-[560] text-ink-2">Pace</span>
      <Segmented
        size="sm"
        label="Pace"
        value={ex.state.pace ?? "balanced"}
        onChange={(v) => ex.patch([{ op: "set_pace", pace: v }])}
        options={[
          { value: "relaxed", label: "Relaxed" },
          { value: "balanced", label: "Balanced" },
          { value: "packed", label: "Packed" },
        ]}
      />
      <span className="text-[12.5px] font-[560] text-ink-2">Start</span>
      <Segmented
        size="sm"
        label="Day starts at"
        value={String(ex.state.startHour ?? 9)}
        onChange={(v) => ex.patch([{ op: "set_start", hour: Number(v) }])}
        options={[
          { value: "7", label: "7:00" },
          { value: "9", label: "9:00" },
          { value: "11", label: "11:00" },
        ]}
      />
    </div>
  );
}
