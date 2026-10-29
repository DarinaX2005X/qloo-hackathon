import { PlacesRequest } from "@/shared/contracts";
import { findPlaces } from "@/server/engine/places";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, PlacesRequest, async (state) => ({ places: await findPlaces(state, state.neighborhoodId, state.categories) }));
}
