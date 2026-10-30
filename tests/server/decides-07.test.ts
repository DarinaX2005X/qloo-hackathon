import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, type Neighborhood } from "@/shared/contracts";
import { rankNeighborhoods } from "@/server/engine/neighborhoods";
import { decidesResult, whatDecides } from "@/server/engine/decides";
import { love, state } from "./helpers";

vi.mock("@/server/engine/neighborhoods", () => ({ rankNeighborhoods: vi.fn() }));
const rank = vi.mocked(rankNeighborhoods);
const area = (id: string, rank = 1): Neighborhood => ({ id, name: id, rank, center: [0, 0], score: 0.8, you: 0.8,
  drivers: [], matchedTags: [], vibe: "local", samplePlaces: [], cellIds: [] });
beforeEach(() => { rank.mockReset(); rank.mockResolvedValue([area("First"), area("Second", 2), area("Third", 3)]); });

describe("07 what decides", () => {
  it("is robust when the winner remains first even if runners-up move", () => {
    const result = decidesResult([area("First"), area("Second", 2)], [
      { love: love("A"), ranking: [area("First"), area("Third", 2), area("Second", 3)] },
      { love: love("B"), ranking: [area("First"), area("Second", 2)] },
    ]);
    expect(result).toMatchObject({ robust: true, pivotal: null });
    expect(result.summary).toBe("First stays first without any single love.");
    expect(result.neighborhoods[1].without.map((item) => item.rank)).toEqual([3, 2]);
  });
  it("chooses the largest drop, with null meaning outside the top eight", () => {
    const result = decidesResult([area("First")], [
      { love: love("small"), ranking: [area("Other"), area("First", 2)] },
      { love: love("large"), ranking: [area("Other")] },
    ]);
    expect(result).toMatchObject({ robust: false, pivotal: "large" });
    expect(result.neighborhoods[0].without[1].rank).toBeNull();
    expect(result.summary).toContain("drops out of the top eight");
  });
  it("on a tie picks the first love in profile order and says no single love decides", () => {
    const result = decidesResult([area("Sé")], [
      { love: love("Radiohead"), ranking: [area("Other"), area("Next", 2), area("Sé", 3)] },
      { love: love("Mitski"), ranking: [area("Other"), area("Sé", 2)] },
      { love: love("Fleabag"), ranking: [area("Other"), area("Next", 2), area("Sé", 3)] },
    ]);
    expect(result).toMatchObject({ robust: false, pivotal: "Radiohead" });
    expect(result.summary).toBe("Sé falls to #3 without Radiohead or without Fleabag; no single love holds it up alone.");
    const reversed = decidesResult([area("Sé")], [
      { love: love("Fleabag"), ranking: [area("Other"), area("Next", 2), area("Sé", 3)] },
      { love: love("Radiohead"), ranking: [area("Other"), area("Next", 2), area("Sé", 3)] },
    ]);
    expect(reversed.pivotal).toBe("Fleabag");
    expect(reversed.summary).toBe("Sé falls to #3 without Fleabag or without Radiohead; no single love holds it up alone.");
  });
  it("on a tie outside the top eight lists every love that knocks the winner out", () => {
    const result = decidesResult([area("First")], [
      { love: love("A"), ranking: [area("Other")] },
      { love: love("B"), ranking: [area("Other")] },
      { love: love("C"), ranking: [area("Other")] },
    ]);
    expect(result).toMatchObject({ robust: false, pivotal: "A" });
    expect(result.summary).toBe("First drops out of the top eight without A, without B or without C; no single love holds it up alone.");
  });
  it("keeps the single-love summary when one love has the largest drop", () => {
    const result = decidesResult([area("Sé")], [
      { love: love("Radiohead"), ranking: [area("Other"), area("Sé", 2)] },
      { love: love("Fleabag"), ranking: [area("Other"), area("Next", 2), area("Sé", 3)] },
    ]);
    expect(result.pivotal).toBe("Fleabag");
    expect(result.summary).toBe("Sé loses first place without Fleabag (to #3).");
  });
  it("resolves a tie by profile order through whatDecides too", async () => {
    // variants finish in reverse order; the result must still follow the profile
    const delay: Record<string, number> = { C: 15, A: 8, B: 1 };
    rank.mockImplementation(async (input) => {
      if (input.loves.length === 3) return [area("First")];
      const removed = ["C", "A", "B"].find((id) => !input.loves.some((item) => item.query === id))!;
      await new Promise((resolve) => setTimeout(resolve, delay[removed]));
      return [area("Other"), area("First", 2)];
    });
    const result = await whatDecides(state({ loves: [love("C"), love("A"), love("B")] }));
    expect(result.pivotal).toBe("C");
    expect(result.summary).toBe("First falls to #2 without C, without A or without B; no single love holds it up alone.");
  });
  it("does not run variants for one active love, and ignores unresolved or zero-weight loves", async () => {
    const result = await whatDecides(state({ loves: [love("only"), love("zero", "artist", 0), { query: "unknown", chosen: null, candidates: [], weight: 1 }] }));
    expect(rank).toHaveBeenCalledTimes(1); expect(result.neighborhoods.every((item) => !item.without.length)).toBe(true);
    expect(result.summary).toContain("nothing to compare yet");
    expect((await whatDecides(state({ loves: [] }))).neighborhoods).toEqual([]);
  });
  it("reranks each complete variant, preserves settings/companion and never runs more than two variants at once", async () => {
    let active = 0, maximum = 0;
    const original = state({ loves: [love("A"), love("B"), love("C")], companion: { loves: [love("partner")] }, discovery: 0.8 });
    rank.mockImplementation(async (input) => {
      if (input.loves.length === 3) return [area("First")];
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      expect(input.companion).toEqual(original.companion); expect(input.discovery).toBe(0.8);
      return input.loves.some((love) => love.query === "A") ? [area("First")] : [area("Other"), area("First", 2)];
    });
    const result = await whatDecides(original);
    expect(maximum).toBe(2); expect(rank).toHaveBeenCalledTimes(4);
    expect(result.pivotal).toBe("A"); expect(original.loves).toHaveLength(3);
    expect(result.neighborhoods[0].without.map((item) => item.query)).toEqual(["A", "B", "C"]);
  });
  it("treats a variant with no geographic signal as dropping out, but propagates service failures", async () => {
    rank.mockResolvedValueOnce([area("First")]).mockRejectedValueOnce(apiError("not_found", "No signal"));
    expect((await whatDecides(state({ loves: [love("A"), love("B")] }))).pivotal).toBe("A");
    rank.mockReset().mockResolvedValueOnce([area("First")]).mockRejectedValue(apiError("quota", "Busy", true));
    await expect(whatDecides(state({ loves: [love("A"), love("B")] }))).rejects.toMatchObject({ error: { code: "quota" } });
  });
});
