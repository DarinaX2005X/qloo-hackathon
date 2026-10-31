"use client";

import { Coffee, Disc3, Footprints, Landmark, Music2, UtensilsCrossed, Wine } from "lucide-react";
import type { AreaIdentity, PlaceConnection, VenueEvidence, VenueRole } from "@/shared/contracts-09";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { LOVE_INKS } from "@/components/explore/inks";
import { walkText } from "@/lib/honest";

export const ROLE_LABEL: Record<VenueRole, string> = { coffee: "Café", food: "Food", bar: "Bar", dance: "Dance club", live_music: "Live music", culture: "Culture" };
export const ROLE_PLURAL: Record<VenueRole, string> = { coffee: "coffee", food: "food", bar: "bars", dance: "dancing", live_music: "live music", culture: "culture" };
export const ROLE_ICON: Record<VenueRole, typeof Coffee> = { coffee: Coffee, food: UtensilsCrossed, bar: Wine, dance: Disc3, live_music: Music2, culture: Landmark };
const PRICE = ["", "$", "$$", "$$$", "$$$$"];

/** "Around Anjos" when the area is a walkable circle around a centre, the plain name when it has a checked boundary. */
export function areaName(a: Pick<AreaIdentity, "name" | "geometryQuality">) {
  return a.geometryQuality === "approximate" ? `Around ${a.name}` : a.name;
}

/** "About 650 m around its centre" / "Mapped boundary": the size of what was actually measured. */
export function areaScale(a: Pick<AreaIdentity, "geometry" | "geometryQuality">) {
  if (a.geometry.kind === "circle") return `${a.geometry.radiusM >= 1000 ? `${Math.round(a.geometry.radiusM / 100) / 10} km` : `${Math.round(a.geometry.radiusM / 10) * 10} m`} around its centre`;
  return a.geometryQuality === "verified" ? "Within its mapped boundary" : "Within an approximate boundary";
}

/** "urn:tag:genre:place:restaurant:coffee_shop" -> "coffee shop"; plain words pass through. */
export function genreLabel(g?: string | null): string | null {
  if (!g) return null;
  const w = (g.includes(":") ? g.slice(g.lastIndexOf(":") + 1) : g).replace(/[_-]+/g, " ").trim().toLowerCase();
  return w || null;
}

/** One short fact about price, in the person's terms. Unknown stays unknown. */
export function priceText(v: VenueEvidence): string | null {
  const lvl = v.place.priceLevel ? PRICE[v.place.priceLevel] : null;
  switch (v.priceStatus) {
    case "known_within":
      return `${lvl ?? "Price"} within your budget`;
    case "known_over":
      return `${lvl ?? "Price"} over your budget`;
    case "unknown":
      return "Price not listed";
    default:
      return lvl;
  }
}

export function hoursText(v: VenueEvidence): string | null {
  switch (v.hoursStatus) {
    case "known_open":
      return "Hours listed";
    case "known_closed":
      return "Closed at that time";
    case "event_required":
      return "Needs an event; check its site";
    default:
      return "Hours not listed";
  }
}

/** Love name for an id, query or name the backend sends; null when it is not one of the person's loves. */
export function useLoveName() {
  const ex = useExplore();
  const loves = activeLoves(ex.state.loves);
  const partner = ex.state.companion ? activeLoves(ex.state.companion.loves) : [];
  return (id: string) => {
    const k = id.toLowerCase();
    const i = loves.findIndex((l) => l.chosen.id.toLowerCase() === k || l.query.toLowerCase() === k || l.chosen.name.toLowerCase() === k);
    if (i >= 0) return { name: loves[i].chosen.name, image: loves[i].chosen.image, ink: LOVE_INKS[i % LOVE_INKS.length], partner: false };
    const p = partner.find((l) => l.chosen.id.toLowerCase() === k || l.query.toLowerCase() === k);
    if (p) return { name: p.chosen.name, image: p.chosen.image, ink: "var(--them)", partner: true };
    return null;
  };
}

/** The strongest connection of a venue to one of the person's loves, in plain words. Null when there is none to state. */
export function connectionLine(c: PlaceConnection, love: string): string {
  if (c.explanationKind === "provider") {
    const pct = c.providerContribution !== undefined ? Math.round(c.providerContribution * 100) : null;
    // a share is only worth saying when more than one love took part
    return pct !== null && pct >= 5 && pct <= 95 ? `${love} carries about ${pct}% of Qloo's reason for this pick` : `Qloo picked it for ${love}`;
  }
  if (c.explanationKind === "local_weighted_rerank") return `Moved up by the weight you give ${love}`;
  return `Shares Qloo tags with ${love}`;
}

export function bestConnection(v: VenueEvidence, known: (id: string) => unknown): PlaceConnection | null {
  const order = { provider: 0, local_weighted_rerank: 1, shared_tags: 2 } as const;
  const cs = v.connections.filter((c) => !!known(c.loveId));
  cs.sort((a, b) => order[a.explanationKind] - order[b.explanationKind] || (b.providerContribution ?? 0) - (a.providerContribution ?? 0));
  return cs[0] ?? null;
}

/**
 * Whether one love clearly leads Qloo's reason for a place. The same rule as the area cards: a love is named only
 * when its share is above an equal share (1/n of the active loves) plus 0.1 and no other love ties it; otherwise
 * the place is "linked to all your loves" (every active love took part) or "to several". Raw shares stay in the data.
 */
