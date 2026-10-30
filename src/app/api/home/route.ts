import { HomeRequest } from "@/shared/contracts";
import { findHome } from "@/server/engine/home";
import { jsonRoute } from "@/server/engine/http";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, HomeRequest, findHome);
}
