"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Plus, X } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button, Skeleton } from "@/components/ui/primitives";
import { CityPicker, cityName } from "@/components/ui/CityPicker";

const CAT: Record<string, string> = { coffee: "coffee", food: "food", drinks: "drinks", culture: "culture", stay: "stay" };

/** "Where should I go?" The same taste scored across up to five cities, with each city's best start. */
export function CompareCities({ onClose }: { onClose: () => void }) {
  const ex = useExplore();
  const [list, setList] = useState<string[]>(() => (ex.cities.asked.length ? ex.cities.asked : [ex.state.city, "Berlin", "Mexico City"].filter((c, i, a) => a.findIndex((x) => cityName(x).toLowerCase() === cityName(c).toLowerCase()) === i)));
  const [adding, setAdding] = useState("");
  const loves = activeLoves(ex.state.loves);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const results = ex.cities.data;
  const best = results?.find((c) => !c.error);
  const top = Math.max(0.0001, ...(results ?? []).map((c) => c.score));
  return (
    <motion.div
      className="absolute inset-0 z-40 grid place-items-center bg-[oklch(23%_0.02_40/0.28)] p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        role="dialog"
        aria-label="Compare cities"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        className="hm-scroll max-h-[calc(100dvh-48px)] w-full max-w-[980px] overflow-y-auto rounded-[28px] bg-paper-raised p-6 shadow-[var(--shadow-overlay)] ring-1 ring-line md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[32px] font-[690] leading-tight tracking-[-0.03em]">Which city fits your taste</h2>
            <p className="mt-2 max-w-[600px] text-[15px] text-ink-2">
              Homing scores how strongly each city&apos;s places match {loves.length ? loves.map((l) => l.chosen.name).slice(0, 3).join(", ") : "what you love"}, and where you&apos;d start in each.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-paper-sunk hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {list.map((c) => (
            <span key={c} className="flex h-10 items-center gap-1 rounded-[11px] bg-paper-sunk pl-3 pr-1 text-[14.5px] font-[560]">
              {cityName(c)}
              <button aria-label={`Remove ${c}`} onClick={() => setList((l) => l.filter((x) => x !== c))} className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-raised hover:text-ink">
                <X size={14} />
              </button>
            </span>
          ))}
          {list.length < 5 && (
            <div className="flex items-center gap-1.5">
              <CityPicker
                key={list.length}
                className="w-[230px]"
                value={adding}
                onChange={(c) => {
                  setList((l) => (l.some((x) => x.toLowerCase() === c.toLowerCase()) ? l : [...l, c]));
                  setAdding("");
                }}
              />
              <Plus size={16} className="text-ink-3" />
            </div>
          )}
          <Button variant="primary" size="md" className="ml-auto" disabled={list.length < 2 || !loves.length || ex.cities.loading} onClick={() => void ex.compareCities(list)}>
            {ex.cities.loading ? "Comparing" : "Compare"}
          </Button>
        </div>
        {!loves.length && <p className="mt-3 text-[13.5px] text-err">Add a few things you love first, then compare.</p>}

        <div className="mt-6">
          {ex.cities.error && <p className="text-[14.5px] text-err">{ex.cities.error.message}</p>}
          {ex.cities.loading && (
            <p className="mb-3 text-[13.5px] text-ink-2">
              Mapping your taste in {ex.cities.asked.map(cityName).join(", ")}. A city Homing hasn&apos;t seen yet takes a few seconds.
            </p>
          )}
          {ex.cities.loading && (
            <div className="grid gap-3 md:grid-cols-2">
              {ex.cities.asked.map((c) => (
                <Skeleton key={c} className="h-[168px]" />
              ))}
            </div>
          )}
          {results && !ex.cities.loading && (
            <>
              {best && (
                <p className="mb-4 text-[16px] text-ink-2">
                  Your taste is strongest in <strong className="font-[650] text-ink">{cityName(best.city)}</strong>
                  {best.topNeighborhood ? (
                    <>
                      , starting in <strong className="font-[650] text-ink">{best.topNeighborhood}</strong>
                    </>
                  ) : null}
                  .
                </p>
              )}
              <ol className="grid gap-3 md:grid-cols-2">
                <AnimatePresence>
                  {results.map((c, i) => (
                    <motion.li
                      key={c.city}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                      className={`rounded-[20px] p-4 ring-1 ${i === 0 && !c.error ? "bg-[color-mix(in_oklch,var(--you)_7%,var(--paper-raised))] ring-[color-mix(in_oklch,var(--you)_30%,transparent)]" : "bg-paper-raised ring-line"}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex items-baseline gap-2">
                          <span className={`tnum grid h-7 w-7 place-items-center rounded-[8px] text-[13px] font-[650] ${i === 0 && !c.error ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{i + 1}</span>
                          <span className="text-[20px] font-[650] tracking-[-0.02em]">{cityName(c.city)}</span>
                        </span>
                        {!c.error && <span className="tnum text-[20px] font-[660]">{Math.round((c.score / top) * 100)}</span>}
                      </div>
                      {c.error ? (
                        <p className="mt-2 text-[14px] text-ink-2">{c.error}</p>
                      ) : (
                        <>
                          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-paper-sunk">
                            <motion.div className="h-full rounded-full bg-you" initial={{ width: 0 }} animate={{ width: `${(c.score / top) * 100}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] }} />
                          </div>
                          <p className="mt-2.5 text-[13.5px] leading-snug text-ink-2">
                            {c.topNeighborhood ? <>Start in <b className="font-[600] text-ink">{c.topNeighborhood}</b>. </> : null}
                            {c.matchedTags.length ? `Places feel ${c.matchedTags.slice(0, 3).join(", ").toLowerCase()}.` : ""}
                          </p>
                          {c.topPlaces.length > 0 && (
                            <p className="mt-1.5 text-[12.5px] text-ink-3">
                              {c.topPlaces.slice(0, 3).map((p) => `${p.name} (${CAT[p.category] ?? p.category})`).join(", ")}
                            </p>
                          )}
                          {c.sparse && <p className="mt-1.5 text-[12.5px] text-ink-3">Thin data for this city, treat the score as a rough hint.</p>}
                          <button
                            onClick={() => {
                              ex.patch([{ op: "set_city", city: c.city }]);
                              onClose();
                            }}
                            className="mt-3 flex items-center gap-1 text-[13.5px] font-[600] text-you-deep hover:underline"
                          >
                            Open the map of {cityName(c.city)} <ArrowRight size={14} />
                          </button>
                        </>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
              <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
                The index compares cities on equal terms: among the places Qloo picks for your taste in each city, how often they carry the atmosphere you prefer. The top city is 100.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
