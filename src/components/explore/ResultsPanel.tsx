"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, CalendarPlus, Clock, Columns2, RefreshCw } from "lucide-react";
import type { Category, Neighborhood, Place } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { LOVE_INKS } from "./inks";
import { PlaceDrawer } from "./PlaceDrawer";
import { useGoTo, useScreenHref } from "./nav";

export { LOVE_INKS };

const VIBE: Record<Neighborhood["vibe"], string> = { local: "Mostly locals", mixed: "Locals and visitors", touristy: "Busy with visitors" };
const CAT: Record<Category, string> = { coffee: "Coffee", food: "Food", drinks: "Drinks", culture: "Culture", stay: "Stay" };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PRICE = ["", "$", "$$", "$$$", "$$$$"];
const hhmm = (s: string) => s.replace(/^T/, "").slice(0, 5);

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-[14px] bg-[color-mix(in_oklch,var(--err)_7%,var(--paper-raised))] p-3.5 text-[14px] text-ink ring-1 ring-[color-mix(in_oklch,var(--err)_22%,transparent)]">
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-2.5" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}

function why(n: Neighborhood) {
  const parts: string[] = [];
  const top = n.drivers[0];
  if (top && top.share >= 0.36) parts.push(`${top.love} pulls this one up most.`);
  else if (n.drivers.length > 1) parts.push("Everything you love lands here evenly.");
  if (n.matchedTags.length) parts.push(`Places feel ${n.matchedTags.slice(0, 3).join(", ").toLowerCase()}.`);
  return parts.join(" ");
}

function DriverBar({ n, order }: { n: Neighborhood; order: string[] }) {
  const segs = order
    .map((love, i) => ({ love, i, share: n.drivers.find((d) => d.love === love)?.share ?? 0 }))
    .filter((x) => x.share > 0.01);
  if (segs.length < 2) return null;
  return (
    <div className="mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-label={segs.map((x) => `${x.love} ${Math.round(x.share * 100)}%`).join(", ")}>
      {segs.map((x) => (
        <motion.span layout key={x.love} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: x.share, background: LOVE_INKS[x.i % LOVE_INKS.length] }} />
      ))}
    </div>
  );
}

