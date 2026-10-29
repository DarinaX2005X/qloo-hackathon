import { CATEGORIES, type Category, type ExploreState, type Neighborhood, type Place, type TagRef, apiError } from "@/shared/contracts";
import { qlooGet, record, records, resultRows, string, number, unit, type QlooRecord } from "@/server/qloo/client";
import { buildFingerprint, matchedPlaceTags, tagName, usefulExplanation } from "./fingerprint";
import { coordinates, neighborhoodName, rankNeighborhoods } from "./neighborhoods";
import { haversine } from "./geo";
import { signals } from "./signals";

export const CATEGORY_TAGS: Record<Category, string[]> = {
  coffee: ["urn:tag:genre:place:restaurant:coffee_shop", "urn:tag:category:place:cafe"],
  food: ["urn:tag:category:place:restaurant"],
  drinks: ["urn:tag:genre:place:restaurant:bar"],
  culture: ["urn:tag:genre:place:book_store", "urn:tag:genre:place:museum", "urn:tag:genre:place:art_gallery", "urn:tag:genre:place:live_music_venue"],
  stay: ["urn:tag:genre:place:hotel"],
};
export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export function clockTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^T?([0-2]\d):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  if (!match || +match[1] > 24 || (+match[1] === 24 && +match[2] !== 0)) return undefined;
  return `${match[1]}:${match[2]}`;
}

export function openingHours(value: unknown): Place["hours"] {
  const hours: NonNullable<Place["hours"]> = {};
  for (const day of WEEKDAYS) {
    const raw = record(value)[day];
    if (!Array.isArray(raw)) continue;
    const spans = records(raw);
    const valid = spans.flatMap((span) => {
      if (span.closed === true) return [];
      const opens = clockTime(span.opens);
      const closes = clockTime(span.closes);
      return opens && closes ? [{ opens, closes }] : [];
    });
    if (valid.length || !raw.length || spans.some((span) => span.closed === true)) hours[day] = valid;
  }
  return Object.keys(hours).length ? hours : undefined;
}

export function placeFromRow(row: QlooRecord, category: Category, tags: TagRef[]): Place | null {
  const id = string(row.entity_id);
  const name = string(row.name);
  const point = coordinates(row);
  const properties = record(row.properties);
  if (!id || !name || !point || properties.is_closed === true) return null;
  const matched = matchedPlaceTags([row], tags, false).slice(0, 3);
  const used = new Set(matched.map(tagName));
  const keywords: string[] = [];
  for (const keyword of records(properties.keywords).sort((a, b) => number(b.count) - number(a.count))) {
    const name = string(keyword.name);
    if (!name || !usefulExplanation(name) || used.has(tagName(name))) continue;
    keywords.push(name);
    used.add(tagName(name));
    if (keywords.length === 2) break;
  }
  const address = string(properties.address);
  return { id, name, category, lon: point[0], lat: point[1], affinity: unit(record(row.query).affinity), popularity: unit(row.popularity),
    address, image: string(record(records(properties.images)[0]).url) ?? string(record(properties.image).url),
    hours: openingHours(properties.hours), priceLevel: typeof properties.price_level === "number" ? number(properties.price_level) : undefined,
    why: [...matched, ...keywords].slice(0, 4), description: string(properties.short_description),
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(", "))}`,
    neighborhood: neighborhoodName(row) };
}

/** Verify the returned category as Qloo can silently ignore unsupported filters. */
export function matchesCategory(row: QlooRecord, category: Category): boolean {
  const ids = records(row.tags).map((tag) => string(tag.tag_id) ?? string(tag.id) ?? "");
  const primary = string(record(record(row.properties).primary_genre).id);
  // A bar may carry a secondary coffee-shop tag; prefer actual cafes for morning coffee.
  if (category === "coffee" && primary && /(?:bar|pub)$/.test(primary)) return false;
  return CATEGORY_TAGS[category].some((wanted) => ids.some((id) => id === wanted || id.startsWith(`${wanted}:`))) ||
    (category === "coffee" && ids.includes("urn:tag:genre:place:restaurant:cafe"));
}

export async function placesNear(state: ExploreState, neighborhood: Neighborhood, categories: Category[], fingerprint?: TagRef[]): Promise<Place[]> {
  const tags = fingerprint ?? (await buildFingerprint(state)).you;
  const requested = [...new Set(categories)];
  if (requested.some((category) => !CATEGORIES.includes(category))) throw apiError("bad_input", "Unknown place category.");
  const batches = await Promise.all(requested.map(async (category) => {
    const results = await Promise.all(CATEGORY_TAGS[category].map(async (tag) => {
      const response = await qlooGet("/v2/insights", { "filter.type": "urn:entity:place",
        "filter.location": `POINT(${neighborhood.center[0]} ${neighborhood.center[1]})`, "filter.location.radius": 900,
        "filter.tags": tag, ...signals([...state.loves, ...(state.companion?.loves ?? [])], state.refinements), take: 8,
      });
      return resultRows(response, "entities");
    }));
    const found = new Map<string, Place>();
    for (const row of results.flat()) {
      if (!matchesCategory(row, category)) continue;
      const place = placeFromRow(row, category, [...tags, ...state.refinements]);
      if (place && haversine(neighborhood.center, [place.lon, place.lat]) <= 900 && !found.has(place.id)) found.set(place.id, place);
    }
    return [...found.values()].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id)).slice(0, 8);
  }));
  // Keep a category-specific candidate for multi-purpose venues; the planner deduplicates by entity id.
  return batches.flat();
}

export async function findPlaces(state: ExploreState, neighborhoodId: string, categories: Category[] = [...CATEGORIES]): Promise<Place[]> {
  const [neighborhoods, fingerprint] = await Promise.all([rankNeighborhoods(state), buildFingerprint(state)]);
  const neighborhood = neighborhoods.find((item) => item.id === neighborhoodId);
  if (!neighborhood) throw apiError("not_found", "Neighborhood not found in this taste map.");
  return placesNear(state, neighborhood, categories, [...fingerprint.you, ...(fingerprint.them ?? [])]);
}
