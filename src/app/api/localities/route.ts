import { apiError } from "@/shared/contracts";
import { errorResponse } from "@/server/engine/http";
import { photon, meteo, type Locality } from "@/server/geo/geocode";
export type { Locality } from "@/server/geo/geocode";
const cache = new Map<string, Locality[]>();

/**
 * City autocomplete for the whole world. `query` is the string the taste field is built for; Qloo
 * resolves "Portland, Oregon" and "Valencia, Spain" to the right place. Two open geocoders are asked
 * at once, so one being down or slow never leaves the list empty.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (q.length < 3) return Response.json({ results: [] });
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
