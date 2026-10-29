import { ExploreState } from "@/shared/contracts";
import { buildFingerprint } from "@/server/engine/fingerprint";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, ExploreState, buildFingerprint);
}
