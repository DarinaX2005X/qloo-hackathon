import { ExploreState } from "@/shared/contracts";
import { buildField } from "@/server/engine/field";
import { jsonRoute } from "@/server/engine/http";
import { z } from "zod";
import { AnalysisRequestV2, FieldResponseV2 } from "@/shared/contracts-09";
import { fieldV2 } from "@/server/engine/09/analysis-api";

export async function POST(request: Request): Promise<Response> {
  return jsonRoute(request, z.union([AnalysisRequestV2, ExploreState]), async input => "stateRevision" in input ? FieldResponseV2.parse(await fieldV2(input)) : buildField(input));
}
