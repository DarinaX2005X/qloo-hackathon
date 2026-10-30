"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Clock,
  Coffee,
  Columns2,
  Footprints,
  Landmark,
  MapPin,
  Mic2,
  Music,
  RefreshCw,
  Scale,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { Category, Place } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { AreaRank, MetricNote, SupportTag } from "@/components/ui/Metric";
import { metricHeadline, metricNote, metricState } from "@/lib/honest";
import { ROLE_LABEL, toShortlist, type AreaAnchor, type ShortlistArea } from "@/components/map/areas";
import { LOVE_INKS } from "./inks";
import { PlaceDrawer } from "./PlaceDrawer";
import { useGoTo, useScreenHref } from "./nav";

export { LOVE_INKS };

const CAT: Record<Category, string> = { coffee: "Coffee", food: "Food", drinks: "Drinks", culture: "Culture", stay: "Stay" };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PRICE = ["", "$", "$$", "$$$", "$$$$"];
const hhmm = (s: string) => s.replace(/^T/, "").slice(0, 5);
const SHORTLIST = 3;

const ROLE_ICON: Record<string, LucideIcon> = { coffee: Coffee, food: UtensilsCrossed, bar: Wine, dance: Music, live_music: Mic2, culture: Landmark };

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

/**
 * The ranked areas for the current taste, in one shape for both answers: the v2 analysis when the backend sent one,
 * today's neighborhood list (with its drivers and sample places) while the route still answers the old shape.
 */
export function useShortlist() {
  const ex = useExplore();
  const a = ex.analysis;
  const v2 = a.data && !a.data.legacy ? a.data.areas : null;
  const source = v2 ?? ex.hoods.data;
  const areas = useMemo(() => toShortlist(source), [source]);
  const stale = !!(a as { stale?: boolean }).stale;
  return { areas, loading: a.loading || ex.hoods.loading, stale, error: a.error ?? ex.hoods.error, ready: !!source };
}

function AnchorLine({ a, sub }: { a: AreaAnchor; sub?: string | null }) {
  const Icon = (a.role && ROLE_ICON[a.role]) || MapPin;
  return (
    <li className="text-[13px] text-ink-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon size={13} strokeWidth={1.9} className="shrink-0 text-ink-3" aria-hidden />
        {a.role && <span className="shrink-0 text-ink-3">{ROLE_LABEL[a.role] ?? a.role}</span>}
        <span className="truncate font-[540] text-ink">{a.name}</span>
        {!a.insideArea && <span className="shrink-0 text-[11.5px] text-ink-3">just outside</span>}
      </span>
      {sub && <span className="block pl-[19px] text-[12px] text-ink-3">{sub}</span>}
    </li>
  );
}

/** One of the first three areas: rank, one reason, two places, one tradeoff. The card opens the area. */
function ShortlistCard({ a, onOpen, flagCheck, showTradeoff }: { a: ShortlistArea; onOpen: () => void; flagCheck: boolean; showTradeoff: boolean }) {
  const note = metricNote(a.metrics);
  const state = metricState(a.metrics);
  const first = a.rank === 1 && state === "ranked";
  return (
    <motion.li layout transition={{ type: "spring", stiffness: 380, damping: 34 }}>
      <button
        data-testid="shortlist-card"
        onClick={onOpen}
        className={`group w-full rounded-[18px] p-3.5 text-left ring-1 transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-raised)] active:scale-[0.99] ${first ? "bg-[color-mix(in_oklch,var(--you)_6%,var(--paper-raised))] ring-[color-mix(in_oklch,var(--you)_28%,transparent)]" : "bg-paper-raised ring-line"}`}
      >
        <div className="flex items-start gap-3">
          <span className={`tnum grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[14px] font-[660] ${first ? "bg-you text-white" : "bg-ink text-paper"}`}>{a.rank}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-[18px] font-[640] leading-tight tracking-[-0.02em] text-ink">{a.label}</h3>
              <ArrowRight size={15} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
            </div>
            {note && (
              <p className={`mt-0.5 text-[12.5px] font-[560] ${state === "ranked" ? "text-you-deep" : "text-ink-3"}`} data-testid="shortlist-note">
                {note}
              </p>
            )}
            {flagCheck && a.status === "needs_checking" && (
              <p className="mt-1.5 inline-flex rounded-[6px] bg-paper-sunk px-1.5 py-0.5 text-[11.5px] font-[560] text-ink-2">Promising, but its places still need checking</p>
            )}
            {a.headline && <p className="mt-1.5 text-[14px] leading-snug text-ink">{a.headline}</p>}
            {a.anchors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {a.anchors.slice(0, 2).map((x) => (
                  <AnchorLine key={x.id} a={x} />
                ))}
              </ul>
            )}
            {showTradeoff && a.tradeoff && <p className="mt-2 text-[12.5px] leading-snug text-ink-3">{a.tradeoff}</p>}
          </div>
        </div>
      </button>
    </motion.li>
  );
}

