"use client";

import { useMemo } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { VenueEvidence } from "./types";
import { useExplore } from "@/components/explore/store";
import { genreWord, joinAnd, ROLE_LABEL, sentence, venueStatusLines } from "@/lib/explain";

/** Love entity ID → the name the person typed or picked, for both people. */
export function useLoveNames(): Record<string, string> {
  const { state } = useExplore();
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const l of [...state.loves, ...(state.companion?.loves ?? [])]) if (l.chosen) out[l.chosen.id] = l.chosen.name;
    return out;
  }, [state.loves, state.companion]);
}

/** Which of the person's loves led to this place. Provider contributions are named as such; nothing is invented. */
export function connectionLine(v: VenueEvidence, loves: Record<string, string>): string | null {
  const named = v.connections.filter((c) => loves[c.loveId]);
  if (!named.length) return null;
  const names = [...new Set(named.map((c) => loves[c.loveId]))];
  const kind = named[0].explanationKind;
  if (kind === "provider") return `Qloo linked it to ${joinAnd(names)}`;
  if (kind === "local_weighted_rerank") return `Ranked up by your weights for ${joinAnd(names)}`;
  return `Shares tags with ${joinAnd(names)}`;
}

/** The kind of place first, then the name, then what is not known about it. */
export function VenueRow({ v, meta, actions }: { v: VenueEvidence; meta?: React.ReactNode; actions?: React.ReactNode }) {
  const loves = useLoveNames();
  const { setOpenPlace } = useExplore();
  // the backend's own limitation wins when it says the same thing (hours, events, price)
  const said = v.limitations.join(" ").toLowerCase();
  const lines = venueStatusLines(v).filter(
    (l) => !(/hours/i.test(l) && /hours/.test(said)) && !(/event/i.test(l) && /event/.test(said)) && !(/price/i.test(l) && /price/.test(said)) && !(/outside/i.test(l) && /outside/.test(said)),
  );
  const link = connectionLine(v, loves);
  const genre = genreWord(v.place.primaryGenre);
  const plain = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const kind = genre && plain(genre) !== plain(ROLE_LABEL[v.role]) ? `${ROLE_LABEL[v.role]}, ${genre}` : ROLE_LABEL[v.role];
  return (
    <div className="flex items-start gap-2.5 max-[520px]:flex-col max-[520px]:gap-0.5" data-testid="venue-row" data-place-id={v.place.id}>
      <div className="min-w-0 flex-1 max-[520px]:w-full">
        <p className="text-[11.5px] font-[600] uppercase tracking-[0.04em] text-ink-3">{kind}</p>
        <button onClick={() => setOpenPlace(v.place)} className="block max-w-full text-left">
          <span className="line-clamp-2 text-[15px] font-[600] leading-snug tracking-[-0.01em] text-ink hover:underline">{v.place.name}</span>
        </button>
        {meta}
        {link && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{link}</p>}
        {(lines.length > 0 || v.limitations.length > 0) && (
          <p className="mt-0.5 text-[12px] leading-snug text-[color-mix(in_oklch,var(--warn)_50%,var(--ink-2))]">{[...new Set([...lines, ...v.limitations])].map(sentence).join(" ")}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 max-[520px]:-ml-2">
        {actions}
        {v.place.website && (
          <a
            href={v.place.website}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${v.place.name} website`}
            title="The venue's own website"
            className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink"
          >
            <ExternalLink size={14} />
          </a>
        )}
        <a
          href={v.place.mapsUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${v.place.name} on a map`}
          title="Open in maps"
          className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink"
        >
          <MapPin size={14} />
        </a>
      </div>
    </div>
  );
}

/** Places the assistant found for an intent (dancing, coffee, …), each with what it is and why it is here. */
export function VenuesCard({ venues, compact }: { venues: readonly VenueEvidence[]; compact?: boolean }) {
  const shown = compact ? venues.slice(0, 4) : venues;
  if (!venues.length)
    return (
      <div className="rounded-[18px] bg-paper-raised p-3.5 text-[14px] leading-relaxed text-ink-2 ring-1 ring-line" data-testid="venues-card">
        No place passed every rule you set. The assistant says what it tried above.
      </div>
    );
  return (
    <div className="rounded-[18px] bg-paper-raised p-3.5 ring-1 ring-line" data-testid="venues-card">
      <p className="text-[12.5px] font-[560] text-ink-3">
        {venues.length} {venues.length === 1 ? "place" : "places"} that passed your rules
      </p>
      <ul className="mt-2 space-y-3">
        {shown.map((v) => (
          <li key={v.venueKey} className="border-t border-line pt-3 first:border-0 first:pt-0">
            <VenueRow v={v} meta={v.place.neighborhood ? <p className="text-[12.5px] text-ink-3">{v.place.neighborhood}</p> : null} />
          </li>
        ))}
      </ul>
      {venues.length > shown.length && <p className="mt-2 text-[12px] text-ink-3">and {venues.length - shown.length} more</p>}
    </div>
  );
}
