"use client";

import { motion } from "motion/react";
import { ArrowRight, BedDouble, Check, Coffee, Footprints, Landmark, MoonStar, UtensilsCrossed, Wine } from "lucide-react";
import type { Category, DecidesResult, HomeResult, Neighborhood, SpotResult } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { LOVE_INKS } from "@/components/explore/inks";
import { cityName } from "@/components/ui/CityPicker";
import { decidesStatement } from "@/lib/explain";
import { gridText, SIMILARITY_LABEL, twinSharedTag, walkText } from "@/lib/honest";
import { BelowNeutralNote, MatchExplainer, MatchValue } from "@/components/ui/Match";

type HomePlace = HomeResult["source"]["places"][number];

export const CAT_LABEL: Record<Category, string> = { coffee: "Café", food: "Food", drinks: "Bar", culture: "Culture", stay: "Stay" };
export const CAT_GROUP: Record<Category, string> = { coffee: "Coffee", food: "Food", drinks: "Drinks", culture: "Culture", stay: "Stay" };
export const CAT_ICON: Record<Category, typeof Coffee> = { coffee: Coffee, food: UtensilsCrossed, drinks: Wine, culture: Landmark, stay: BedDouble };
const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

/** Loves of the person as the map knows them: name, picture and the ink they get in bars. */
export function useLoveLook() {
  const ex = useExplore();
  const loves = activeLoves(ex.state.loves);
  return (key: string) => {
    const k = key.toLowerCase();
    const i = loves.findIndex((l) => l.query.toLowerCase() === k || l.chosen.name.toLowerCase() === k);
    const l = i >= 0 ? loves[i] : null;
    return { name: l?.chosen.name ?? key, image: l?.chosen.image, ink: LOVE_INKS[(i >= 0 ? i : loves.length) % LOVE_INKS.length] };
  };
}

export function LoveFace({ name, image, size = 24 }: { name: string; image?: string; size?: number }) {
  if (image)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover ring-1 ring-line" style={{ width: size, height: size }} loading="lazy" />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-paper-sunk text-[11px] font-[650] text-ink-2 ring-1 ring-line" style={{ width: size, height: size }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "you" | "ink" }) {
  const cls = tone === "you" ? "bg-you-soft text-you-deep" : tone === "ink" ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2";
  return <span className={`inline-flex h-6 items-center gap-1 rounded-[7px] px-2 text-[12px] font-[540] ${cls}`}>{children}</span>;
}

function PlaceChip({ p }: { p: HomePlace }) {
  const Icon = p.category ? CAT_ICON[p.category] : Landmark;
  return (
    <span title={p.name} className="inline-flex h-7 max-w-[190px] items-center gap-1.5 rounded-[9px] bg-paper-raised px-2 text-[12.5px] font-[540] text-ink ring-1 ring-line">
      <Icon size={13} strokeWidth={1.9} className="shrink-0 text-ink-3" />
      <span className="truncate">{p.name}</span>
    </span>
  );
}

/** A suggested counterpart: a place here that shares a taste tag with a place from home. Not a claim that they are the same. */
function TwinPair({ from, to, compact }: { from: HomePlace; to: HomePlace; compact?: boolean }) {
  const cat = to.category ?? from.category;
  const Icon = cat ? CAT_ICON[cat] : Landmark;
  const card = "min-w-0 flex-1 rounded-[11px] px-2.5 py-1.5";
  const tag = twinSharedTag(from, to);
  return (
    <div>
    <div className="flex items-stretch gap-1.5">
      <div className={`${card} bg-paper-sunk`}>
        <p className={`truncate font-[580] text-ink-2 ${compact ? "text-[12.5px]" : "text-[13px]"}`}>{from.name}</p>
        {!compact && <p className="truncate text-[11.5px] text-ink-3">at home</p>}
      </div>
      <span className="grid w-6 shrink-0 place-items-center text-you">
        <ArrowRight size={15} strokeWidth={2.2} />
      </span>
      <div className={`${card} bg-[color-mix(in_oklch,var(--you)_8%,var(--paper-raised))] ring-1 ring-[color-mix(in_oklch,var(--you)_22%,transparent)]`}>
        <p className={`flex items-center gap-1 truncate font-[600] text-ink ${compact ? "text-[12.5px]" : "text-[13px]"}`}>
          <Icon size={12} strokeWidth={2} className="shrink-0 text-you-deep" />
          <span className="truncate">{to.name}</span>
        </p>
        {!compact && <p className="truncate text-[11.5px] text-ink-3">{cat ? `${CAT_LABEL[cat]} here` : "here"}</p>}
      </div>
    </div>
    <p className={`mt-1 text-ink-3 ${compact ? "text-[11.5px]" : "text-[12px]"}`}>
      Suggested counterpart{tag ? <> that shares <span className="font-[580] text-ink-2">{tag}</span></> : " of the same kind"}
    </p>
    </div>
  );
}

