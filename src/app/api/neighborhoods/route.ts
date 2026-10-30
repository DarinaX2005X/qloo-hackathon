import { ExploreState } from "@/shared/contracts";
import { rankNeighborhoods } from "@/server/engine/neighborhoods";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { AnalysisRequestV2, NeighborhoodsResponseV2 } from "@/shared/contracts-09";
import { neighborhoodsV2 } from "@/server/engine/09/analysis-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([AnalysisRequestV2, ExploreState]), async input => "stateRevision" in input ? NeighborhoodsResponseV2.parse(await neighborhoodsV2(input)) : { neighborhoods: await rankNeighborhoods(input) });
}
