import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQlooCache, qlooGet } from "@/server/qloo/client";
import { loadPersonMaps } from "@/server/engine/field";
import { love } from "./helpers";
import { withQlooBudget, remainingQlooCalls } from "@/server/qloo/budget";

beforeEach(() => { clearQlooCache(); vi.stubEnv("QLOO_API_KEY", "synthetic-test-key"); vi.stubEnv("QLOO_API_URL", "https://qloo.example.test"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Qloo client", () => {
  it('enforces an atomic caller budget across concurrent calls, without charging cache hits', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ results: [] }));
    vi.stubGlobal('fetch', fetcher);
    let used = -1;
    const results = await withQlooBudget(3, () => Promise.allSettled(Array.from({ length: 12 }, (_, i) => qlooGet('/search', { query: `budget-${i}` }))), count => { used = count; });
    expect(fetcher).toHaveBeenCalledTimes(3); expect(used).toBe(3);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3);
    await withQlooBudget(0, () => qlooGet('/search', { query: 'budget-0' }));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([true, false])('isolates an exhausted caller from a funded caller for the same query (exhausted first=%s)', async exhaustedFirst => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ results: [] }));
    vi.stubGlobal('fetch', fetcher);
    const charged: number[] = [];
    const request = (limit: number) => withQlooBudget(limit,
      () => qlooGet('/search', { query: 'shared-budget' }), used => { charged[limit] = used; });
    const results = await Promise.allSettled(exhaustedFirst ? [request(0), request(1)] : [request(1), request(0)]);
    expect(results[exhaustedFirst ? 0 : 1]).toMatchObject({ status: 'rejected', reason: { error: { code: 'quota' } } });
    expect(results[exhaustedFirst ? 1 : 0]).toEqual({ status: 'fulfilled', value: { results: [] } });
    expect(charged).toEqual([0, 1]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await withQlooBudget(0, () => qlooGet('/search', { query: 'shared-budget' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('charges each coalesced caller once while shared retries run outside their budgets', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(async () => new Response('', { status: 503 }))
      .mockImplementation(async () => {
        expect(remainingQlooCalls()).toBe(Infinity);
        return Response.json({ results: [] });
      });
    vi.stubGlobal('fetch', fetcher);
    const charged: number[] = [];
    const jobs = [1, 2].map((limit, i) => withQlooBudget(limit, async () => {
      const result = await qlooGet('/search', { query: 'retry-budget' });
      expect(remainingQlooCalls()).toBe(limit - 1);
      return result;
    }, used => { charged[i] = used; }));
    const outcomes = Promise.allSettled(jobs);
    await vi.advanceTimersByTimeAsync(600);
    expect(await outcomes).toEqual(Array.from({ length: 2 }, () => ({ status: 'fulfilled', value: { results: [] } })));
    expect(charged).toEqual([1, 1]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('lets a funded waiter finish retries after the creating request has closed its budget', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(async () => new Response('', { status: 503 }))
      .mockImplementation(async () => Response.json({ results: [] }));
    vi.stubGlobal('fetch', fetcher);
    let shared!: Promise<unknown>;
    let creatorUsed = -1, waiterUsed = -1;
    await withQlooBudget(1, async () => { shared = qlooGet('/search', { query: 'closed-creator' }); }, used => { creatorUsed = used; });
    const waiter = withQlooBudget(1, () => qlooGet('/search', { query: 'closed-creator' }), used => { waiterUsed = used; });
    const outcomes = Promise.allSettled([shared, waiter]);
    await vi.advanceTimersByTimeAsync(600);
    expect(await outcomes).toEqual(Array.from({ length: 2 }, () => ({ status: 'fulfilled', value: { results: [] } })));
    expect([creatorUsed, waiterUsed]).toEqual([1, 1]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps concurrent request budgets isolated and charges nested budgets to their parent', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ results: [] }));
    vi.stubGlobal('fetch', fetcher);
    await Promise.all(['one', 'two'].map(query => withQlooBudget(1, () => qlooGet('/search', { query }))));
    await withQlooBudget(2, async () => {
      await withQlooBudget(2, () => qlooGet('/search', { query: 'nested-1' }));
      expect(remainingQlooCalls()).toBe(1);
      await withQlooBudget(2, () => qlooGet('/search', { query: 'nested-2' }));
      await expect(withQlooBudget(2, () => qlooGet('/search', { query: 'nested-3' }))).rejects.toMatchObject({ error: { code: 'quota' } });
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('cannot launch uncharged background work after the budget has been refunded', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let background!: Promise<unknown>;
    await withQlooBudget(2, async () => { background = gate.then(() => qlooGet('/search', { query: 'late' })); });
    const assertion = expect(background).rejects.toMatchObject({ error: { code: 'quota' } });
    release(); await assertion;
    expect(fetcher).not.toHaveBeenCalled();
  });
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
    // A failed shared task (including an upstream quota error) must not remain pending.
    await withQlooBudget(1, () => qlooGet('/search', { query: 'limited' }));
    await Promise.all(Array.from({ length: 4 }, (_, i) => qlooGet("/search", { query: `after-${i}` })));
    expect(fetcher).toHaveBeenCalledTimes(8);
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
    // the city centre is one cached request per city; heatmaps then ask around that point
    const fetcher = vi.fn().mockImplementation(async (url: URL) => Response.json({ results: url.searchParams.get("filter.type") === "urn:heatmap"
      ? { heatmap: [] } : { entities: [{ entity_id: "p", name: "p", location: { lon: url.searchParams.get("filter.location.query") === "Other City" ? 2 : 1, lat: 1 } }] } }));
    vi.stubGlobal("fetch", fetcher);
    const four = ["a", "b", "c", "d"].map((id) => love(id));
    await loadPersonMaps("Test City", four);
    expect(fetcher).toHaveBeenCalledTimes(6);
    await loadPersonMaps("Test City", [...four, love("e")]);
    expect(fetcher).toHaveBeenCalledTimes(8);
    const ids = fetcher.mock.calls.map(([url]) => (url as URL).searchParams.get("signal.interests.entities"));
    for (const id of ["a", "b", "c", "d"]) expect(ids.filter((value) => value === id)).toHaveLength(1);
    await loadPersonMaps("Other City", [four[0]]);
    expect(fetcher).toHaveBeenCalledTimes(10);
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
