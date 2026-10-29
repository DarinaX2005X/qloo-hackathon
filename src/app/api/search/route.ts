import { Domain, apiError } from "@/shared/contracts";
import { searchEntities, searchTaste } from "@/server/qloo/search";
import { errorResponse } from "@/server/engine/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const rawDomain = params.get("domain");
    const domain = rawDomain === null ? undefined : Domain.safeParse(rawDomain);
    if (domain && !domain.success) throw apiError("bad_input", "Unknown entity domain.");
    return Response.json({ results: domain?.data ? await searchEntities(params.get("q") ?? "", domain.data) : await searchTaste(params.get("q") ?? "") });
  } catch (error) { return errorResponse(error); }
}
