import { apiError } from "@/shared/contracts";
import { qlooGet, resultRows, unit } from "@/server/qloo/client";
import { coordinates, median } from "./geo";

/** Unsignalled insights are popularity-sorted by Qloo; this request caches by city. */
export async function cityCenter(city: string): Promise<[number, number]> {
  const response = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:place", "filter.location.query": city.trim(), take: 30,
  });
  const points = resultRows(response, "entities").sort((a, b) => unit(b.popularity) - unit(a.popularity))
    .map(coordinates).filter((point): point is [number, number] => point !== null).slice(0, 30);
  if (!points.length) throw apiError("not_found", `No city places found for ${city}. Try a more specific city name.`);
  return [median(points.map((point) => point[0])), median(points.map((point) => point[1]))];
}
