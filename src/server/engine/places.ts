import { CATEGORIES, type Category, type ExploreState, type Neighborhood, type Place, type TagRef, apiError } from "@/shared/contracts";
import { qlooGet, record, records, resultRows, string, number, unit, type QlooRecord } from "@/server/qloo/client";
import { buildFingerprint, matchedPlaceTags, tagName, usefulExplanation } from "./fingerprint";
import { coordinates, neighborhoodName, rankNeighborhoods } from "./neighborhoods";
import { haversine } from "./geo";
import { signals } from "./signals";

// Review keywords that say nothing about the place itself ("price", "pay", "tourist", "the view")
const NOISE = /^(?:price|prices|pay|paid|payment|tourist|tourists|meal|meals|tables?|vision|the view|view|place|spot|location|staff|service|people|time|money|value|cash|card|line|queue|wait|walk|building|living room|room|stuff|thing|things|area|street|food|drinks?|menu|portion|portions|bill|tip)$/i;

export const CATEGORY_TAGS: Record<Category, string[]> = {
  coffee: ["urn:tag:genre:place:restaurant:coffee_shop", "urn:tag:category:place:cafe", "urn:tag:genre:place:restaurant:bakery"],
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
  const used = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of records(properties.keywords).sort((a, b) => number(b.count) - number(a.count))) {
    const name = string(keyword.name);
    if (!name || !usefulExplanation(name) || NOISE.test(name) || number(keyword.count) < 3 || used.has(tagName(name))) continue;
    keywords.push(name);
    used.add(tagName(name));
    if (keywords.length === 5) break;
  }
  const address = string(properties.address);
  return { id, name: displayName(name), category, lon: point[0], lat: point[1], affinity: unit(record(row.query).affinity), popularity: unit(row.popularity),
    address, image: string(record(records(properties.images)[0]).url) ?? string(record(properties.image).url),
    hours: openingHours(properties.hours), priceLevel: typeof properties.price_level === "number" ? number(properties.price_level) : undefined,
    why: matched.length ? [...matched, ...keywords.filter((keyword) => !matched.some((tag) => tagName(tag) === tagName(keyword))).slice(0, 2)].slice(0, 4) : [],
    keywords, website: safeWebsite(properties.website),
    description: string(properties.short_description) ?? (string(properties.description) ?? string(row.description))?.slice(0, 160),
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(", "))}`,
    neighborhood: neighborhoodName(row) };
}

/** "SALA DE ARTE PÚBLICO SIQUEIROS" reads as "Sala De Arte Público Siqueiros"; mixed case is left alone. */
export function displayName(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (letters.length < 5 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-/(&'.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function safeWebsite(value: unknown): string | undefined {
  const text = string(value);
  if (!text) return undefined;
  try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export function withinBudget(place: Place, budget?: number | null): boolean {
  return budget == null || place.priceLevel === undefined || place.priceLevel <= budget;
}

export function comparePlaces(a: Place, b: Place): number {
  return b.affinity - a.affinity || Number(a.priceLevel === undefined) - Number(b.priceLevel === undefined) || a.id.localeCompare(b.id);
}

export function categoryStrength(row: QlooRecord, category: Category): number {
  const aliases: Record<Category, string[]> = {
    coffee: [...CATEGORY_TAGS.coffee, "urn:tag:genre:place:restaurant:cafe", "urn:tag:genre:place:restaurant:coffee_roastery"],
    food: [...CATEGORY_TAGS.food, "urn:tag:genre:place:restaurant"],
    drinks: [...CATEGORY_TAGS.drinks, "urn:tag:genre:place:restaurant:wine_bar", "urn:tag:genre:place:restaurant:cocktail_bar", "urn:tag:genre:place:pub"],
    culture: [...CATEGORY_TAGS.culture, "urn:tag:genre:place:art_museum", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:performing_arts_theater", "urn:tag:genre:place:cultural_center", "urn:tag:genre:place:tourist_attraction", "urn:tag:genre:place:historical_landmark", "urn:tag:genre:place:library"],
    stay: CATEGORY_TAGS.stay,
  };
  let best = 0;
  for (const tag of [...records(row.tags), { ...record(record(row.properties).primary_genre), primary: true }]) {
    const id = string(tag.id) ?? string(tag.tag_id) ?? "";
    for (const allowed of aliases[category]) if (id === allowed || id.startsWith(`${allowed}:`))
      best = Math.max(best, (tag.primary ? 100 : 0) + allowed.split(":").length + unit(tag.weight));
  }
  return best;
}

/** A primary genre outranks secondary tags; specificity breaks overlaps such as restaurant/bar. */
export function bestCategory(row: QlooRecord): Category | null {
  const ranked = CATEGORIES.map((category) => ({ category, strength: categoryStrength(row, category) }))
    .sort((a, b) => b.strength - a.strength || CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  return ranked[0].strength > 0 ? ranked[0].category : null;
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
        "filter.tags": tag, ...signals([...state.loves, ...(state.companion?.loves ?? [])], state.refinements), take: 10,
      });
      return resultRows(response, "entities");
    }));
    return results.flat().filter((row) => matchesCategory(row, category));
  }));
  const rows = new Map<string, QlooRecord>();
  for (const row of batches.flat()) {
    const id = string(row.entity_id);
    if (id && !rows.has(id)) rows.set(id, row);
  }
  const found = [...rows.values()].flatMap((row) => {
    const category = bestCategory(row);
    if (!category || !requested.includes(category)) return [];
    const place = placeFromRow(row, category, [...tags, ...state.refinements]);
    return place && withinBudget(place, state.budget) && haversine(neighborhood.center, [place.lon, place.lat]) <= 900 ? [place] : [];
  });
  return requested.flatMap((category) => found.filter((place) => place.category === category).sort(comparePlaces).slice(0, 10));
}

export async function findPlaces(state: ExploreState, neighborhoodId: string, categories: Category[] = [...CATEGORIES]): Promise<Place[]> {
  const [neighborhoods, fingerprint] = await Promise.all([rankNeighborhoods(state), buildFingerprint(state)]);
  const neighborhood = neighborhoods.find((item) => item.id === neighborhoodId);
  if (!neighborhood) throw apiError("not_found", "Neighborhood not found in this taste map.");
  return placesNear(state, neighborhood, categories, [...fingerprint.you, ...(fingerprint.them ?? [])]);
}
