"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import type { Neighborhood } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { HoodCompare } from "./HoodCompare";
import { CityCompare } from "./CompareCities";
import { Segmented, Skeleton } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { MatchExplainer } from "@/components/ui/Match";
import { matchPhrase } from "@/lib/honest";
import { useGoTo, useIsMobile } from "./nav";

/** A styled listbox of the ranked neighborhoods. */
function HoodPicker({ value, options, onChange, label, disabledId }: { value: Neighborhood; options: Neighborhood[]; onChange: (id: string) => void; label: string; disabledId?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value.name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-[12px] bg-paper-raised py-1.5 pl-2 pr-2 text-left sm:pr-2.5 shadow-[var(--shadow-rest)] ring-1 ring-line transition-shadow hover:shadow-[var(--shadow-raised)]"
      >
        <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${value.rank === 1 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{value.rank}</span>
        {/* a long name wraps to a second line instead of being cut ("Ville-M…") */}
        <span className="line-clamp-2 min-w-0 flex-1 text-[15px] font-[600] leading-[1.2] tracking-[-0.01em]">{value.name}</span>
        <ChevronDown size={16} className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 520, damping: 36 }}
            className="hm-scroll absolute left-0 right-0 z-40 mt-1.5 max-h-72 origin-top overflow-auto rounded-[14px] bg-paper-raised p-1 shadow-[var(--shadow-overlay)] ring-1 ring-line"
          >
            {options.map((n) => (
              <li key={n.id} role="option" aria-selected={n.id === value.id}>
                <button
                  disabled={n.id === disabledId}
                  onClick={() => {
                    onChange(n.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[14px] disabled:opacity-40 ${n.id === value.id ? "bg-paper-sunk font-[600]" : "hover:bg-paper-sunk"}`}
                >
                  <span className="tnum w-6 shrink-0 text-center text-[12.5px] font-[620] text-ink-3">{n.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{n.name}</span>
                  <span className="tnum shrink-0 text-[12.5px] font-[580] text-ink-2">{matchPhrase(n.score)}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function Neighborhoods() {
  const ex = useExplore();
  const goTo = useGoTo();
  const hoods = useMemo(() => ex.hoods.data ?? [], [ex.hoods.data]);
  const byId = (id?: string) => hoods.find((n) => n.id === id);
  const a = byId(ex.compare[0]) ?? hoods[0];
  const b = byId(ex.compare[1]) ?? hoods.find((n) => n.id !== a?.id);

  // only the two neighborhoods stay on the map while they are compared
  const { setOverlay } = ex;
  useEffect(() => {
    if (a && b) setOverlay({ neighborhoods: [a, b], focus: [(a.center[0] + b.center[0]) / 2, (a.center[1] + b.center[1]) / 2] });
    else setOverlay(null);
  }, [a, b, setOverlay]);
  useEffect(() => () => setOverlay(null), [setOverlay]);

  if (!activeLoves(ex.state.loves).length)
    return <p className="text-[14.5px] leading-relaxed text-ink-2">Add a few things you love on the Map screen, then compare the neighborhoods Homing ranks for you.</p>;
  if (!a || !b)
    return ex.hoods.loading || ex.field.loading ? (
      <Skeleton className="h-[220px]" />
    ) : (
      <p className="text-[14.5px] text-ink-2">There are not enough ranked neighborhoods in {cityName(ex.state.city)} to compare yet.</p>
    );
  const set = (i: 0 | 1, id: string) => {
    const next: [string, string] = [a.id, b.id];
    next[i] = id;
    ex.setCompare(next);
  };
  return (
    <div>
      {/* on a phone the two pickers stack, full width, so names are not cut; side by side from sm up */}
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 sm:flex sm:gap-2">
        <HoodPicker label="First neighborhood" value={a} options={hoods} onChange={(id) => set(0, id)} disabledId={b.id} />
        <button
          onClick={() => ex.setCompare([b.id, a.id])}
          aria-label="Swap the two neighborhoods"
          className="row-span-2 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-paper-sunk hover:text-ink"
        >
          <ArrowLeftRight size={16} className="rotate-90 sm:rotate-0" />
        </button>
        <HoodPicker label="Second neighborhood" value={b} options={hoods} onChange={(id) => set(1, id)} disabledId={a.id} />
      </div>
      <HoodCompare
        a={a}
        b={b}
        onOpen={(id) => {
          ex.patch([{ op: "select_neighborhood", id }]);
          goTo("/explore");
        }}
      />
      <p className="mt-2 text-[12.5px] text-ink-3">Click a name to open its places on the Map screen.</p>
      <MatchExplainer className="mt-2" />
    </div>
  );
}

/** Compare: two neighborhoods side by side, and the same taste scored across other cities. */
export function CompareScreen() {
  const ex = useExplore();
  const goTo = useGoTo();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"hoods" | "cities">("hoods");
  const openCity = (city: string) => {
    ex.patch([{ op: "set_city", city }]);
    goTo("/explore");
  };
  const hoodsSection = (
    <section aria-label="Compare neighborhoods">
      <h2 className="text-[22px] font-[660] leading-tight tracking-[-0.02em]">Two neighborhoods side by side</h2>
      <p className="mb-4 mt-1.5 text-[14px] leading-relaxed text-ink-2">Where each one ranks for your taste in {cityName(ex.state.city)}, which of your loves lift it, and how busy it is.</p>
      <Neighborhoods />
    </section>
  );
  if (mobile)
    return (
      <div className="absolute inset-x-0 bottom-0 flex h-[60%] flex-col overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line">
        <div className="px-4 pt-3">
          <Segmented
            label="Compare"
            value={tab}
            onChange={setTab}
            options={[
              { value: "hoods", label: "Neighborhoods" },
              { value: "cities", label: "Cities" },
            ]}
          />
        </div>
        <div className="hm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">{tab === "hoods" ? hoodsSection : <CityCompare onOpenCity={openCity} />}</div>
      </div>
    );
  return (
    <motion.aside
      aria-label="Compare"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="hm-scroll absolute bottom-4 left-4 top-[76px] w-[620px] overflow-y-auto overscroll-contain rounded-[24px] bg-paper-raised/95 px-6 pb-7 pt-6 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
    >
      {hoodsSection}
      <div className="my-7 h-px bg-line" />
      <CityCompare onOpenCity={openCity} />
    </motion.aside>
  );
}
