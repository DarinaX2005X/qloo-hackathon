"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LandingData } from "./scenes";

type Ctx = { data: LandingData | null; settled: boolean; revealed: boolean; markReady: (key: string) => void };
const LandingCtx = createContext<Ctx>({ data: null, settled: true, revealed: true, markReady: () => {} });
export const useLanding = () => useContext(LandingCtx);

/** Every live map the page shows before it opens. */
const MAPS = ["hero", "reader", "owl", "pair"] as const;
const STEPS: Record<string, string> = {
  data: "Reading Qloo's taste graph",
  hero: "Raising Lisbon",
  reader: "Mapping a quiet reader in Berlin",
  owl: "Mapping a night owl in Berlin",
  pair: "Printing two inks over Lisbon",
};
/** never hold the page longer than this: whatever is still loading finishes in place */
const CAP_MS = 9000;

export function LandingProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<LandingData | null>(null);
  const [settled, setSettled] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);
  const t0 = useRef(0);

  useEffect(() => {
    t0.current = performance.now();
    const ac = new AbortController();
    fetch("/api/landing", { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<LandingData>) : null))
      .catch(() => null)
      .then((d) => {
        if (ac.signal.aborted) return;
        performance.mark("landing:data");
        setData(d);
        setSettled(true);
      });
    const cap = window.setTimeout(() => setRevealed(true), CAP_MS);
    return () => {
      ac.abort();
      window.clearTimeout(cap);
    };
  }, []);

  const markReady = useCallback((key: string) => {
    performance.mark(`landing:${key}`);
    setDone((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, []);

  // a scene the server could not prepare loads live after the page opens: do not wait for it
  useEffect(() => {
    if (!settled) return;
    for (const k of MAPS) if (!data?.[k]) markReady(k);
  }, [settled, data, markReady]);

  const all = settled && MAPS.every((k) => done.has(k));
  useEffect(() => {
    if (!all || revealed) return;
    // a short beat after the last map so the loader doesn't blink on a warm cache
    const wait = Math.max(0, 700 - (performance.now() - t0.current));
    const id = window.setTimeout(() => {
      document.fonts.ready.then(() => setRevealed(true));
    }, wait);
    return () => window.clearTimeout(id);
  }, [all, revealed]);

  useEffect(() => {
    document.documentElement.style.overflow = revealed ? "" : "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [revealed]);

  const progress = (Number(settled) + MAPS.filter((k) => done.has(k)).length) / (MAPS.length + 1);
  const step = !settled ? "data" : MAPS.find((k) => !done.has(k)) ?? "pair";

  return (
    <LandingCtx.Provider value={{ data, settled, revealed, markReady }}>
      {children}
      <AnimatePresence>{!revealed && <Loader key="loader" progress={progress} label={STEPS[step]} />}</AnimatePresence>
    </LandingCtx.Provider>
  );
}

const RINGS = [
  "M6.6 40.2C4.4 26.9 14.4 9.6 31.4 7.4c15.6-2 26.6 8.6 26 22.8-.6 15.4-12.4 26-27.6 26.2C17.4 56.5 8.4 50.8 6.6 40.2Z",
  "M18.6 37.4c-.9-9.3 6.4-20.5 17-21.6 9.8-1 16 5.9 15.2 14.6-.8 9.2-7.8 15.3-16.6 15.1-8.2-.2-14.9-2.6-15.6-8.1Z",
  "M30.4 31.9c-.3-4.7 3.4-9.6 8.3-9.9 4.5-.2 7.2 3.1 6.8 7.2-.4 4.3-3.6 7-7.8 6.9-3.9-.1-7.1-1.2-7.3-4.2Z",
];

/** The mark draws itself ring by ring while the maps load; the page opens like a curtain. */
function Loader({ progress, label }: { progress: number; label: string }) {
  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Loading Homing"
      className="fixed inset-0 z-[100] grid place-items-center bg-paper"
      initial={false}
      exit={{ clipPath: "inset(0 0 100% 0)" }}
      style={{ clipPath: "inset(0 0 0% 0)" }}
      transition={{ duration: 0.75, ease: [0.7, 0, 0.2, 1] }}
    >
      <motion.div className="flex flex-col items-center" exit={{ y: -40, opacity: 0 }} transition={{ duration: 0.45, ease: [0.5, 0, 0.75, 0] }}>
        <svg width="112" height="112" viewBox="0 0 64 64" fill="none" aria-hidden className="hm-loader-mark">
          {RINGS.map((d, i) => (
            <path key={i} d={d} pathLength={1} stroke="var(--you)" strokeWidth={i === 0 ? 2.6 : 2.4} strokeLinecap="round" style={{ animationDelay: `${i * 0.18}s` }} />
          ))}
          <circle cx="38.2" cy="29.1" r="3.6" fill="var(--ink)" className="hm-loader-dot" />
        </svg>
        <span className="mt-5 text-[34px] font-[690] tracking-[-0.04em] text-ink">homing</span>
        <div className="mt-8 h-[3px] w-[220px] overflow-hidden rounded-full bg-paper-sunk">
          <div className="h-full rounded-full bg-you transition-[width] duration-500 ease-out" style={{ width: `${Math.max(6, progress * 100)}%` }} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="mt-4 text-[14.5px] text-ink-3"
          >
            {label}
          </motion.p>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
