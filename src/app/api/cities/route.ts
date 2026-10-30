import { CitiesRequest } from "@/shared/contracts";
import { compareCities } from "@/server/engine/cities";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { CitiesRequestV2, CitiesResponseV2 } from "@/shared/contracts-09";
import { citiesV2 } from "@/server/engine/09/comparison";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([CitiesRequestV2, CitiesRequest]), async input => {
    if (!("stateRevision" in input)) return { cities: await compareCities(input.state, input.cities) };
    const result = CitiesResponseV2.parse(await citiesV2(input));
    return Response.json(result, { status: result.results.every(r => r.status === "error") ? 400 : 200 });
  });
}
