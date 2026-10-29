import { PlanRequest } from "@/shared/contracts";
import { solvePlan } from "@/server/engine/plan";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, PlanRequest, (state) => solvePlan(state, state.neighborhoodIds));
}
