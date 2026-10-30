import { activeLoves, type ExploreState } from "@/shared/contracts";
import type { AreaIdentity, PlaceV2, VenueEvidence } from "@/shared/contracts-09";
import { haversine, median } from "../geo";
import { normalized } from "./core";
import { dedupePlaces, venueKey } from "./eligibility";
import { pointInArea } from "./geometry";
import { placeStyleFeatures } from "./signatures";

/** A place belongs to the nearest containing circle, independent of rank/profile. */
export function anchorOwner(place: Pick<PlaceV2, "lon" | "lat">, areas: AreaIdentity[]): string | null {
  const point: [number, number] = [place.lon, place.lat];
  return areas.filter(area => pointInArea(point, area))
    .sort((a, b) => haversine(point, a.center) - haversine(point, b.center) || a.id.localeCompare(b.id))[0]?.id ?? null;
}

/** Pool first: the owner may differ from the circle whose query found the place. */
export function assignAreaVenues(areas: AreaIdentity[], venues: VenueEvidence[]): Map<string, VenueEvidence[]> {
  const assigned = new Map(areas.map(area => [area.id, [] as VenueEvidence[]]));
  const sorted = [...venues].sort((a, b) => b.connections.length - a.connections.length || a.place.id.localeCompare(b.place.id) || a.evidenceIds.join().localeCompare(b.evidenceIds.join()));
  const ids = new Set<string>(), locations = new Set<string>();
  for (const venue of sorted) {
    if (venue.eligibility !== "eligible") continue;
    const id = venue.place.id.toUpperCase(), location = venueKey(venue.place);
    if (ids.has(id) || locations.has(location)) continue;
    const owner = anchorOwner(venue.place, areas);
    if (!owner) continue;
    ids.add(id); locations.add(location);
    assigned.get(owner)!.push({ ...venue, insideArea: true });
  }
  return assigned;
}

export function pickAnchors(venues: VenueEvidence[], max = 3): VenueEvidence[] {
  const sorted = [...venues].sort((a, b) => Number(b.connections.length > 0) - Number(a.connections.length > 0) || b.place.affinity - a.place.affinity || a.place.id.localeCompare(b.place.id));
  const unique = new Set(dedupePlaces(sorted.map(v => v.place), true).map(p => p.id));
  const pool = sorted.filter(v => unique.has(v.place.id));
  const picked: VenueEvidence[] = [], roles = new Set<string>();
  for (const venue of pool) if (!roles.has(venue.role)) { picked.push(venue); roles.add(venue.role); if (picked.length === max) return picked; }
  for (const venue of pool) if (!picked.some(v => v.place.id === venue.place.id)) { picked.push(venue); if (picked.length === max) break; }
  return picked;
}

export function leadingConnection(anchors: VenueEvidence[], state: ExploreState) {
  const loves = new Map(activeLoves([...state.loves, ...(state.companion?.loves ?? [])]).map(love => [love.chosen.id.toUpperCase(), love.chosen.name]));
  const totals = new Map<string, { name: string; total: number; strongest: number; venue: VenueEvidence }>();
  for (const venue of anchors) {
    const seen = new Set<string>();
    for (const connection of venue.connections) {
      const id = connection.loveId.toUpperCase(), contribution = connection.providerContribution;
      if (!loves.has(id) || seen.has(id) || connection.placeId !== venue.place.id || connection.explanationKind !== "provider" || !connection.evidenceIds.length || contribution === undefined || !Number.isFinite(contribution) || contribution <= 0 || contribution > 1) continue;
      seen.add(id);
      const value = totals.get(id) ?? { name: loves.get(id)!, total: 0, strongest: -1, venue };
      value.total += contribution;
      if (contribution > value.strongest || contribution === value.strongest && venue.place.id < value.venue.place.id) { value.strongest = contribution; value.venue = venue; }
      totals.set(id, value);
    }
  }
  const ordered = [...totals].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  return ordered[0] ? { ...ordered[0][1], tied: !!ordered[1] && Math.abs(ordered[0][1].total - ordered[1][1].total) < 1e-9 } : null;
}

