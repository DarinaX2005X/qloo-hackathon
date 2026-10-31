import { PlanRequest, type Neighborhood } from "@/shared/contracts";
import { solvePlan } from "@/server/engine/plan";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { PlanRequestV2, PlanResponseV2 } from "@/shared/contracts-09";
import { planV2 } from "@/server/engine/09/visit-api";
import { cityManifest } from "@/server/engine/09/manifest";

/** The multi-day planner ranks with the legacy map; areas picked on the fixed v2 map are passed in by their centre. */
async function fixedAreas(city: string, ids: string[]): Promise<Neighborhood[]> {
  if (!ids.some(id => id.includes(":area:"))) return [];
  const { value } = await cityManifest(city);
  return value.areas.filter(area => ids.includes(area.identity.id)).map((area, i) => ({
    id: area.identity.id, name: area.identity.name, center: area.identity.center, score: 0, you: 0, rank: i + 1,
    drivers: [], matchedTags: [], vibe: "mixed", samplePlaces: [], cellIds: [],
  }));
}

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([PlanRequestV2, PlanRequest]), async input => "stateRevision" in input
    ? PlanResponseV2.parse(await planV2(input))
    : solvePlan(input, input.neighborhoodIds, { exclude: input.exclude, include: input.include, excludeCategories: input.excludeCategories, excludeTags: input.excludeTags },
      await fixedAreas(input.city, input.neighborhoodIds)));
}
