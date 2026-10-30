import { apiError } from "@/shared/contracts";
import { errorResponse } from "@/server/engine/http";
import { photon, meteo, rankedLocalities, type Locality } from "@/server/geo/geocode";
import { localityId } from "@/server/engine/09/manifest";
export type { Locality } from "@/server/geo/geocode";
const cache = new Map<string, Locality[]>();
function withIdentity(results: Locality[]) {
  return results.map(item => { const country = item.label.split(",").at(-1)?.trim() ?? item.label;
    return { ...item, cityId: localityId(item.name, country, item.center), country, source: "geocoder" }; });
}

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
    if (hit) return Response.json({ results: withIdentity(hit) });

    const [a, b] = await Promise.all([photon(q).catch(() => []), meteo(q).catch(() => [])]);
    const seen = new Set<string>();
    const results = rankedLocalities([...a, ...b], q).filter((item) => !seen.has(item.query) && !!seen.add(item.query)).slice(0, 6);
    if (results.length) {
      if (cache.size > 500) cache.clear();
      cache.set(key, results);
    }
    return Response.json({ results: withIdentity(results) });
  } catch (error) {
    return errorResponse(error);
  }
}
