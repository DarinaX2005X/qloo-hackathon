import { HomeRequest } from "@/shared/contracts";
import { findHome } from "@/server/engine/home";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { HomeRequestV2, HomeResponseV2 } from "@/shared/contracts-09";
import { homeV2 } from "@/server/engine/09/home-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([HomeRequestV2, HomeRequest]), async input => "stateRevision" in input ? HomeResponseV2.parse(await homeV2(input)) : findHome(input));
}
