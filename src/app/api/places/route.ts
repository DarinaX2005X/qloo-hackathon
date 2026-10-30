import { PlacesRequest } from "@/shared/contracts";
import { findPlaces } from "@/server/engine/places";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { PlacesRequestV2, PlacesResponseV2 } from "@/shared/contracts-09";
import { placesV2 } from "@/server/engine/09/venues-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([PlacesRequestV2, PlacesRequest]), async input => "stateRevision" in input ? PlacesResponseV2.parse(await placesV2(input)) : { places: await findPlaces(input, input.neighborhoodId, input.categories) });
}
