import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/shared/contracts";
import { CitiesRequestV2 } from "@/shared/contracts-09";
import { FICTIONAL_COMPLETE_09 as fixture } from "@/shared/fixtures-09";
import { citiesV2 } from "@/server/engine/09/comparison";
import { analyzeAreas } from "@/server/engine/09/ranking";
import { cityManifest } from "@/server/engine/09/manifest";
import { signatureReference } from "@/server/engine/09/signatures";
import { claimsForCard } from "@/server/agent/09/audit";
vi.mock("@/server/engine/09/ranking", () => ({ analyzeAreas: vi.fn() }));
vi.mock("@/server/engine/09/manifest", async importOriginal => ({ ...await importOriginal<object>(), cityManifest: vi.fn() }));
vi.mock("@/server/engine/09/signatures", async importOriginal => ({ ...await importOriginal<object>(), signatureReference: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("taste city comparison", () => {
  it("shows each city's actual first area and reason, preserving state and valid cities when one fails", async () => {
    vi.mocked(cityManifest).mockResolvedValue({ value: { cityId:"fictional:selected", version:"fictional:v1", fetchedAt:"2026-10-30T00:00:00Z" }, hit:false } as Awaited<ReturnType<typeof cityManifest>>);
    vi.mocked(analyzeAreas).mockImplementation(async input => {
      if(input.state.city === "Fictional Missing") throw apiError("not_found", "City not found.");
      const first = { ...fixture.neighborhoods.areas[0], area: { ...fixture.neighborhoods.areas[0].area, name:`First in ${input.state.city}` }, headline:`Verified reason in ${input.state.city}` };
      return { hit:false, value: { manifest:{cityId:input.state.city,cityName:input.state.city},areas:[first],evidence:fixture.neighborhoods.evidence } } as Awaited<ReturnType<typeof analyzeAreas>>;
    });
    const request = CitiesRequestV2.parse({state:fixture.state,stateRevision:1,cities:["Fictional A","Fictional B","Fictional Missing"]});
    const before = structuredClone(request);
    const result = await citiesV2(request);
    expect(request).toEqual(before);
    expect(signatureReference).not.toHaveBeenCalled();
    expect(result.method).toBe("personal_area_rank_v1");
    expect(result.recommendation).toBeNull();
    expect(result.results.map(c=>c.culturalOverlap)).toEqual([null,null,null]);
    expect(result.results[2].status).toBe("error");
    expect(result.results[0].areas[0].area.name).toBe("First in Fictional A");
    const claims = claimsForCard({kind:"comparison",result}, result.evidence.map(e=>e.id));
    expect(claims[0].text).toContain("Verified reason in Fictional A");
    expect(claims[1].text).toContain("First in Fictional B");
    expect(claims.map(c=>c.text).join()).not.toContain("overlap");
  });
});
