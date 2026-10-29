import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQlooCache, qlooGet } from "@/server/qloo/client";
import { loadPersonMaps } from "@/server/engine/field";
import { love } from "./helpers";

beforeEach(() => { clearQlooCache(); vi.stubEnv("QLOO_API_KEY", "synthetic-test-key"); vi.stubEnv("QLOO_API_URL", "https://qloo.example.test"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Qloo client", () => {
  it("sends GET with bounded take, caches projected data and coalesces concurrent queries", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [{ entity_id: "x", name: "X", akas: ["private"], external: {}, properties: { short_description: "Short", overall_description: "Long" } }] }));
    vi.stubGlobal("fetch", fetcher);
    const [one, two] = await Promise.all([qlooGet("/search", { query: "x", take: 6 }), qlooGet("/search", { take: 6, query: "x" })]);
    expect(one).toEqual(two);
    expect(JSON.stringify(one)).not.toContain("private");
    expect(JSON.stringify(one)).not.toContain("Long");
    await qlooGet("/search", { query: "x", take: 6 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", next: { revalidate: 604800 }, headers: { "X-Api-Key": "synthetic-test-key" } });
    await expect(qlooGet("/v2/insights", { take: 50 })).rejects.toMatchObject({ error: { code: "bad_input" } });
    await expect(qlooGet("/search", { take: 51 })).rejects.toMatchObject({ error: { code: "bad_input" } });
  });

  it("retries 503 once after 600ms and maps the error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => new Response("upstream details", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const assertion = expect(qlooGet("/search", { query: "x" })).rejects.toMatchObject({ error: { code: "qloo_unavailable", retryable: true } });
    await vi.advanceTimersByTimeAsync(599);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries 429 twice with 700/1500ms backoff plus jitter, then releases all slots", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetcher = vi.fn().mockImplementation(async () => new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const assertion = expect(qlooGet("/search", { query: "limited" })).rejects.toMatchObject({ error: { code: "quota", retryable: true } });
    await vi.advanceTimersByTimeAsync(799);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1599);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockImplementation(async () => Response.json({ results: [] }));
    await Promise.all(Array.from({ length: 4 }, (_, i) => qlooGet("/search", { query: `after-${i}` })));
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it("limits all URLs to four active requests, coalesces queued duplicates, and reads bodies before release", async () => {
    const finish: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      return { ok: true, status: 200, json: () => new Promise((resolve) => {
        finish.push(() => { active--; resolve({ results: [] }); });
      }) };
    });
    vi.stubGlobal("fetch", fetcher);
    const jobs = Array.from({ length: 12 }, (_, i) => qlooGet("/search", { query: `queued-${i}` }));
    jobs.push(qlooGet("/search", { query: "queued-10" }));
    for (let batch = 1; batch <= 3; batch++) {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(batch * 4));
      expect(active).toBe(4);
      finish.splice(0).forEach((release) => release());
    }
    await Promise.all(jobs);
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(12);
  });

  it("reuses each city/entity heatmap when adding a fifth love", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ results: { heatmap: [] } }));
    vi.stubGlobal("fetch", fetcher);
    const four = ["a", "b", "c", "d"].map((id) => love(id));
    await loadPersonMaps("Test City", four);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await loadPersonMaps("Test City", [...four, love("e")]);
    expect(fetcher).toHaveBeenCalledTimes(7);
    const ids = fetcher.mock.calls.map(([url]) => (url as URL).searchParams.get("signal.interests.entities"));
    for (const id of ["a", "b", "c", "d"]) expect(ids.filter((value) => value === id)).toHaveLength(1);
    await loadPersonMaps("Other City", [four[0]]);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("maps network failures and invalid JSON without exposing upstream detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret transport detail")));
    await expect(qlooGet("/search", {})).rejects.toEqual({ error: { code: "qloo_unavailable", message: "Qloo is unavailable or the request timed out.", retryable: true } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid")));
    await expect(qlooGet("/search", {})).rejects.toMatchObject({ error: { code: "qloo_unavailable" } });
  });

  it("aborts a stalled request after nine seconds", async () => {
    const original = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => { expect(ms).toBe(9000); return original(5); });
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))));
    await expect(qlooGet("/search", {})).rejects.toMatchObject({ error: { code: "qloo_unavailable" } });
    timeout.mockRestore();
  });

  it("expires cache entries after seven days and evicts the least recently used beyond 500", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ results: [] }));
    vi.stubGlobal("fetch", fetcher);
    for (let i = 0; i < 500; i++) await qlooGet("/search", { query: String(i) });
    await qlooGet("/search", { query: "0" });
    await qlooGet("/search", { query: "500" });
    await qlooGet("/search", { query: "0" });
    expect(fetcher).toHaveBeenCalledTimes(501);
    await qlooGet("/search", { query: "1" });
    expect(fetcher).toHaveBeenCalledTimes(502);
    vi.advanceTimersByTime(604800001);
    await qlooGet("/search", { query: "0" });
    expect(fetcher).toHaveBeenCalledTimes(503);
  });
});
