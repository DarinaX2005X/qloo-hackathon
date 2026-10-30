import { PlanRequest } from "@/shared/contracts";
import { solvePlan } from "@/server/engine/plan";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { PlanRequestV2, PlanResponseV2 } from "@/shared/contracts-09";
import { planV2 } from "@/server/engine/09/visit-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([PlanRequestV2, PlanRequest]), async input => "stateRevision" in input ? PlanResponseV2.parse(await planV2(input)) : solvePlan(input, input.neighborhoodIds, { exclude: input.exclude, include: input.include, excludeCategories: input.excludeCategories, excludeTags: input.excludeTags }));
}