export function placeLead(v: VenueEvidence, known: (id: string) => unknown, loveCount: number): "one" | "all" | "several" {
  const provider = v.connections.filter((c) => c.explanationKind === "provider" && c.providerContribution !== undefined && !!known(c.loveId));
  const loves = new Set(provider.map((c) => c.loveId.toLowerCase()));
  if (loveCount < 2 || loves.size < 2) return "one";
  const shares = [...provider].sort((a, b) => (b.providerContribution ?? 0) - (a.providerContribution ?? 0));
  const top = shares[0].providerContribution ?? 0;
  const next = shares.find((c) => c.loveId.toLowerCase() !== shares[0].loveId.toLowerCase())?.providerContribution ?? 0;
  if (top > 1 / loveCount + 0.1 && top - next > 0.005) return "one";
  return loves.size >= loveCount ? "all" : "several";
}

/**
 * A place as evidence: what kind of place it is first, then its name, then why it is here and what is
 * not known about it. Opens the place on the map when the parent passes onOpen.
 */
export function VenueRow({
  v,
  minutes,
  compact = false,
  tone = "you",
  note,
  onOpen,
}: {
  v: VenueEvidence;
  minutes?: number;
  compact?: boolean;
  /** "them" for a place from the old neighborhood */
  tone?: "you" | "them";
  /** replaces the connection line, e.g. "A place to try if you loved Ramiro" */
  note?: React.ReactNode;
  onOpen?: () => void;
}) {
  const ex = useExplore();
  const loveName = useLoveName();
  const Icon = ROLE_ICON[v.role];
  const c = note ? null : bestConnection(v, loveName);
  const love = c ? loveName(c.loveId) : null;
  const lead = c && c.explanationKind === "provider" ? placeLead(v, loveName, activeLoves(ex.state.loves).length) : "one";
  const genre = genreLabel(v.place.primaryGenre);
  const facts = [ROLE_LABEL[v.role], genre && genre !== ROLE_LABEL[v.role].toLowerCase() ? genre : null, priceText(v)].filter(Boolean) as string[];
  // unknown hours are said once, in plain words, instead of repeating the backend's note on every place
  const limits = v.limitations.filter((l) => !(v.hoursStatus === "unknown" && /hour/i.test(l)));
  const hours = v.hoursStatus === "unknown" ? null : hoursText(v);
  const body = (
    <>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${tone === "them" ? "bg-them-soft text-[color-mix(in_oklch,var(--them)_75%,var(--ink))]" : "bg-you-soft text-you-deep"}`}>
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-[560] uppercase tracking-[0.04em] text-ink-3">{facts.join(" · ")}</span>
        <span className={`block truncate font-[600] text-ink ${compact ? "text-[13.5px]" : "text-[14.5px]"}`}>{v.place.name}</span>
        {note ? (
          <span className="block text-[12.5px] leading-snug text-ink-2">{note}</span>
        ) : c && love && lead !== "one" ? (
          <span data-testid="venue-lead" className="flex items-center gap-1.5 text-[12.5px] leading-snug text-ink-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-ink-3" aria-hidden />
            <span className="min-w-0">{lead === "all" ? "Linked to all your loves" : "Linked to several of your loves"}</span>
          </span>
        ) : c && love ? (
          <span className="flex items-center gap-1.5 text-[12.5px] leading-snug text-ink-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: love.ink }} aria-hidden />
            <span className="min-w-0">{connectionLine(c, love.name)}</span>
          </span>
        ) : null}
        {!compact && !v.insideArea && <span className="block text-[12px] text-ink-3">Just outside the area</span>}
        {!compact && (hours || limits.length > 0) && <span className="block text-[12px] leading-snug text-ink-3">{[hours, limits[0]].filter(Boolean).join(". ")}</span>}
      </span>
      {minutes !== undefined && (
        <span className="tnum flex shrink-0 items-center gap-1 self-center text-[12.5px] font-[560] text-ink-2">
          <Footprints size={13} className="text-ink-3" /> {walkText(minutes, true)}
        </span>
      )}
    </>
  );
  const cls = `flex w-full items-start gap-2.5 rounded-[12px] text-left ${compact ? "py-1" : "px-2 py-2"}`;
  if (!onOpen && !v.place.mapsUrl) return <div className={cls}>{body}</div>;
  return onOpen ? (
    <button
      onClick={onOpen}
      onMouseEnter={() => ex.setActivePlace(v.place.id)}
      onMouseLeave={() => ex.setActivePlace(null)}
      className={`${cls} transition-colors hover:bg-paper-sunk`}
    >
      {body}
    </button>
  ) : (
    <a
      href={v.place.mapsUrl}
      target="_blank"
      rel="noreferrer"
      onMouseEnter={() => ex.setActivePlace(v.place.id)}
      onMouseLeave={() => ex.setActivePlace(null)}
      className={`${cls} transition-colors hover:bg-paper-sunk`}
    >
      {body}
    </a>
  );
}

/** A quiet chip for a place from the old neighborhood. */
export function SourcePlaceChip({ v }: { v: VenueEvidence }) {
  const Icon = ROLE_ICON[v.role];
  return (
    <span title={v.place.name} className="inline-flex h-7 max-w-[200px] items-center gap-1.5 rounded-[9px] bg-paper-raised px-2 text-[12.5px] font-[540] text-ink ring-1 ring-[color-mix(in_oklch,var(--them)_30%,var(--line))]">
      <Icon size={13} strokeWidth={1.9} className="shrink-0 text-[color-mix(in_oklch,var(--them)_75%,var(--ink))]" />
      <span className="truncate">{v.place.name}</span>
    </span>
  );
}