/** Describes tags on the shown places, never a neighborhood's people or housing. */
const styleSamples = new WeakMap<PlaceV2[], { total: number; counts: Map<string, number> }>();
export function distinctiveStyle(anchors: VenueEvidence[], citySample: PlaceV2[]) {
  const tags = (place: PlaceV2) => [...new Map(placeStyleFeatures(place).map(tag => [normalized(tag.name), tag])).values()];
  let sample = styleSamples.get(citySample);
  if (!sample) {
    const city = dedupePlaces(citySample), counts = new Map<string, number>();
    for (const place of city) for (const tag of tags(place)) { const key = normalized(tag.name); counts.set(key, (counts.get(key) ?? 0) + 1); }
    sample = { total: city.length, counts }; styleSamples.set(citySample, sample);
  }
  if (!sample.total || !anchors.length) return null;
  const candidates = new Map<string, { label: string; count: number; cityCount: number }>();
  for (const venue of anchors) for (const tag of tags(venue.place)) {
    const key = normalized(tag.name);
    const row = candidates.get(key) ?? { label: tag.name, count: 0, cityCount: sample.counts.get(key) ?? 0 };
    row.count++; candidates.set(key, row);
  }
  const supported = [...candidates.values()].filter(tag => tag.count / anchors.length > tag.cityCount / sample.total);
  const repeated = supported.filter(tag => tag.count >= 2);
  return (repeated.length ? repeated : supported)
    .sort((a, b) => (b.count / anchors.length - b.cityCount / sample.total) - (a.count / anchors.length - a.cityCount / sample.total) || b.count - a.count || a.label.localeCompare(b.label))
    .map(tag => ({ ...tag, cityTotal: sample.total }))[0] ?? null;
}

type CardContext = { area: AreaIdentity; anchors: VenueEvidence[]; ownedVenues?: VenueEvidence[]; citySample: PlaceV2[]; neutralByArea: Map<string, VenueEvidence[]>; state?: ExploreState };
export function areaCardCopy({ area, anchors, ownedVenues = anchors, citySample, neutralByArea, state }: CardContext): { headline: string; tradeoff: string } {
  if (!anchors.length) return { headline: `No eligible places were verified for ${area.name}'s own circle.`, tradeoff: "Check local places before choosing this area; overlapping areas' places are listed only once." };
  const link = state ? leadingConnection(anchors, state) : null;
  const style = distinctiveStyle(anchors, citySample);
  const reason = link ? link.tied ? `${link.name} is a joint leading Qloo link.` : `${link.name} is the leading Qloo link.` : "";
  const headline = style ? `${reason ? `${reason} ` : ""}${style.count} of ${anchors.length} places are tagged “${style.label}”, compared with ${style.cityCount} of ${style.cityTotal} in the city sample.`
    : link ? `Qloo links ${link.name} to ${link.venue.place.name}.` : `${anchors[0].place.name} is one place to start in ${area.name}.`;

  // Compare the same neutral sample/ownership rule across areas. Personal search
  // counts and missing metadata cannot establish real-world venue scarcity.
  const local = neutralByArea.get(area.id) ?? [];
  const sampled = [...neutralByArea.values()].filter(pool => pool.length);
  const deficits = (["coffee", "culture"] as const).flatMap(role => {
    const count = local.filter(v => v.role === role).length;
    const typical = median(sampled.map(pool => pool.filter(v => v.role === role).length));
    // A personalized/supplementary search may have filled a neutral-sample gap.
    // Do not claim a deficit when the rest of this same card disproves it.
    const observed = ownedVenues.filter(v => v.role === role).length;
    return local.length && observed <= count && typical >= 1 && count < typical ? [{ role, count, typical, gap: (typical - count) / typical }] : [];
  }).sort((a, b) => b.gap - a.gap || a.role.localeCompare(b.role));
  const deficit = deficits[0];
  if (deficit) return { headline, tradeoff: `The checked catalog has ${deficit.count} ${deficit.role === "coffee" ? (deficit.count === 1 ? "café" : "cafés") : (deficit.count === 1 ? "culture stop" : "culture stops")} assigned here; the area median is ${deficit.typical}.` };
  const event = anchors.find(v => v.hoursStatus === "event_required");
  if (event) return { headline, tradeoff: `Check ${event.place.name}'s event schedule and admission before visiting.` };
  const missingHours = anchors.filter(v => !v.place.hours || !Object.values(v.place.hours).some(spans => spans.length));
  if (missingHours.length) return { headline, tradeoff: `Hours are unlisted for ${missingHours[0].place.name}${missingHours.length > 1 ? ` and ${missingHours.length - 1} other ${missingHours.length === 2 ? "place" : "places"}` : ""}.` };
  const missingPrices = anchors.filter(v => v.place.priceLevel === undefined);
  if (missingPrices.length) return { headline, tradeoff: `Prices are unknown for ${missingPrices[0].place.name}${missingPrices.length > 1 ? ` and ${missingPrices.length - 1} other ${missingPrices.length === 2 ? "place" : "places"}` : ""}.` };
  return { headline, tradeoff: `Confirm ${anchors[0].place.name}'s hours for your visit date.` };
}
