import { z } from "zod";
import { haversine } from "@/server/engine/geo";
import { apiError } from "@/shared/contracts";

export type Locality = { name: string; label: string; query: string; center: [number, number]; houseNumber?: string; street?: string; streetLevel?: boolean };
export const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
type Options = { bias?: [number, number]; localitiesOnly?: boolean };
const BY_REGION = new Set(["United States", "Canada", "Australia", "Brazil", "Mexico", "India"]);
const cache = new Map<string, { expires: number; value: Locality }>();
const reverseCache = new Map<string, { expires: number; value: string }>();
const cityCache = new Map<string, { expires: number; value: Locality }>();

const PhotonFeature = z.object({
  geometry: z.object({ coordinates: LonLat }),
  properties: z.object({ name: z.string().optional(), state: z.string().optional(), country: z.string().optional(),
    city: z.string().optional(), street: z.string().optional(), housenumber: z.string().optional(),
    osm_key: z.string().optional(), osm_value: z.string().optional() }),
});
const MeteoPlace = z.object({ name: z.string(), latitude: z.number(), longitude: z.number(),
  feature_code: z.string().optional(), country: z.string().optional(), admin1: z.string().optional() });

function locality(name: string | undefined, state: string | undefined, country: string | undefined, center: [number, number]): Locality | null {
  if (!name || !country || !LonLat.safeParse(center).success) return null;
  const area = BY_REGION.has(country) && state ? state : country;
  return { name, label: [state && state !== name ? state : "", country].filter(Boolean).join(", "), query: `${name}, ${area}`, center };
}

export async function photon(q: string, options: Options = { localitiesOnly: true }): Promise<Locality[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.search = new URLSearchParams({ q, limit: "10", lang: "en" }).toString();
  if (options.localitiesOnly) for (const type of ["city", "town", "village"]) url.searchParams.append("osm_tag", `place:${type}`);
  if (options.bias) { url.searchParams.set("lon", String(options.bias[0])); url.searchParams.set("lat", String(options.bias[1])); }
  const res = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { "user-agent": "Homing (hackathon demo)" } });
  if (!res.ok) return [];
  const body = z.object({ features: z.array(z.unknown()).default([]) }).parse(await res.json());
  return body.features.flatMap((raw) => {
    const parsed = PhotonFeature.safeParse(raw);
    if (!parsed.success) return [];
    const { properties: p, geometry } = parsed.data;
    if (options.localitiesOnly) return p.osm_key === "place" && ["city", "town", "village"].includes(p.osm_value ?? "")
      ? locality(p.name, p.state, p.country, geometry.coordinates) ?? [] : [];
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const name = street || p.name;
    if (!name) return [];
    const label = [...new Set([name, p.city].filter(Boolean))].join(", ");
    return { name: p.name ?? name, label, query: label, center: geometry.coordinates,
      ...(p.housenumber ? { houseNumber: p.housenumber } : {}), ...(p.street ? { street: p.street } : {}) };
  });
}

export async function meteo(q: string, options: Options = { localitiesOnly: true }): Promise<Locality[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: q, count: "10", language: "en", format: "json" }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) return [];
  const body = z.object({ results: z.array(z.unknown()).default([]) }).parse(await res.json());
  return body.results.flatMap((raw) => {
    const parsed = MeteoPlace.safeParse(raw);
    if (!parsed.success || (options.localitiesOnly && !/^(?:PPL|PPLA[1-5]?|PPLC|PPLG)$/.test(parsed.data.feature_code ?? ""))) return [];
    const p = parsed.data;
    const result = locality(p.name, p.admin1, p.country, [p.longitude, p.latitude]);
    return result ? { ...result, ...(options.localitiesOnly ? {} : { label: result.query }) } : [];
  });
}

export function clearGeocodeCache(): void { cache.clear(); reverseCache.clear(); cityCache.clear(); }

export async function validateCity(query: string): Promise<Locality> {
  const key = query.trim().toLowerCase();
  const name = query.split(",")[0].trim();
  if (name.length < 3 || name.replace(/[^\p{L}]/gu, "").length < 3) throw apiError("not_found", "Enter a city, town or village name with at least three characters.");
  const hit = cityCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [a, b] = await Promise.all([photon(query).catch(() => []), meteo(name).catch(() => [])]);
  const found = [...a, ...b].find(item => relevantGeocode(item, name));
  if (!found) throw apiError("not_found", `We couldn't find a city, town or village named ${query.trim()}. Check the spelling or pick it from the list.`);
  cityCache.set(key, { expires: Date.now() + 86400000, value: found });
  if (cityCache.size > 500) cityCache.delete(cityCache.keys().next().value!);
  return found;
}

export async function reverseGeocode(point: [number, number]): Promise<string | null> {
  if (!LonLat.safeParse(point).success) return null;
  const key = JSON.stringify(point);
  const hit = reverseCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const url = new URL("https://photon.komoot.io/reverse");
    url.search = new URLSearchParams({ lon: String(point[0]), lat: String(point[1]) }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(1500), headers: { "user-agent": "Homing (hackathon demo)" } });
    if (!res.ok) return null;
    const body = z.object({ features: z.array(z.unknown()).default([]) }).parse(await res.json());
    const nearby = body.features.flatMap((raw) => {
      const parsed = PhotonFeature.safeParse(raw);
      return parsed.success ? [{ properties: parsed.data.properties, distance: haversine(point, parsed.data.geometry.coordinates) }] : [];
    }).filter((item) => item.distance <= 1000).sort((a, b) => a.distance - b.distance);
    const address = nearby.find(({ properties }) => properties.street?.trim())?.properties;
    const label = address ? [address.street?.trim(), address.housenumber?.trim()].filter(Boolean).join(" ")
      : nearby.find(({ properties }) => properties.name?.trim())?.properties.name?.trim();
    if (!label) return null;
    reverseCache.set(key, { expires: Date.now() + 300000, value: label });
    if (reverseCache.size > 500) reverseCache.delete(reverseCache.keys().next().value!);
    return label;
  } catch { return null; }
}

function normalized(text: string): string { return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

export function relevantGeocode(result: Locality, query: string): boolean {
  const words = normalized(query.split(",")[0]).split(" ").filter((word) => !/^\d+[a-z]?$/.test(word));
  const text = normalized(`${result.name} ${result.label}`);
  return words.length > 0 && words.every((word) => text.includes(word));
}

/** Bias is not a boundary: reject far-away namesakes before trying the fallback. */
export async function geocode(query: string, bias: [number, number], radius: number): Promise<Locality | null> {
  const key = JSON.stringify([query.trim().toLowerCase(), bias, radius]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return structuredClone(hit.value);
  for (const provider of [photon, meteo]) {
    const results = await provider(query, { bias, localitiesOnly: false }).catch(() => []);
    const local = results.filter((item) => haversine(bias, item.center) <= radius && relevantGeocode(item, query));
    const address = query.split(",")[0].trim();
    const number = /(?:^|\s)(\d+[a-z]?)$/i.exec(address)?.[1] ?? /^(\d+[a-z]?)\s/i.exec(address)?.[1];
    const found = local.find((item) => number && item.houseNumber?.toLowerCase() === number.toLowerCase()) ?? local.find((item) => !number || !item.houseNumber);
    if (!found) continue;
    if (number && !found.houseNumber) { found.streetLevel = true; found.street ??= found.name; }
    cache.set(key, { expires: Date.now() + 300000, value: found });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return structuredClone(found);
  }
  return null;
}
