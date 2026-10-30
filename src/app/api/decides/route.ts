import { ExploreState } from "@/shared/contracts";
import { whatDecides } from "@/server/engine/decides";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { DecidesRequestV2, DecidesResponseV2 } from "@/shared/contracts-09";
import { decidesV2 } from "@/server/engine/09/analysis-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([DecidesRequestV2, ExploreState]), async input => "stateRevision" in input ? DecidesResponseV2.parse(await decidesV2(input)) : whatDecides(input));
}
