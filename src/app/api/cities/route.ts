import { CitiesRequest } from "@/shared/contracts";
import { compareCities } from "@/server/engine/cities";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, CitiesRequest, async ({ state, cities }) => ({ cities: await compareCities(state, cities) }));
}