/** Areas below the first three, one line each. */
function MoreAreas({ areas, onOpen }: { areas: ShortlistArea[]; onOpen: (id: string) => void }) {
  const ex = useExplore();
  const [open, setOpen] = useState(false);
  if (!areas.length) return null;
  const toggleCompare = (id: string) => ex.setCompare(ex.compare.includes(id) ? ex.compare.filter((x) => x !== id) : [...ex.compare, id].slice(-2));
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between rounded-[12px] px-3 text-[14px] font-[580] text-ink-2 ring-1 ring-line transition-colors hover:bg-paper-sunk hover:text-ink"
      >
        {open ? "Hide the other areas" : `See the other ${areas.length} areas`}
        <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            {areas.map((a) => {
              const inCmp = ex.compare.includes(a.id);
              return (
                <li key={a.id} className="group relative mt-1 first:mt-2">
                  <button
                    data-testid="area-row"
                    onClick={() => onOpen(a.id)}
                    className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 pr-24 text-left transition-colors hover:bg-paper-sunk ${inCmp ? "ring-2 ring-ink/30" : ""}`}
                  >
                    <span className="tnum w-5 shrink-0 text-[13px] font-[650] text-ink-2">{a.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-[560] text-ink">{a.label}</span>
                  </button>
                  <button
                    onClick={() => toggleCompare(a.id)}
                    aria-pressed={inCmp}
                    className={`absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 rounded-[8px] px-2 text-[12px] font-[560] transition-[opacity,background-color] ${inCmp ? "bg-ink text-paper opacity-100" : "bg-paper-sunk text-ink-2 opacity-0 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"}`}
                  >
                    <Columns2 size={13} /> {inCmp ? "Comparing" : "Compare"}
                  </button>
                </li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompareBar({ all }: { all: ShortlistArea[] }) {
  const ex = useExplore();
  const href = useScreenHref();
  const cmp = ex.compare.map((id) => all.find((n) => n.id === id)).filter(Boolean) as ShortlistArea[];
  if (cmp.length === 2)
    return (
      <Link
        href={href("/explore/compare")}
        scroll={false}
        className="mb-3 flex items-center justify-between gap-2 rounded-[14px] bg-ink px-3.5 py-2.5 text-[14px] font-[560] text-paper shadow-[var(--shadow-raised)] transition-transform hover:-translate-y-px"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Columns2 size={15} className="shrink-0" />
          <span className="truncate">
            Compare {cmp[0].label} and {cmp[1].label}
          </span>
        </span>
        <ArrowRight size={15} className="shrink-0" />
      </Link>
    );
  if (cmp.length === 1) return <p className="mb-2 text-[12.5px] text-ink-3">Pick one more area to compare with {cmp[0].label}.</p>;
  return null;
}

function Shortlist() {
  const ex = useExplore();
  const { areas, loading, stale, error, ready } = useShortlist();
  const open = (id: string) => ex.patch([{ op: "select_neighborhood", id }]);
  if (error && !ready) return <ErrorNote message={error.message} onRetry={ex.retry} />;
  if (!ready)
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="flex items-center gap-2 pb-1 text-[14px] text-ink-2">
          <Spinner size={13} className="text-ink-3" /> Comparing the areas of {cityName(ex.state.city)} for your loves
        </p>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[132px]" />
        ))}
      </div>
    );
  if (!areas.length) return <p className="text-[14.5px] text-ink-2">Homing found your cultural signal here but no named areas inside it. Try a larger city nearby.</p>;
  const top = areas.slice(0, SHORTLIST);
  // when every area is a starting point to check (the usual case), say it once instead of on each card
  const mixed = top.some((a) => a.status === "recommended") && top.some((a) => a.status === "needs_checking");
  const allCheck = top.every((a) => a.status === "needs_checking");
  // the same caveat on every card is said once, under the list
  const sharedTradeoff = top.length > 1 && top[0].tradeoff && top.every((a) => a.tradeoff === top[0].tradeoff) ? top[0].tradeoff : null;
  const count = areas[0].metrics.candidateCount || areas.length;
  return (
    <LayoutGroup>
      <CompareBar all={areas} />
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[24px] font-[660] leading-tight tracking-[-0.025em]">{metricHeadline(areas.map((a) => a.metrics))}</h2>
          {(loading || stale) && <Spinner size={15} className="shrink-0 text-ink-3" />}
        </div>
        <p className="mt-1 text-[13.5px] leading-snug text-ink-2">
          {stale ? "Updating for your latest change. " : ""}
          The first three of {count} areas compared in {cityName(ex.state.city)}.
          {allCheck ? " Start your search here and check their places in person." : ""}
        </p>
        <MetricNote city={cityName(ex.state.city)} candidateCount={count} className="mt-0.5" />
      </div>
      <ol className={`space-y-2 transition-opacity ${loading || stale ? "opacity-60" : ""}`}>
        {top.map((a) => (
          <ShortlistCard key={a.id} a={a} onOpen={() => open(a.id)} flagCheck={mixed} showTradeoff={!sharedTradeoff} />
        ))}
      </ol>
      {sharedTradeoff && <p className="mt-2.5 px-1 text-[12.5px] leading-snug text-ink-3">{sharedTradeoff}</p>}
      <MoreAreas areas={areas.slice(SHORTLIST)} onOpen={open} />
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
        <img src={p.image} alt="" className="h-[76px] w-[76px] shrink-0 rounded-[11px] object-cover" loading="lazy" />
      ) : (
        <div className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-[11px] bg-paper-sunk text-[12px] text-ink-3">{CAT[p.category]}</div>
      )}
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[12px] font-[560] text-ink-3">{CAT[p.category]}</p>
        <h4 className="truncate pr-8 text-[15px] font-[600] tracking-[-0.01em] text-ink">{p.name}</h4>
        {p.why.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {p.why.slice(0, 2).map((w) => (
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
        aria-label={saved ? `Remove ${p.name} from saved places` : `Save ${p.name}`}
        aria-pressed={saved}
        className={`absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-[9px] transition-[opacity,background-color] hover:bg-paper-sunk ${saved ? "text-you opacity-100" : "text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
      >
        {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
      </button>
    </motion.article>
  );
}

type Decisions = { buildVisit?: (areaId: string) => Promise<void> };

/** The three things to do with an area: see why, check a flat, walk it. */
function AreaActions({ a }: { a: ShortlistArea }) {
  const ex = useExplore();
  const goTo = useGoTo();
  const visit = (ex as unknown as Decisions).buildVisit;
  const tryArea = () => {
    if (visit) void visit(a.id);
    else void ex.makePlan();
    goTo("/explore/trip");
  };
  return (
    <div className="grid gap-2">
      <Button variant="primary" size="md" onClick={tryArea} className="w-full" data-testid="try-area">
        <Footprints size={16} strokeWidth={1.9} /> Try this area on foot
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="md" onClick={() => goTo("/explore/address")} data-testid="check-address">
          <MapPin size={15} strokeWidth={1.9} /> Check an address
        </Button>
        <Button variant="secondary" size="md" onClick={() => goTo("/explore/why")} data-testid="why-area">
          <Scale size={15} strokeWidth={1.9} /> Why this area
        </Button>
      </div>
    </div>
  );
}

function useLoveNames() {
  const ex = useExplore();
  return useMemo(() => new Map(activeLoves(ex.state.loves).map((l) => [l.chosen.id, l.chosen.name])), [ex.state.loves]);
}

/** The love Qloo ties most to an anchor (its own explainability), said as a link, never as a share of people. */
function connectionText(x: AreaAnchor, names: Map<string, string>) {
  const known = (x.venue?.connections ?? []).filter((k) => names.has(k.loveId));
  if (!known.length) return null;
  const best = [...known].sort((a, b) => (b.providerContribution ?? 0) - (a.providerContribution ?? 0))[0];
  const love = names.get(best.loveId);
  if (best.explanationKind === "shared_tags") return `Shares tags with ${love}`;
  return known.length > 1 ? `Qloo ties it to ${love} and your other loves` : `Qloo ties it to ${love}`;
}

function Detail({ a, all }: { a: ShortlistArea; all: ShortlistArea[] }) {
  const ex = useExplore();
  const loveNames = useLoveNames();
  const counts = Object.fromEntries((Object.keys(CAT) as Category[]).map((c) => [c, new Set((ex.places.data ?? []).filter((p) => p.category === c).map((p) => p.id)).size]));
  const opts = [{ value: "all" as const, label: "All" }, ...(Object.keys(CAT) as Category[]).filter((c) => counts[c]).map((c) => ({ value: c, label: CAT[c] }))];
  const support = a.decision?.metrics.support.quality ?? null;
  // the same link on every place is said once, under the list
  const links = a.anchors.slice(0, 3).map((x) => connectionText(x, loveNames));
  const sameLink = links.length > 1 && links[0] && links.every((l) => l === links[0]) ? links[0] : null;
  return (
    <div>
      <button onClick={() => ex.patch([{ op: "select_neighborhood", id: null }])} className="mb-2 flex min-h-8 items-center gap-1 text-[13px] font-[550] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> All areas
      </button>
      <div className="mb-3">
        <h2 className="text-[28px] font-[680] leading-none tracking-[-0.03em]">{a.label}</h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <AreaRank metrics={{ ...a.metrics, candidateCount: a.metrics.candidateCount || all.length }} size="md" />
          <SupportTag quality={support} />
        </div>
        {a.approximate && <p className="mt-2 text-[12.5px] text-ink-3">A walkable circle of about {Math.round((a.radiusM ?? 650) / 50) * 50} m around its centre, not the official boundary.</p>}
      </div>

      <section className="mb-4 rounded-[16px] bg-paper-sunk/60 p-3.5">
        <h3 className="text-[13px] font-[600] text-ink-3">Why this area for you</h3>
        {a.headline && <p className="mt-1 text-[15px] leading-snug text-ink">{a.headline}</p>}
        {a.anchors.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {a.anchors.slice(0, 3).map((x) => (
              <AnchorLine key={x.id} a={x} sub={sameLink ? null : connectionText(x, loveNames)} />
            ))}
          </ul>
        )}
        {sameLink && <p className="mt-1.5 text-[12.5px] text-ink-3">{sameLink.replace("Qloo ties it", "Qloo ties each of them")}</p>}
        {a.tradeoff && <p className="mt-2 text-[13px] leading-snug text-ink-2">{a.tradeoff}</p>}
      </section>

      <AreaActions a={a} />

      <h3 className="mb-2 mt-6 text-[16px] font-[640] tracking-[-0.01em]">Your everyday places here</h3>
      <div className="mb-3">{opts.length > 2 && <Segmented size="sm" label="Category" value={ex.category} onChange={(v) => ex.setCategory(v)} options={opts} />}</div>
      {ex.places.error && <ErrorNote message={ex.places.error.message} onRetry={ex.retry} />}
      {ex.places.loading && !ex.places.data && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[96px]" />
          ))}
        </div>
      )}
      {ex.places.data && !ex.visiblePlaces.length && (
        <p className="text-[14px] text-ink-2">{ex.state.budget ? "Nothing in this category fits your taste and budget here. Try a higher budget." : "Nothing in this category matched your taste here."}</p>
      )}
      <div className="space-y-2">
        {ex.visiblePlaces.map((p) => (
          <PlaceCard key={`${p.id}-${p.category}`} p={p} />
        ))}
      </div>
    </div>
  );
}

/** The right-hand part of the single map panel: the shortlist, or one area opened from it. */
export function ResultsPanel({ scroll = true }: { scroll?: boolean }) {
  const ex = useExplore();
  const { areas } = useShortlist();
  const sel = areas.find((a) => a.id === ex.state.neighborhood) ?? null;
  const fieldErr = ex.field.error;
  return (
    <div className={scroll ? "hm-scroll h-full overflow-y-auto overscroll-contain px-5 pb-6 pt-4" : "px-5 pb-6 pt-4"}>
      {fieldErr && !ex.field.data ? (
        <ErrorNote message={fieldErr.message} onRetry={fieldErr.retryable ? ex.retry : undefined} />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {ex.openPlace ? (
            <PlaceDrawer key={`p-${ex.openPlace.id}`} place={ex.openPlace} />
          ) : sel ? (
            <motion.div key={`d-${sel.id}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}>
              <Detail a={sel} all={areas} />
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}>
              {ex.field.data?.sparse && (
                <p className="mb-3 text-[13.5px] leading-snug text-ink-2">Qloo has thin data for {cityName(ex.state.city)}, so this list rests on fewer signals than usual.</p>
              )}
              <Shortlist />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
