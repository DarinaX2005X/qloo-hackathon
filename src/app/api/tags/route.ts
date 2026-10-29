import { searchPlaceTags } from "@/server/qloo/search";
import { errorResponse } from "@/server/engine/http";

export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json({ results: await searchPlaceTags(new URL(request.url).searchParams.get("q") ?? "") });
  } catch (error) { return errorResponse(error); }
}
