import { Domain, apiError } from "@/shared/contracts";
import { entityResolution, searchEntities, searchTaste } from "@/server/qloo/search";
import { errorResponse } from "@/server/engine/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const rawDomain = params.get("domain");
    const domain = rawDomain === null ? undefined : Domain.safeParse(rawDomain);
    if (domain && !domain.success) throw apiError("bad_input", "Unknown entity domain.");
    const query = params.get("q") ?? "";
    const results = domain?.data || params.get("responseVersion") === "2" ? await searchEntities(query, domain?.data) : await searchTaste(query);
    return Response.json({ results, resolution: entityResolution(query, results) });
  } catch (error) { return errorResponse(error); }
}
