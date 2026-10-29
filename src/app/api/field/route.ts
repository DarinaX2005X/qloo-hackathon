import { ExploreState } from "@/shared/contracts";
import { buildField } from "@/server/engine/field";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, ExploreState, buildField);
}
