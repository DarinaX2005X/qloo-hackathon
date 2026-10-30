import { ApiError, apiError } from "@/shared/contracts";
import { qlooGet, resultRows, unit } from "@/server/qloo/client";
import { coordinates, median } from "./geo";

/** Unsignalled insights are popularity-sorted by Qloo; this request caches by city. */
export async function cityCenter(city: string): Promise<[number, number]> {
  if (city.split(",")[0].trim().length < 3) throw apiError("not_found", "Enter a city name with at least three characters.");
  const response = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:place", "filter.location.query": city.trim(), take: 30,
  }).catch((error: unknown) => {
    // Qloo answers a name it can't place with a client error; that is the person's typo, not an outage.
    const parsed = ApiError.safeParse(error);
    if (parsed.success && parsed.data.error.code === "qloo_unavailable" && !parsed.data.error.retryable)
      throw apiError("not_found", `We couldn't find ${city.trim()}. Check the spelling or pick it from the list.`);
    throw error;
  });
  const points = resultRows(response, "entities").sort((a, b) => unit(b.popularity) - unit(a.popularity))
    .map(coordinates).filter((point): point is [number, number] => point !== null).slice(0, 30);
  if (!points.length) throw apiError("not_found", `No city places found for ${city}. Try a more specific city name.`);
  return [median(points.map((point) => point[0])), median(points.map((point) => point[1]))];
}