function Legend({ order }: { order: string[] }) {
  if (order.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
      {order.map((l, i) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: LOVE_INKS[i % LOVE_INKS.length] }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function Ranking() {
  const ex = useExplore();
  const href = useScreenHref();
  const pair = !!ex.state.companion && activeLoves(ex.state.companion.loves).length > 0;
  const { data, loading, error } = ex.hoods;
  const order = activeLoves(ex.state.loves).map((l) => l.chosen.name);
  if (error && !data) return <ErrorNote message={error.message} onRetry={ex.retry} />;
  if (!data)
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[86px]" />
        ))}
      </div>
    );
  if (!data.length)
    return <p className="text-[14.5px] text-ink-2">We found the taste field but no named neighborhoods in it. Try a larger city nearby.</p>;
  const cmp = ex.compare.map((id) => data.find((n) => n.id === id)).filter(Boolean) as Neighborhood[];
  const toggleCompare = (id: string) =>
    ex.setCompare(ex.compare.includes(id) ? ex.compare.filter((x) => x !== id) : [...ex.compare, id].slice(-2));
  return (
    <LayoutGroup>
      {cmp.length === 2 && (
        <Link
          href={href("/explore/compare")}
          scroll={false}
          className="mb-3 flex items-center justify-between gap-2 rounded-[14px] bg-ink px-3.5 py-2.5 text-[14px] font-[560] text-paper shadow-[var(--shadow-raised)] transition-transform hover:-translate-y-px"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Columns2 size={15} className="shrink-0" />
            <span className="truncate">
              Compare {cmp[0].name} and {cmp[1].name} side by side
            </span>
          </span>
          <ArrowRight size={15} className="shrink-0" />
        </Link>
      )}
      {cmp.length === 1 && <p className="mb-2 text-[12.5px] text-ink-3">Pick one more neighborhood to compare with {cmp[0].name}.</p>}
      {!pair && <Legend order={order} />}
      <ol className={`space-y-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {data.map((n) => {
          const inCmp = ex.compare.includes(n.id);
          return (
            <motion.li layout key={n.id} transition={{ type: "spring", stiffness: 380, damping: 34 }} className="group relative">
              <button
                data-testid="neighborhood-row"
                onClick={() => ex.patch([{ op: "select_neighborhood", id: n.id }])}
                className={`w-full rounded-[16px] p-3.5 pb-3 text-left ring-1 transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-raised)] active:scale-[0.99] ${n.rank === 1 ? "bg-[color-mix(in_oklch,var(--you)_7%,var(--paper-raised))] ring-[color-mix(in_oklch,var(--you)_30%,transparent)]" : "bg-paper-raised ring-line"} ${inCmp ? "ring-2 ring-ink/40" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${n.rank === 1 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{n.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[17px] font-[620] tracking-[-0.015em] text-ink">{n.name}</span>
                      <span className="tnum shrink-0 text-[17px] font-[640] text-ink">{Math.round(n.score * 100)}</span>
                    </div>
                    {!pair && <DriverBar n={n} order={order} />}
                    {pair && n.them !== undefined && (
                      <div className="mt-1.5 space-y-1">
                        {[
                          ["You", n.you, "var(--you)"],
                          ["Them", n.them, "var(--them)"],
                        ].map(([l, v, c]) => (
                          <div key={l as string} className="flex items-center gap-2 text-[11.5px] text-ink-3">
                            <span className="w-9">{l as string}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                              <motion.span layout className="block h-full rounded-full" style={{ width: `${(v as number) * 100}%`, background: c as string }} />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">{why(n)}</p>
                    <p className="mt-1.5 pr-24 text-[12px] text-ink-3">{VIBE[n.vibe]}</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => toggleCompare(n.id)}
                aria-pressed={inCmp}
                className={`absolute bottom-2.5 right-3 flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-[560] transition-[opacity,background-color] ${inCmp ? "bg-ink text-paper opacity-100" : "bg-paper-sunk text-ink-2 opacity-0 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"}`}
              >
                <Columns2 size={13} /> {inCmp ? "Comparing" : "Compare"}
              </button>
            </motion.li>
          );
        })}
      </ol>
    </LayoutGroup>
  );
}

function hoursToday(p: Place) {
  if (!p.hours) return null;
  const spans = p.hours[WEEKDAYS[new Date().getDay()]];
  if (!spans) return null;
  if (!spans.length) return "Closed today";
  return spans.map((s) => `${hhmm(s.opens)}–${hhmm(s.closes)}`).join(", ");
}

export function PlaceCard({ p }: { p: Place }) {
  const ex = useExplore();
  const active = ex.activePlace === p.id;
  const saved = ex.isSaved(p.id);
  const h = hoursToday(p);
  return (
    <motion.article
      layout
      data-testid="place-card"
      onMouseEnter={() => ex.setActivePlace(p.id)}
      onMouseLeave={() => ex.setActivePlace(null)}
      className={`group relative flex gap-3 rounded-[16px] bg-paper-raised p-2.5 ring-1 transition-shadow ${active ? "shadow-[var(--shadow-raised)] ring-ink/30" : "ring-line"}`}
    >
      <button onClick={() => ex.setOpenPlace(p)} className="absolute inset-0 rounded-[16px]" aria-label={`Open ${p.name}`} />
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" className="h-[84px] w-[84px] shrink-0 rounded-[11px] object-cover" loading="lazy" />
      ) : (
        <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[11px] bg-paper-sunk text-[12px] text-ink-3">{CAT[p.category]}</div>
      )}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-baseline justify-between gap-2 pr-8">
          <h4 className="truncate text-[15px] font-[600] tracking-[-0.01em] text-ink">{p.name}</h4>
          <span className="tnum shrink-0 text-[13px] font-[600] text-you-deep">{Math.round(p.affinity * 100)}</span>
        </div>
        {p.why.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {p.why.slice(0, 3).map((w) => (
              <span key={w} className="rounded-[6px] bg-you-soft px-1.5 py-0.5 text-[11.5px] font-[520] text-you-deep">
                {w}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[12px] text-ink-3">
          {h && (
            <span className="flex items-center gap-1">
              <Clock size={12} /> {h}
            </span>
          )}
          {p.priceLevel ? <span>{PRICE[p.priceLevel]}</span> : null}
        </div>
      </div>
      <button
        onClick={() => ex.toggleSave(p)}
        aria-label={saved ? `Remove ${p.name} from shortlist` : `Save ${p.name}`}
        aria-pressed={saved}
        className={`absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-[9px] transition-[opacity,background-color] hover:bg-paper-sunk ${saved ? "text-you opacity-100" : "text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
      >
        {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
      </button>
    </motion.article>
  );
}

function Detail({ n }: { n: Neighborhood }) {
  const ex = useExplore();
  const counts = Object.fromEntries((Object.keys(CAT) as Category[]).map((c) => [c, new Set((ex.places.data ?? []).filter((p) => p.category === c).map((p) => p.id)).size]));
  const opts = [{ value: "all" as const, label: "All" }, ...(Object.keys(CAT) as Category[]).filter((c) => counts[c]).map((c) => ({ value: c, label: CAT[c] }))];
  return (
    <div>
      <button onClick={() => ex.patch([{ op: "select_neighborhood", id: null }])} className="mb-2 flex items-center gap-1 text-[13px] font-[550] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> All neighborhoods
      </button>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[28px] font-[680] leading-none tracking-[-0.03em]">{n.name}</h3>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            Ranked {n.rank} of {ex.hoods.data?.length ?? n.rank} for your taste. {VIBE[n.vibe]}.
          </p>
        </div>
        <span className="tnum text-[34px] font-[680] leading-none tracking-[-0.03em] text-you">{Math.round(n.score * 100)}</span>
      </div>
      <PlanEntry />
      <div className="mb-3 mt-4">
        {opts.length > 2 && <Segmented size="sm" label="Category" value={ex.category} onChange={(v) => ex.setCategory(v)} options={opts} />}
      </div>
      {ex.places.error && <ErrorNote message={ex.places.error.message} onRetry={ex.retry} />}
      {ex.places.loading && !ex.places.data && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      )}
      {ex.places.data && !ex.visiblePlaces.length && (
        <p className="text-[14px] text-ink-2">{ex.state.budget ? "Nothing in this category fits your taste and budget nearby. Try a higher budget." : "Nothing in this category matched your taste nearby."}</p>
      )}
      <div className="space-y-2">
        {ex.visiblePlaces.map((p) => (
          <PlaceCard key={`${p.id}-${p.category}`} p={p} />
        ))}
      </div>
    </div>
  );
}

/** The short way into the plan from the Map screen; the full day-by-day timeline lives on the Trip screen. */
function PlanEntry() {
  const ex = useExplore();
  const goTo = useGoTo();
  const plan = ex.plan.data;
  const stops = plan?.days.reduce((n, d) => n + d.stops.length, 0) ?? 0;
  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        size="md"
        onClick={() => {
          void ex.makePlan();
          goTo("/explore/trip");
        }}
        disabled={ex.plan.loading}
        className="w-full"
      >
        {ex.plan.loading ? <Spinner size={15} /> : <CalendarPlus size={16} strokeWidth={1.9} />}
        {plan ? "Plan again" : "Plan my first days"}
      </Button>
      {plan && (
        <button
          onClick={() => goTo("/explore/trip")}
          className="group flex w-full items-center justify-between gap-3 rounded-[14px] bg-paper-sunk/70 px-3.5 py-2.5 text-left transition-colors hover:bg-paper-sunk"
        >
          <span className="min-w-0">
            <span className="block text-[14px] font-[600] text-ink">
              Your first {plan.days.length > 1 ? `${plan.days.length} days` : "day"}, {stops} stops
            </span>
            <span className="block truncate text-[12.5px] text-ink-2">
              {plan.days.map((d) => d.neighborhood).filter((n, i, a) => a.indexOf(n) === i).join(", ")}, starting with {plan.days[0]?.stops[0]?.place.name ?? "a morning coffee"}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13px] font-[600] text-you-deep">
            Open <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      )}
      {ex.plan.error && <ErrorNote message={ex.plan.error.message} onRetry={() => void ex.makePlan()} />}
    </div>
  );
}

export function ResultsPanel() {
  const ex = useExplore();
  const href = useScreenHref();
  const n = ex.selected;
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const fieldErr = ex.field.error;
  return (
    <div className="hm-scroll h-full overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
      {!hasLoves ? (
        <div className="pt-1">
          <h2 className="text-[22px] font-[650] leading-tight tracking-[-0.02em]">Where you&apos;ll fit in</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
            Add a few things you love. Homing looks them up in Qloo&apos;s taste graph, maps where people who love the same things gather in {cityName(ex.state.city)}, and ranks the neighborhoods for you.
          </p>
        </div>
      ) : fieldErr && !ex.field.data ? (
        <ErrorNote message={fieldErr.message} onRetry={fieldErr.retryable ? ex.retry : undefined} />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {ex.openPlace ? (
            <PlaceDrawer key={`p-${ex.openPlace.id}`} place={ex.openPlace} />
          ) : n ? (
            <motion.div key={`d-${n.id}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <Detail n={n} />
            </motion.div>
          ) : (
            <motion.div key="rank" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-[22px] font-[650] leading-tight tracking-[-0.02em]">Your neighborhoods</h2>
                <span className="flex items-center gap-2">
                  {ex.hoods.loading && <Spinner size={15} className="text-ink-3" />}
                  {ex.saved.length > 0 && (
                    <Link
                      href={href("/explore/trip")}
                      scroll={false}
                      className="flex h-7 items-center gap-1 rounded-[8px] bg-paper-sunk px-2 text-[12.5px] font-[580] text-ink-2 hover:text-ink"
                      title="Your shortlist is on the Trip screen"
                    >
                      <BookmarkCheck size={13} className="text-you" /> Saved {ex.saved.length}
                    </Link>
                  )}
                </span>
              </div>
              {ex.field.data?.sparse && (
                <p className="mb-3 text-[13.5px] leading-snug text-ink-2">Qloo has thin taste data for {cityName(ex.state.city)}, so this ranking rests on fewer signals than usual.</p>
              )}
              <Ranking />
              {ex.hoods.data && ex.hoods.data.length > 0 && (
                <div className="mt-4">
                  <PlanEntry />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
