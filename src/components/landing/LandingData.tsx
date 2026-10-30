"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LandingData, LandingScene } from "./scenes";

type Ctx = {
  /** hero scene first, the lower scenes merge in when they arrive */
  data: LandingData | null;
  /** the hero answer is in (or failed) */
  settled: boolean;
  /** the lower scenes are in (or failed) */
  restSettled: boolean;
  revealed: boolean;
  /** the hero map has drawn its terrain; until then the hero shows a light preview of the same example */
  heroReady: boolean;
  markReady: (key: string) => void;
};
const LandingCtx = createContext<Ctx>({ data: null, settled: true, restSettled: true, revealed: true, heroReady: true, markReady: () => {} });
export const useLanding = () => useContext(LandingCtx);

/**
 * The loader holds the page only until the hero map and its example shortlist are on screen. Everything below the
 * first screen loads behind it. The hold is capped at HOLD_MS counted from navigation start: past that the page
 * opens on the example card and a light preview of the same map, and the live map fades in when it has drawn.
 */
const HOLD_MS = 2000;
/** a short beat so the mark does not flash on a warm cache */
const MIN_MS = 350;
const reveal = (setRevealed: (v: boolean) => void, how: string) => {
  performance.mark("landing:revealed");
  performance.mark(`landing:revealed-${how}`);
  setRevealed(true);
};

type Part = { hero?: LandingScene | null; reader?: LandingScene | null; owl?: LandingScene | null; pair?: LandingScene | null };

async function getPart(part: "hero" | "rest", signal: AbortSignal): Promise<Part | null> {
  try {
    const r = await fetch(`/api/landing?part=${part}`, { signal });
    return r.ok ? ((await r.json()) as Part) : null;
  } catch {
    return null;
  }
}

export function LandingProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<LandingData | null>(null);
  const [settled, setSettled] = useState(false);
  const [restSettled, setRestSettled] = useState(false);
  const [heroReady, setHeroReady] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const t0 = useRef(0);

  useEffect(() => {
    t0.current = performance.now();
    const ac = new AbortController();
    void getPart("hero", ac.signal).then((d) => {
      if (ac.signal.aborted) return;
      performance.mark("landing:data");
      setData((cur) => ({ reader: null, owl: null, pair: null, cities: null, ...cur, hero: d?.hero ?? null }));
      setSettled(true);
      // the lower scenes are asked only now, so they never compete with the hero
      void getPart("rest", ac.signal).then((r) => {
        if (ac.signal.aborted) return;
        setData((cur) => ({ hero: cur?.hero ?? null, cities: null, reader: r?.reader ?? null, owl: r?.owl ?? null, pair: r?.pair ?? null }));
        setRestSettled(true);
      });
    });
    // performance.now() counts from navigation start, so the cap holds however late hydration was
    const hold = window.setTimeout(() => reveal(setRevealed, "cap"), Math.max(0, HOLD_MS - performance.now()));
    return () => {
      ac.abort();
      window.clearTimeout(hold);
    };
  }, []);

  const markReady = useCallback((key: string) => {
    performance.mark(`landing:${key}`);
    if (key === "hero") setHeroReady(true);
  }, []);

  // without a prepared hero the map has nothing to wait for
  const heroDone = heroReady || (settled && !data?.hero);
  useEffect(() => {
    if (!heroDone || revealed) return;
    const wait = Math.max(0, MIN_MS - (performance.now() - t0.current));
    const id = window.setTimeout(() => {
      void document.fonts.ready.then(() => reveal(setRevealed, "ready"));
    }, wait);
    return () => window.clearTimeout(id);
  }, [heroDone, revealed]);

  useEffect(() => {
    document.documentElement.style.overflow = revealed ? "" : "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [revealed]);

  const progress = settled ? (heroDone ? 1 : 0.6) : 0.25;
  const label = !settled ? "Opening an example from Qloo's data" : "Drawing the example map of Lisbon";

  return (
    <LandingCtx.Provider value={{ data, settled, restSettled, revealed, heroReady: heroDone, markReady }}>
      {children}
      <AnimatePresence>{!revealed && <Loader key="loader" progress={progress} label={label} />}</AnimatePresence>
    </LandingCtx.Provider>
  );
}

const RINGS = [
  "M6.6 40.2C4.4 26.9 14.4 9.6 31.4 7.4c15.6-2 26.6 8.6 26 22.8-.6 15.4-12.4 26-27.6 26.2C17.4 56.5 8.4 50.8 6.6 40.2Z",
  "M18.6 37.4c-.9-9.3 6.4-20.5 17-21.6 9.8-1 16 5.9 15.2 14.6-.8 9.2-7.8 15.3-16.6 15.1-8.2-.2-14.9-2.6-15.6-8.1Z",
  "M30.4 31.9c-.3-4.7 3.4-9.6 8.3-9.9 4.5-.2 7.2 3.1 6.8 7.2-.4 4.3-3.6 7-7.8 6.9-3.9-.1-7.1-1.2-7.3-4.2Z",
];

/** The mark draws itself ring by ring while the hero map loads; the page opens like a curtain. */
function Loader({ progress, label }: { progress: number; label: string }) {
  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Loading Homing"
      data-testid="landing-loader"
      className="fixed inset-0 z-[100] grid place-items-center bg-paper"
      initial={false}
      exit={{ clipPath: "inset(0 0 100% 0)" }}
      // the server-rendered loader also leaves on its own at the cap, so a slow script can never keep the page covered
      style={{ clipPath: "inset(0 0 0% 0)", animation: `hm-loader-out 0.35s ease-in ${HOLD_MS / 1000}s forwards` }}
      transition={{ duration: 0.35, ease: [0.7, 0, 0.2, 1] }}
    >
      <style>{"@keyframes hm-loader-out{to{opacity:0;visibility:hidden}}"}</style>
      <motion.div className="flex flex-col items-center" exit={{ y: -24, opacity: 0 }} transition={{ duration: 0.22, ease: [0.5, 0, 0.75, 0] }}>
        <svg width="112" height="112" viewBox="0 0 64 64" fill="none" aria-hidden className="hm-loader-mark">
          {RINGS.map((d, i) => (
            <path key={i} d={d} pathLength={1} stroke="var(--you)" strokeWidth={i === 0 ? 2.6 : 2.4} strokeLinecap="round" style={{ animationDelay: `${i * 0.14}s` }} />
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
            transition={{ duration: 0.2 }}
            className="mt-4 text-[14.5px] text-ink-3"
          >
            {label}
          </motion.p>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
