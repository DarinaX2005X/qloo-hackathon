import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQlooCache, qlooGet } from "@/server/qloo/client";

beforeEach(() => { clearQlooCache(); vi.stubEnv("QLOO_API_KEY", "synthetic-test-key"); vi.stubEnv("QLOO_API_URL", "https://qloo.example.test"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

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

  it.each([429, 503])("retries %s once after 600ms and maps the error", async (status) => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => new Response("upstream details", { status }));
    vi.stubGlobal("fetch", fetcher);
    const assertion = expect(qlooGet("/search", { query: "x" })).rejects.toMatchObject({ error: { code: status === 429 ? "quota" : "qloo_unavailable", retryable: true } });
    await vi.advanceTimersByTimeAsync(599);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
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
