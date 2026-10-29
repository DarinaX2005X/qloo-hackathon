import { Domain, apiError } from "@/shared/contracts";
import { searchEntities } from "@/server/qloo/search";
import { errorResponse } from "@/server/engine/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const rawDomain = params.get("domain");
    const domain = rawDomain === null ? undefined : Domain.safeParse(rawDomain);
    if (domain && !domain.success) throw apiError("bad_input", "Unknown entity domain.");
    return Response.json({ results: await searchEntities(params.get("q") ?? "", domain?.data) });
  } catch (error) { return errorResponse(error); }
}
