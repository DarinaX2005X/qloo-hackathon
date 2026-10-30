import { SpotRequest } from "@/shared/contracts";
import { checkSpot } from "@/server/engine/spot";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { SpotRequestV2, SpotResponseV2 } from "@/shared/contracts-09";
import { spotV2 } from "@/server/engine/09/address-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([SpotRequestV2, SpotRequest]), async input => "stateRevision" in input ? SpotResponseV2.parse(await spotV2(input)) : checkSpot(input));
}
