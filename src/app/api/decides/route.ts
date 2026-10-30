import { ExploreState } from "@/shared/contracts";
import { whatDecides } from "@/server/engine/decides";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, ExploreState, whatDecides);
}
