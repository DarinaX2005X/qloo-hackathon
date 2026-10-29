import { ExploreState } from "@/shared/contracts";
import { rankNeighborhoods } from "@/server/engine/neighborhoods";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, ExploreState, async (state) => ({ neighborhoods: await rankNeighborhoods(state) }));
}
