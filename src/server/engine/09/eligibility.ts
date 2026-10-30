import type { Place } from "@/shared/contracts";
import type { Constraint, PlaceIntentV2, PlaceV2, VenueEvidence, VenueRole } from "@/shared/contracts-09";
import { record, records, string, unit, type QlooRecord } from "@/server/qloo/client";
import { bestCategory, placeFromRow } from "../places";
import { normalized } from "./core";
import { haversine } from "../geo";

const ADULT = /\b(?:strip clubs?|striptease|gentle(?:men|man)(?:s| s)? clubs?|adult entertainment|adult clubs?|sex clubs?|erotic|erotico|erotica|alterne|brothel|bordell)\b/;
const RETAIL = /\b(?:supermarket|grocery|convenience store|gas station|petrol station|department store|hypermarket)\b/;
const HOTEL = /\b(?:hotel|lodging|motel|resort|hostel)\b/;
const BAR = /\b(?:bar|bars|pub|pubs|nightclub|night club|dance club|cocktail bar|wine bar|brewpub)\b/;
const MUSEUM = /\b(?:museum|museu|museo|musee|museums|art gallery|art galleries)\b/;
const COFFEE = /\b(?:coffee shop|cafe|cafeteria|coffee roastery|roastery)\b/;
const DANCE = /\b(?:nightclub|night club|dance club|discotheque|disco club|electronic music venue)\b/;
const CLUB = /\b(?:nightclub|night club|dance club|disco club|music club)\b/;
const LIVE = /\b(?:live music venue|concert hall|music club|jazz club|live music club)\b/;
const CULTURE = /\b(?:book store|bookstore|book shop|library|museum|art gallery|cinema|movie theater|performing arts theater|cultural center|live music venue|concert hall)\b/;
// Confirmed by /v2/tags in the live stage-09 regression. Nearby-attraction and
// menu tags are not classifications of this venue (e.g. "strip club wings").
export const ADULT_TYPE_IDS = new Set(["urn:tag:category:place:adult_entertainment_club", "urn:tag:genre:place:adult_entertainment_club"]);
function ownTypeTag(id: string): boolean { return /^urn:tag:(?:genre|category):place(?::|$)/.test(id); }
function classifierText(place: Place): string {
  return normalized([...(place.classifications ?? []), ...(place.tags ?? []).filter(t => ownTypeTag(t.id)).flatMap(t => [t.id, t.name])].join(" "));
}
export function rowPlace(row: QlooRecord): PlaceV2 | null {
  const category = bestCategory(row);
  if (!category) return null;
  const props = record(row.properties);
  const brand = records(row.references_brand ?? props.references_brand)[0] ?? record(row.references_brand ?? props.references_brand);
  const primary = props.primary_genre;
  const classifications = [row.type, ...(Array.isArray(row.types) ? row.types : []), props.type, props.place_type, primary, ...records(row.tags).filter(t => ownTypeTag(String(t.id ?? t.tag_id ?? "")))].flatMap(value => typeof value === "string" ? [value] : [string(record(value).id), string(record(value).name)].filter((s): s is string => !!s));
  const base = placeFromRow(row, category, [], classifications);
  if (!base) return null;
  const primaryText = normalized(typeof primary === "string" ? primary : String(record(primary).id ?? record(primary).name ?? ""));
  const warnings = records(props.keywords).some(k => /^(?:strip|striptease|alterne|hostess club|adult entertainment)$/i.test(String(k.name ?? ""))) && /night club|nightclub|bar/.test(primaryText) ? ["adult_entertainment_unverified"] : [];
  return { ...base, classifications: [...new Set(classifications)], classificationWarnings: warnings,
    brandId: string(brand.entity_id) ?? string(brand.id), brandName: string(brand.name),
    primaryGenre: typeof primary === "string" ? primary : string(record(primary).id) ?? string(record(primary).name),
    ...(typeof record(row.query).affinity_rank === "number" ? { affinityRank: unit(record(row.query).affinity_rank) } : {}),
  };
}
export function rolesForPlace(place: PlaceV2, applySuitabilityChecks = true): VenueRole[] {
  const text = classifierText(place);
  const primary = normalized(place.primaryGenre ?? "");
  if (ADULT.test(`${text} ${normalized(place.name)}`) || (place.classificationWarnings?.length ?? 0) > 0 || RETAIL.test(text) || HOTEL.test(`${text} ${applySuitabilityChecks ? normalized(place.name) : ""}`)) return [];
  if (/\b(?:clothing store|shoe store|furniture store|electronics store)\b/.test(primary)) return [];
  const roles: VenueRole[] = [];
  const namedBar = BAR.test(normalized(place.name));
  const primaryCulture = CULTURE.test(primary), primaryBar = BAR.test(primary);
  // A museum's cafe tag describes a secondary amenity, not a standalone coffee shop.
  const coffeePrimary = !primary || COFFEE.test(primary) || /\b(?:bakery|patisserie|pastry shop)\b/.test(primary);
  if (COFFEE.test(text) && coffeePrimary && !primaryCulture && !primaryBar && !BAR.test(text) && !namedBar) roles.push("coffee");
  if (/\brestaurant\b/.test(text) && !primaryCulture && !primaryBar && !/\b(?:ice cream shop|confectionery|chocolate shop)\b/.test(primary)) roles.push("food");
  // A dance floor or a general music-interest tag does not establish the venue's
  // primary purpose. With a primary type, require a club/electronic-music venue.
  // When that field is absent, an own genre/category must still establish it.
  if (DANCE.test(text) && (!primary || DANCE.test(primary)) && !/\bkaraoke\b/.test(`${primary} ${normalized(place.name)}`)) roles.push("dance");
  if (LIVE.test(text) && !/\b(?:conference|theater|theatre|museum|art gallery)\b/.test(primary)) roles.push("live_music");
  if (BAR.test(text) || namedBar) roles.push("bar");
  if (CULTURE.test(text) && (!applySuitabilityChecks || !primaryBar && (!primary || primaryCulture))) roles.push("culture");
  return roles;
}
export function intentRole(intent: PlaceIntentV2, place: PlaceV2, applySuitabilityChecks = true): VenueRole | null {
  const roles = rolesForPlace(place, applySuitabilityChecks);
  if (intent === "daily_life") return (["coffee", "food", "live_music", "dance", "bar", "culture"] as const).find(r => roles.includes(r)) ?? null;
  const role = intent === "concert" ? "live_music" : intent;
  return roles.includes(role) ? role : null;
}
export type Eligibility = { allowed: boolean; role: VenueRole | null; reasons: string[]; limitations: string[]; priceStatus: VenueEvidence["priceStatus"]; hoursStatus: VenueEvidence["hoursStatus"] };
export function isOpenAt(place: Place, weekday: string, minute: number): boolean | null {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const day = days.indexOf(weekday.toLowerCase());
  const spans = place.hours?.[weekday.toLowerCase()];
  const clock = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  const previous = day < 0 ? [] : place.hours?.[days[(day + 6) % 7]] ?? [];
  if (previous.some(span => clock(span.closes) < clock(span.opens) && minute < clock(span.closes))) return true;
  if (!spans) return null;
  return spans.some(span => { const a = clock(span.opens), b = clock(span.closes); return a === b ? true : b < a ? minute >= a : minute >= a && minute < b; });
}
/** One hard gate for map proofs, home signatures, venues, address, visits and recovery. */
export function venueEligibility(place: PlaceV2, intent: PlaceIntentV2, constraints: Constraint[] = [], options: { center?: [number, number]; radiusM?: number; excludeIds?: string[]; weekday?: string; minute?: number; stayMinutes?: number; deferHours?: boolean; requireKnownBudget?: boolean; geometryCatalog?: boolean } = {}): Eligibility {
  const text = classifierText(place), name = normalized(place.name);
  const metadata = constraints.some(c => ["dietary", "intent", "ambience"].includes(c.kind))
    ? normalized((place.tags ?? []).filter(t => !/nearby|neighborhood|neighbourhood/.test(t.id)).flatMap(t => [t.id, t.name]).join(" ")) : "";
  const reasons: string[] = [], limitations: string[] = [];
  const role = intentRole(intent, place, !options.geometryCatalog);
  if (!place.id || !Number.isFinite(place.lat) || !Number.isFinite(place.lon) || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) reasons.push("invalid_location");
  if (place.closed) reasons.push("closed");
  if (ADULT.test(`${text} ${name}`) || place.tags?.some(t => ADULT_TYPE_IDS.has(t.id))) reasons.push("adult_entertainment");
  if (place.classificationWarnings?.length) reasons.push("ambiguous_venue_type");
  if (RETAIL.test(text)) reasons.push("retail_venue");
  if (HOTEL.test(`${text} ${options.geometryCatalog ? "" : name}`)) reasons.push("hotel_venue");
  if (!role) reasons.push("wrong_role");
  if (options.center && options.radiusM !== undefined && haversine(options.center, [place.lon, place.lat]) > options.radiusM) reasons.push("outside_search_area");
  if (options.excludeIds?.includes(place.id)) reasons.push("excluded_place");
  let priceStatus: Eligibility["priceStatus"] = "not_requested";
  let hoursStatus: Eligibility["hoursStatus"] = role === "live_music" || role === "dance" ? "event_required" : "unknown";
  if (options.weekday !== undefined && options.minute !== undefined) {
    const open = isOpenAt(place, options.weekday, options.minute);
    if (open === false) { hoursStatus = "known_closed"; reasons.push("known_closed"); }
    else if (open === true && hoursStatus !== "event_required") hoursStatus = "known_open";
    if (open === true && options.stayMinutes && isOpenAt(place, options.weekday, Math.min(1439, options.minute + options.stayMinutes - 1)) === false) { hoursStatus = "known_closed"; reasons.push("closes_during_visit"); }
  }
  for (const constraint of constraints) {
    const value = normalized(String(constraint.value));
    let reason: string | undefined;
    if (constraint.kind === "exclude_place" && constraint.value === place.id) reason = "excluded_place";
    if (constraint.kind === "exclude_type") {
      const onsiteBar = (place.tags ?? []).some(t => /^(?:urn:tag:amenit(?:y|ies):(?:qloo|place):(?:bar|bar_onsite|full_bar|bar_service)|urn:tag:service_type:qloo:bar_service)$/.test(t.id));
      // Qualifiers set the scope: "adult clubs" must not exclude ordinary clubs,
      // and "hotel bars" must not exclude every bar. Apply this to direct API
      // constraints as well as model-extracted values.
      const excluded = /adult|strip/.test(value) ? ADULT.test(`${text} ${name}`)
        : /hotel|lodging/.test(value) ? HOTEL.test(`${text} ${name}`)
        : /\b(?:bar|bars|pub|pubs|nightlife)\b/.test(value) ? BAR.test(`${text} ${name}`) || onsiteBar
        : /\b(?:club|clubs)\b/.test(value) ? CLUB.test(`${text} ${name}`)
        : /museum|museu|gallery/.test(value) ? MUSEUM.test(`${text} ${name}`) : false;
      if (excluded) reason = "excluded_type";
      else if (value && text.split(" ").includes(value)) reason = "excluded_type";
    }
    if (constraint.kind === "budget") {
      const maximum = typeof constraint.value === "string" && /^\${1,4}$/.test(constraint.value) ? constraint.value.length : Number(constraint.value);
      priceStatus = place.priceLevel === undefined ? "unknown" : place.priceLevel > maximum ? "known_over" : "known_within";
      // Nearby discovery can show an unknown price with its limitation. A scheduled
      // stop must satisfy a hard budget using confirmed price metadata.
      if (priceStatus === "known_over") reason = "budget_exceeded";
      if (priceStatus === "unknown" && options.requireKnownBudget) reason = "budget_unverified";
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4) { reason = "invalid_budget"; priceStatus = "unknown"; }
    }
    if (constraint.kind === "dietary" && (role === "food" || role === "coffee")) {
      const requested = value.includes("vegan") ? /\bvegan\b/ : value.includes("vegetarian") ? /\bvegetarian\b|\bvegan\b/ : value.includes("gluten") ? /gluten free/ : null;
      if (!requested?.test(`${text} ${metadata}`)) reason = "dietary_unverified";
    }
    if (constraint.kind === "hours" && !options.deferHours && hoursStatus !== "known_open") reason = hoursStatus === "known_closed" ? "known_closed" : "hours_unverified";
    if (constraint.kind === "intent" && /wifi|wi fi|cafe work|work from cafe/.test(value) && role === "coffee" && !/\bwi fi\b|\bwifi\b/.test(metadata)) reason = "wifi_unverified";
    if (constraint.kind === "ambience" && value && !metadata.includes(value)) reason = "ambience_unverified";
    if (constraint.kind === "distance" && options.center && typeof constraint.value === "number" && haversine(options.center, [place.lon, place.lat]) > constraint.value) reason = "distance_exceeded";
    if (reason) { if (constraint.strength === "hard") reasons.push(reason); else limitations.push(`Preference could not be verified: ${String(constraint.value)}.`); }
  }
  if (hoursStatus === "unknown") limitations.push("Opening hours have not been checked.");
  if (hoursStatus === "event_required") limitations.push("Check the venue's event schedule and admission before visiting.");
  if (priceStatus === "unknown") limitations.push("Price level is unknown.");
  return { allowed: reasons.length === 0, role, reasons: [...new Set(reasons)], limitations: [...new Set(limitations)], priceStatus, hoursStatus };
}
export function venueKey(place: Place): string { return `${normalized(place.name)}:${place.lon.toFixed(4)}:${place.lat.toFixed(4)}`; }
const CHAINS = new Set(["starbucks", "costa coffee", "mcdonald s", "burger king", "a padaria portuguesa", "continente", "pingo doce", "pret a manger", "dunkin", "caffe nero"]);
export function brandKey(place: PlaceV2): string | undefined {
  if (place.brandId) return `brand:${place.brandId}`;
  if (place.brandName) return `brand-name:${normalized(place.brandName)}`;
  const name = normalized(place.name);
  const chain = [...CHAINS].find(c => name === c || name.startsWith(`${c} `));
  return chain ? `known-chain:${chain}` : undefined;
}
export function dedupePlaces<T extends PlaceV2>(places: T[], onePerBrand = false): T[] {
  const ids = new Set<string>(), locations = new Set<string>(), brands = new Set<string>();
  return places.filter(place => {
    const key = venueKey(place), brand = brandKey(place);
    if (ids.has(place.id) || locations.has(key) || (onePerBrand && brand && brands.has(brand))) return false;
    ids.add(place.id); locations.add(key); if (brand) brands.add(brand); return true;
  });
}
