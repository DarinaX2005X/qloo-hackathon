"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Plus, RefreshCw, X } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore, type CityRun } from "./store";
import { Button, Skeleton, Spinner } from "@/components/ui/primitives";
import { CityPicker, cityName } from "@/components/ui/CityPicker";

const CAT: Record<string, string> = { coffee: "coffee", food: "food", drinks: "drinks", culture: "culture", stay: "stay" };

/** "Where should I go?" The same  taste scored across up to five cities, with each city's best start. */
export function CityCompare({ onOpenCity }: { onOpenCity: (city: string) => void }) {
  const ex = useExplore();
  const [list, setList] = useState<string[]>(() => (ex.cities.asked.length ? ex.cities.asked : [ex.state.city, "Berlin", "Mexico City"].filter((c, i, a) => a.findIndex((x) => cityName(x).toLowerCase() === cityName(c).toLowerCase()) === i)));
  const [adding, setAdding] = useState("");
  const loves = activeLoves(ex.state.loves);

  const { runs, running } = ex.cities;
  // finished cities first, best first; the index is relative to the best city so far and moves as cities land
  const done = runs
    .filter((r): r is CityRun & { data: NonNullable<CityRun["data"]> } => r.status === "done" && !!r.data)
    .sort((a, b) => b.data.score - a.data.score || b.data.depth - a.data.depth);
  const waiting = runs.filter((r) => r.status === "queued" || r.status === "loading");
  const failed = runs.filter((r) => r.status === "error");
  const best = done[0]?.data;
  const top = Math.max(0.0001, ...done.map((r) => r.data.score));
  return (
    <section aria-label="Compare cities">
      <div>
        <h2 className="text-[22px] font-[660] leading-tight tracking-[-0.02em]">Which city fits your taste</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
          Homing scores how strongly each city&apos;s places match {loves.length ? loves.map((l) => l.chosen.name).slice(0, 3).join(", ") : "what you love"}, and where you&apos;d start in each.
        </p>
      </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
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
                className="w-[210px]"
                value={adding}
                onChange={(c) => {
                  setList((l) => (l.some((x) => x.toLowerCase() === c.toLowerCase()) ? l : [...l, c]));
                  setAdding("");
                }}
              />
              <Plus size={16} className="text-ink-3" />
            </div>
          )}
          <Button variant="primary" size="md" className="ml-auto" disabled={list.length < 2 || !loves.length || running} onClick={() => void ex.compareCities(list)}>
            {running ? "Comparing" : "Compare"}
          </Button>
        </div>
        {!loves.length && <p className="mt-3 text-[13.5px] text-err">Add a few things you love first, then compare.</p>}

        <div className="mt-6">
          {running && (
            <p className="mb-3 flex items-center gap-2 text-[13.5px] leading-snug text-ink-2">
              <Spinner size={13} className="shrink-0 text-ink-3" />
              <span>
                {waiting.length > 0 ? `Mapping your taste in ${waiting.map((r) => cityName(r.city)).join(", ")}. ` : ""}Each city shows as soon as it is scored.
              </span>
            </p>
          )}
          {best && (
            <p className="mb-4 text-[16px] text-ink-2">
              {running || failed.some((r) => r.error?.retryable !== false) ? "So far, your" : "Your"} taste is strongest in <strong className="font-[650] text-ink">{cityName(best.city)}</strong>
              {best.topNeighborhood ? (
                <>
                  , starting in <strong className="font-[650] text-ink">{best.topNeighborhood}</strong>
                </>
              ) : null}
              .
            </p>
          )}
          {runs.length > 0 && (
            <ol className="grid gap-3 min-[1180px]:grid-cols-2">
              <AnimatePresence initial={false}>
                {done.map(({ data: c }, i) => (
                  <motion.li
                    key={c.city}
                    layout
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                    className={`rounded-[20px] p-4 ring-1 ${i === 0 ? "bg-[color-mix(in_oklch,var(--you)_7%,var(--paper-raised))] ring-[color-mix(in_oklch,var(--you)_30%,transparent)]" : "bg-paper-raised ring-line"}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${i === 0 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{i + 1}</span>
                        <span className="truncate text-[20px] font-[650] tracking-[-0.02em]">{cityName(c.city)}</span>
                      </span>
                      <span className="tnum text-[20px] font-[660]" title="Relative index: the best city in this comparison is 100">
                        {Math.round((c.score / top) * 100)}
                      </span>
                    </div>
                    <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-paper-sunk">
                      <motion.div className="h-full rounded-full bg-you" initial={{ width: 0 }} animate={{ width: `${(c.score / top) * 100}%` }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} />
                    </div>
                    <p className="mt-2.5 text-[13.5px] leading-snug text-ink-2">
                      {c.topNeighborhood ? (
                        <>
                          Start in <b className="font-[600] text-ink">{c.topNeighborhood}</b>.{" "}
                        </>
                      ) : null}
                      {c.matchedTags.length ? `Places feel ${c.matchedTags.slice(0, 3).join(", ").toLowerCase()}.` : ""}
                    </p>
                    {c.topPlaces.length > 0 && (
                      <p className="mt-1.5 text-[12.5px] text-ink-3">{c.topPlaces.slice(0, 3).map((p) => `${p.name} (${CAT[p.category] ?? p.category})`).join(", ")}</p>
                    )}
                    {c.sparse && <p className="mt-1.5 text-[12.5px] text-ink-3">Thin data for this city, treat the score as a rough hint.</p>}
                    <button onClick={() => onOpenCity(c.city)} className="mt-3 flex items-center gap-1 text-[13.5px] font-[600] text-you-deep hover:underline">
                      Open the map of {cityName(c.city)} <ArrowRight size={14} />
                    </button>
                  </motion.li>
                ))}
                {waiting.map((r) => (
                  <motion.li key={r.city} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-busy="true" className="rounded-[20px] p-4 ring-1 ring-line">
                    <p className="flex items-center gap-2 text-[17px] font-[620] tracking-[-0.015em] text-ink-2">
                      {r.status === "loading" ? <Spinner size={14} className="text-ink-3" /> : <span className="h-3.5 w-3.5 rounded-full ring-2 ring-line-strong" />}
                      {cityName(r.city)}
                      <span className="text-[12.5px] font-[500] tracking-normal text-ink-3">{r.status === "loading" ? "scoring" : "next"}</span>
                    </p>
                    <Skeleton className="mt-3 h-2" />
                    <Skeleton className="mt-3 h-[52px]" />
                  </motion.li>
                ))}
                {failed.map((r) => (
                  <motion.li
                    key={r.city}
                    layout
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    data-testid="city-error"
                    className="rounded-[20px] bg-paper-raised p-4 ring-1 ring-line"
                  >
                    <p className="text-[18px] font-[640] tracking-[-0.02em] text-ink-2">{cityName(r.city)}</p>
                    <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">{r.error?.message ?? "Homing couldn't score this city."}</p>
                    {r.error?.retryable !== false && (
                      <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => void ex.retryCity(r.city)}>
                        <RefreshCw size={14} /> Try {cityName(r.city)} again
                      </Button>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
          {done.length > 0 && (
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
              The index compares cities on equal terms: among the places Qloo picks for your taste in each city, how often they carry the atmosphere you prefer. The best city {running ? "so far " : ""}is 100.
            </p>
          )}
        </div>
    </section>
  );
}
