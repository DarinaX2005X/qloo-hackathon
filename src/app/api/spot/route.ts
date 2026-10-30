import { SpotRequest } from "@/shared/contracts";
import { checkSpot } from "@/server/engine/spot";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, SpotRequest, checkSpot);
}
