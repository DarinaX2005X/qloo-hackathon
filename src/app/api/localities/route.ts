import { apiError } from "@/shared/contracts";
import { errorResponse } from "@/server/engine/http";

export type Locality = { name: string; label: string; query: string; center: [number, number] };

// Where a city is better told apart by its state than by its country ("Portland, Oregon")
const BY_REGION = new Set(["United States", "Canada", "Australia", "Brazil", "Mexico", "India"]);
const cache = new Map<string, Locality[]>();

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; state?: string; country?: string; osm_value?: string };
};

type MeteoPlace = { name?: string; latitude: number; longitude: number; feature_code?: string; country?: string; admin1?: string; population?: number };

function locality(name: string | undefined, state: string | undefined, country: string | undefined, center: [number, number]): Locality | null {
  if (!name || !country) return null;
  const area = BY_REGION.has(country) && state ? state : country;
  return { name, label: [state && state !== name ? state : "", country].filter(Boolean).join(", "), query: `${name}, ${area}`, center };
}

/** OpenStreetMap through Photon: good at partial names, but it can be slow or refuse a cloud host. */
async function photon(q: string): Promise<Locality[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&osm_tag=place:city&osm_tag=place:town`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { "user-agent": "Homing (hackathon demo)" } });
  if (!res.ok) return [];
  const body = (await res.json()) as { features?: PhotonFeature[] };
  return (body.features ?? []).flatMap((f) => locality(f.properties.name, f.properties.state, f.properties.country, f.geometry.coordinates) ?? []);
}

/** GeoNames through Open-Meteo: populated places only, biggest first. */
async function meteo(q: string): Promise<Locality[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) return [];
  const body = (await res.json()) as { results?: MeteoPlace[] };
  return (body.results ?? []).filter((p) => p.feature_code?.startsWith("PPL"))
    .flatMap((p) => locality(p.name, p.admin1, p.country, [p.longitude, p.latitude]) ?? []);
}

/**
 * City autocomplete for the whole world. `query` is the string the taste field is built for; Qloo
 * resolves "Portland, Oregon" and "Valencia, Spain" to the right place. Two open geocoders are asked
 * at once, so one being down or slow never leaves the list empty.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return Response.json({ results: [] });
    if (q.length > 80) throw apiError("bad_input", "That city name is too long.");
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit) return Response.json({ results: hit });

    const [a, b] = await Promise.all([photon(q).catch(() => []), meteo(q).catch(() => [])]);
    const seen = new Set<string>();
    const results = [...a, ...b].filter((item) => !seen.has(item.query) && !!seen.add(item.query)).slice(0, 6);
    if (results.length) {
      if (cache.size > 500) cache.clear();
      cache.set(key, results);
    }
    return Response.json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