function NoTwin({ compact }: { compact?: boolean }) {
  return <p className={`text-ink-3 ${compact ? "text-[12px]" : "text-[12.5px]"}`}>No close twin found: no place here shares a telling taste tag with one from home.</p>;
}

/** "29%" over "taste-tag similarity": weighted overlap of the areas' Qloo taste tags, zero allowed. */
function Similarity({ value, size = "md" }: { value: number; size?: "md" | "lg" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="shrink-0 text-right" title="How much the Qloo taste tags of this area's places overlap with those of the old neighborhood, from 0 to 100%. Not a ranking.">
      <span className={`tnum block leading-none ${size === "lg" ? "text-[19px] font-[670]" : "text-[18px] font-[660]"} ${v > 0 ? "text-ink" : "text-ink-3"}`}>{v}%</span>
      <span className="mt-0.5 block whitespace-nowrap text-[11px] font-[500] text-ink-3">{SIMILARITY_LABEL}</span>
    </span>
  );
}

// ---------------------------------------------------------------- Feels like home

export function HomeCard({
  result,
  compact = false,
  onPick,
  activeId,
  activeNote,
}: {
  result: HomeResult;
  compact?: boolean;
  /** called with the neighborhood of a match the person clicked */
  onPick?: (n: Neighborhood) => void;
  activeId?: string | null;
  /** shown inside the picked match */
  activeNote?: React.ReactNode;
}) {
  const ex = useExplore();
  const here = cityName(result.field.city || ex.state.city);
  const src = result.source;
  const byId = new Map(result.neighborhoods.map((n) => [n.id, n]));
  const matches = result.matches.map((m) => ({ m, n: byId.get(m.neighborhoodId) })).filter((x): x is { m: (typeof result.matches)[number]; n: Neighborhood } => !!x.n);

  if (compact) {
    const top = matches[0];
    return (
      <div className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line">
        <p className="text-[12.5px] font-[560] text-ink-3">
          {src.neighborhood}, {cityName(src.city)} in {here}
        </p>
        {top ? (
          <>
            <div className="mt-1 flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-[18px] font-[650] tracking-[-0.02em]">{top.n.name}</span>
                <MatchValue score={top.n.score} size="sm" />
              </span>
              <Similarity value={top.m.similarity} />
            </div>
            <div className="mt-2">{top.m.twins[0] ? <TwinPair from={top.m.twins[0].source} to={top.m.twins[0].target} compact /> : <NoTwin compact />}</div>
            {matches.length > 1 && (
              <p className="mt-2 text-[12.5px] text-ink-2">
                Then {matches.slice(1).map((x) => `${x.n.name} (${Math.round(x.m.similarity)}% ${SIMILARITY_LABEL})`).join(" and ")}.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-[13.5px] text-ink-2">Nothing in {here} came close enough to compare.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <section className="rounded-[20px] bg-paper-sunk/70 p-4">
        <p className="text-[12.5px] font-[580] text-ink-3">Where you lived</p>
        <h3 className="mt-0.5 text-[20px] font-[660] leading-tight tracking-[-0.02em]">
          {src.neighborhood}, {cityName(src.city)}
        </h3>
        {src.tags.length > 0 && <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">Its places feel {joinWords(src.tags.slice(0, 4).map((t) => t.toLowerCase()))}.</p>}
        {src.places.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {src.places.slice(0, 6).map((p) => (
              <PlaceChip key={p.id} p={p} />
            ))}
          </div>
        )}
        <p className="mt-2.5 text-[12px] leading-snug text-ink-3">Homing reads these places in Qloo and looks for where the same taste shows up in {here}.</p>
      </section>

      <h3 className="mt-5 text-[15px] font-[620] tracking-[-0.01em]">Closest in {here}</h3>
      <p className="mb-2.5 mt-0.5 text-[12.5px] leading-snug text-ink-3">
        Ordered by the old neighborhood&apos;s taste map. The percentage is {SIMILARITY_LABEL}: how much the Qloo taste tags of the places overlap, and it can be low.
      </p>
      {!matches.length && <p className="text-[14px] text-ink-2">Nothing in {here} came close enough to compare. Try another neighborhood or mix in what you love.</p>}
      <ol className="space-y-2.5">
        {matches.map(({ m, n }, i) => {
          const on = activeId === n.id;
          return (
            <motion.li key={n.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: i * 0.06 }}>
              <div
                role={onPick ? "button" : undefined}
                tabIndex={onPick ? 0 : undefined}
                onClick={() => onPick?.(n)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick && (e.preventDefault(), onPick(n))}
                className={`rounded-[18px] p-3.5 ring-1 transition-[transform,box-shadow] duration-150 ${onPick ? "cursor-pointer hover:-translate-y-px hover:shadow-[var(--shadow-raised)] active:scale-[0.995]" : ""} ${i === 0 ? "bg-[color-mix(in_oklch,var(--you)_6%,var(--paper-raised))]" : "bg-paper-raised"} ${on ? "shadow-[var(--shadow-raised)] ring-2 ring-ink" : i === 0 ? "ring-[color-mix(in_oklch,var(--you)_28%,transparent)]" : "ring-line"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${i === 0 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-[630] tracking-[-0.015em]">{n.name}</span>
                    <MatchValue score={n.score} size="sm" />
                  </span>
                  <Similarity value={m.similarity} size="lg" />
                </div>
                <div className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunk">
                  <motion.div className="h-full rounded-full bg-you" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, m.similarity))}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] }} />
                </div>
                {m.sharedTags.length > 0 && (
                  <div className="ml-10 mt-2.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 text-[12px] text-ink-3">Shares</span>
                    {m.sharedTags.map((t) => (
                      <Chip key={t} tone="you">
                        {t}
                      </Chip>
                    ))}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {m.twins.length > 0 ? m.twins.map((t) => <TwinPair key={`${t.source.id}-${t.target.id}`} from={t.source} to={t.target} />) : <NoTwin />}
                </div>
                {on && activeNote && <div className="mt-3 border-t border-line pt-2.5 text-[13px] text-ink-2">{activeNote}</div>}
              </div>
            </motion.li>
          );
        })}
      </ol>
      <BelowNeutralNote
        show={result.neighborhoods.some((n) => !!n.rankingNote)}
        text={`None of the mapped areas of ${here} stands out for this taste; these are the closest, below the neutral 50.`}
        className="mt-3"
      />
      {matches.length > 0 && <MatchExplainer className="mt-3" />}
    </div>
  );
}

// ---------------------------------------------------------------- Check an address

function StatTile({ n, label, icon: Icon }: { n: number; label: string; icon: typeof Coffee }) {
  return (
    <div className="rounded-[14px] bg-paper-sunk/80 px-2 py-2 text-center">
      <Icon size={14} strokeWidth={1.9} className="mx-auto text-ink-3" />
      <p className="tnum mt-1 text-[18px] font-[660] leading-none">{n}</p>
      <p className="mt-1 text-[11.5px] leading-tight text-ink-3">{label}</p>
    </div>
  );
}

/** The geocoder found the street but not the house number. Read from a flag if the backend sends one,
 *  otherwise from the verdict it writes in that case. */
function streetOnly(r: SpotResult) {
  const flags = r as SpotResult & { streetLevel?: boolean; match?: string; precision?: string };
  return flags.streetLevel === true || flags.match === "street" || flags.precision === "street" || /house number not found/i.test(r.verdict);
}

export function SpotCard({
  result,
  compact = false,
  onPickNeighborhood,
}: {
  result: SpotResult;
  compact?: boolean;
  onPickNeighborhood?: (id: string) => void;
}) {
  const ex = useExplore();
  const look = useLoveLook();
  const city = cityName(ex.state.city);
  const pct = Math.round(result.percentile);
  const nb = result.neighborhood;
  const drivers = result.drivers.filter((d) => d.share > 0.01);
  const c = result.counts;
  const street = streetOnly(result);
  const approx = result.walkIsApproximate ?? true;
  const grid = gridText(result.resolutionM);
  const nbScore = nb ? ex.hoods.data?.find((n) => n.id === nb.id)?.score : undefined;

  if (compact)
    return (
      <div className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line">
        <p className="truncate text-[12.5px] font-[560] text-ink-3">{result.label}{street ? ", street only" : ""}</p>
        <p className="mt-1 text-[14px] leading-snug text-ink-2">
          Better than <span className="tnum text-[22px] font-[680] tracking-[-0.02em] text-you">{pct}%</span> of {city} for your taste
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunk">
          <div className="h-full rounded-full bg-you" style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">{grid}</p>
        <p className="mt-1.5 text-[12.5px] text-ink-2">
          {nb ? `In ${nb.name}, #${nb.rank} for you. ` : ""}
          Among the places Qloo returned: {c.coffee} cafés, {c.food} places to eat and {c.drinks} bars that fit you within {approx ? "\u2248 " : ""}12 min walk.
        </p>
      </div>
    );

  const groups = (["coffee", "food", "drinks", "culture", "stay"] as Category[])
    .map((cat) => ({ cat, items: result.walk.filter((w) => w.place.category === cat).sort((a, b) => a.minutes - b.minutes) }))
    .filter((g) => g.items.length);

  return (
    <div>
      <p className="text-[14.5px] leading-snug text-ink-2">{result.verdict}</p>

      <section className="mt-4 rounded-[20px] bg-[color-mix(in_oklch,var(--you)_6%,var(--paper-raised))] p-4 ring-1 ring-[color-mix(in_oklch,var(--you)_24%,transparent)]">
        <p className="truncate text-[12.5px] font-[580] text-ink-3" data-testid="spot-label">{result.label}</p>
        {street && (
          <p data-testid="spot-street-only" className="mt-1.5 inline-flex rounded-[8px] bg-[color-mix(in_oklch,var(--warn)_16%,var(--paper-raised))] px-2 py-1 text-[12px] font-[580] leading-snug text-ink">
            Matched the street only: the house number was not found, so this is scored at a point on the street.
          </p>
        )}
        <p className="mt-1 text-[17px] font-[580] leading-[1.15] tracking-[-0.01em] text-ink-2" data-testid="spot-percentile">
          Better than{" "}
          <motion.span
            key={result.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
            className="tnum inline-block text-[52px] font-[700] leading-[1] tracking-[-0.04em] text-you"
          >
            {pct}%
          </motion.span>{" "}
          of {city} for your taste
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-snug text-ink-3">
          <span data-testid="spot-grid" className="rounded-[7px] bg-paper-raised px-2 py-0.5 font-[580] text-ink-2 ring-1 ring-line">
            {grid}
          </span>
          <span>Flats a few streets apart score alike; this describes the area, not the building.</span>
        </p>
        {nb && (
          <button
            onClick={() => onPickNeighborhood?.(nb.id)}
            disabled={!onPickNeighborhood}
            className="mt-3.5 flex w-full items-center justify-between gap-2 rounded-[12px] bg-paper-raised px-3 py-2 text-left ring-1 ring-line transition-[transform,box-shadow] enabled:hover:-translate-y-px enabled:hover:shadow-[var(--shadow-raised)]"
          >
            <span className="min-w-0 text-[14px] text-ink-2">
              In <b className="font-[620] text-ink">{nb.name}</b>, ranked <span className="tnum">#{nb.rank}</span> for you
              {nbScore !== undefined && (
                <>
                  {" \u00b7 "}
                  <MatchValue score={nbScore} size="sm" />
                </>
              )}
            </span>
            {onPickNeighborhood && <ArrowRight size={15} className="shrink-0 text-ink-3" />}
          </button>
        )}
      </section>

      {drivers.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-[15px] font-[620] tracking-[-0.01em]">What lifts this spot</h3>
          <ul className="space-y-2">
            {drivers.map((d, i) => {
              const l = look(d.love);
              return (
                <li key={d.love} className="flex items-center gap-2.5">
                  <LoveFace name={l.name} image={l.image} size={22} />
                  <span className="w-[112px] shrink-0 truncate text-[13.5px] font-[560]">{l.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-sunk">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: l.ink }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(3, d.share * 100)}%` }}
                      transition={{ duration: 0.6, delay: 0.05 * i, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                  </span>
                  <span className="tnum w-9 shrink-0 text-right text-[12.5px] text-ink-3">{Math.round(d.share * 100)}%</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-5">
        <h3 className="text-[15px] font-[620] tracking-[-0.01em]">Within {approx ? "\u2248 " : ""}12 min walk</h3>
        <p className="mb-2 mt-0.5 text-[12px] leading-snug text-ink-3">
          {approx ? "Walking times are approximate: straight-line distance, not a route. " : ""}Counts are the places Qloo returned that fit your taste, not every venue nearby.
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          <StatTile n={c.coffee} label="cafés" icon={Coffee} />
          <StatTile n={c.food} label="food" icon={UtensilsCrossed} />
          <StatTile n={c.drinks} label="bars" icon={Wine} />
          <StatTile n={c.culture} label="culture" icon={Landmark} />
          <StatTile n={c.openLate} label="open late" icon={MoonStar} />
        </div>
      </section>

      {groups.length > 0 && (
        <section className="mt-5 space-y-4">
          {groups.map((g) => {
            const Icon = CAT_ICON[g.cat];
            return (
              <div key={g.cat}>
                <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-[600] text-ink-2">
                  <Icon size={14} strokeWidth={1.9} /> {CAT_GROUP[g.cat]}
                </p>
                <ul className="space-y-1">
                  {g.items.map((w) => (
                    <li key={w.place.id}>
                      <a
                        href={w.place.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        onMouseEnter={() => ex.setActivePlace(w.place.id)}
                        onMouseLeave={() => ex.setActivePlace(null)}
                        className="flex items-center gap-3 rounded-[12px] px-2.5 py-2 transition-colors hover:bg-paper-sunk"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-[580] text-ink">{w.place.name}</span>
                          {w.place.why.length > 0 && <span className="block truncate text-[12px] text-ink-3">{w.place.why.slice(0, 3).join(", ")}</span>}
                        </span>
                        <span className="tnum flex shrink-0 items-center gap-1 text-[12.5px] font-[560] text-ink-2">
                          <Footprints size={13} className="text-ink-3" /> {walkText(w.minutes, approx)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
      {!result.walk.length && <p className="mt-4 text-[13.5px] text-ink-2">Qloo has no places near this spot that fit your taste.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- What decides

const OUT = 9;
type Without = DecidesResult["neighborhoods"][number]["without"][number];

function Slope({ from, to, delay = 0 }: { from: number; to: number | null; delay?: number }) {
  const W = 64;
  const H = 36;
  const y = (r: number) => 4 + ((Math.min(r, OUT) - 1) / (OUT - 1)) * (H - 8);
  const t = to ?? OUT;
  const color = to === null || t > from ? "var(--you)" : t < from ? "var(--them)" : "var(--ink-3)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <line x1={6} x2={6} y1={3} y2={H - 3} stroke="var(--line)" strokeWidth={1} />
      <line x1={W - 6} x2={W - 6} y1={3} y2={H - 3} stroke="var(--line)" strokeWidth={1} />
      <motion.line
        x1={6}
        y1={y(from)}
        x2={W - 6}
        y2={y(t)}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={to === null ? "3 3" : undefined}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, delay, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <circle cx={6} cy={y(from)} r={3} fill="var(--ink)" />
      <motion.circle cx={W - 6} cy={y(t)} r={3} fill={color} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: delay + 0.35 }} />
    </svg>
  );
}

function moveLabel(rank: number, w: Without) {
  if (w.rank === null) return { text: "Drops out of the top 8", tone: "drop" as const };
  if (w.rank > rank) return { text: `Falls to #${w.rank}`, tone: "drop" as const };
  if (w.rank < rank) return { text: `Rises to #${w.rank}`, tone: "rise" as const };
  return { text: `Stays #${rank}`, tone: "same" as const };
}

function LoveRows({ n, compact, baseDelay = 0 }: { n: DecidesResult["neighborhoods"][number]; compact?: boolean; baseDelay?: number }) {
  const look = useLoveLook();
  const rows = [...n.without].sort((a, b) => (b.rank ?? 99) - (a.rank ?? 99) || a.name.localeCompare(b.name));
  return (
    <ul className={compact ? "space-y-1" : "space-y-1.5"}>
      {rows.map((w, i) => {
        const l = look(w.query);
        const m = moveLabel(n.rank, w);
        const tone = m.tone === "drop" ? "text-you-deep" : m.tone === "rise" ? "text-[color-mix(in_oklch,var(--them)_80%,var(--ink))]" : "text-ink-3";
        return (
          <li key={w.query} aria-label={`Without ${w.name || l.name}: ${m.text.toLowerCase()}`} className={`flex items-center gap-2.5 rounded-[11px] ${compact ? "py-0.5" : "px-1.5 py-1"} ${m.tone === "drop" && !compact ? "bg-[color-mix(in_oklch,var(--you)_6%,transparent)]" : ""}`}>
            <LoveFace name={w.name || l.name} image={l.image} size={compact ? 20 : 24} />
            {/* each row is one love taken away on its own; the move sits under the name so neither is cut */}
            <span className={`min-w-0 flex-1 ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>
              <span className="block truncate font-[560]">
                <span className="font-[450] text-ink-3">Without </span>
                {w.name || l.name}
              </span>
              <span className={`tnum block text-[12px] font-[580] ${tone}`}>{m.text}</span>
            </span>
            <Slope from={n.rank} to={w.rank} delay={baseDelay + i * 0.05} />
          </li>
        );
      })}
    </ul>
  );
}

export function DecidesCard({ result, compact = false, onPick }: { result: DecidesResult; compact?: boolean; onPick?: (id: string) => void }) {
  const ex = useExplore();
  const scoreOf = (id: string) => ex.hoods.data?.find((h) => h.id === id)?.score;
  const st = decidesStatement(result);
  const hoods = compact ? result.neighborhoods.slice(0, 1) : result.neighborhoods;
  return (
    <div className={compact ? "rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line" : ""}>
      {(!compact || !st) && <p className={compact ? "text-[14px] leading-snug text-ink" : "text-[17px] font-[560] leading-snug tracking-[-0.01em] text-ink"}>{result.summary}</p>}
      {st && (
        <p
          className={`${compact ? "" : "mt-2"} flex items-start gap-2 rounded-[12px] px-3 py-2 leading-snug ${compact ? "text-[12.5px]" : "text-[13.5px]"} ${st.robust ? "bg-[color-mix(in_oklch,var(--ok)_10%,var(--paper-raised))] text-ink" : "bg-you-soft/70 text-ink"}`}
        >
          {st.robust ? <Check size={15} className="mt-0.5 shrink-0 text-ok" /> : <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-you" />}
          {st.text}
        </p>
      )}
      {hoods.length > 0 && hoods[0].without.length > 0 && (
        <div className={compact ? "mt-3" : "mt-5 space-y-3"}>
          {hoods.map((n, i) => (
            <motion.section
              key={n.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: i * 0.08 }}
              className={compact ? "" : `rounded-[18px] p-3.5 ring-1 ${i === 0 ? "bg-[color-mix(in_oklch,var(--you)_5%,var(--paper-raised))] ring-[color-mix(in_oklch,var(--you)_24%,transparent)]" : "bg-paper-raised ring-line"}`}
            >
              <button
                onClick={() => onPick?.(n.id)}
                disabled={!onPick}
                className={`mb-2 flex w-full items-center gap-2.5 text-left ${onPick ? "group" : ""}`}
              >
                <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${n.rank === 1 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{n.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-[630] tracking-[-0.015em] ${compact ? "text-[15px]" : "text-[17px]"} ${onPick ? "group-hover:underline" : ""}`}>{n.name}</span>
                  {!compact && scoreOf(n.id) !== undefined && <MatchValue score={scoreOf(n.id)} size="sm" />}
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">one love at a time</span>
              </button>
              <LoveRows n={n} compact={compact} baseDelay={0.15 + i * 0.1} />
            </motion.section>
          ))}
        </div>
      )}
    </div>
  );
}

function joinWords(list: string[]) {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
