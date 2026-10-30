import { ExploreState } from "../src/shared/contracts";
import { AnalysisRequestV2, HomeRequestV2, CitiesRequestV2 } from "../src/shared/contracts-09";

// Warms the actual serving process through HTTP. No credentials or provider responses are written.
// Usage: npx tsx scripts/warmup-09.mts [https://deployment.example] [--full]
const base = (process.argv[2]?.startsWith("http") ? process.argv[2] : process.env.BASE_URL) ?? "http://localhost:3001";
async function call(path: string, body?: unknown) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error?.message ?? "request failed"}`);
  console.log(JSON.stringify({ path, elapsedMs: Math.round(performance.now() - started), status: response.status, method: data.meta?.methodVersion ?? data.hero?.meta?.methodVersion, cache: data.meta?.cache ?? data.hero?.meta?.cache }));
  return data;
}
const landing = await call("/api/landing?part=hero");
if (!landing.hero?.loves?.length) throw new Error("The hero example did not load; warmup is incomplete.");
await call("/api/landing?part=rest");
const state = ExploreState.parse({ city: "Lisbon", loves: landing.hero.loves });
await call("/api/neighborhoods", AnalysisRequestV2.parse({ state, stateRevision: 0 }));
if (process.argv.includes("--full")) {
  await call("/api/home", HomeRequestV2.parse({ state, stateRevision: 0, source: { city: "Lisbon", neighborhood: "Alfama" }, lambda: 0 }));
  await call("/api/cities", CitiesRequestV2.parse({ state, stateRevision: 0, cities: ["Lisbon", "Reykjavík"], source: { city: "Berlin", neighborhood: "Kreuzberg" } }));
}
await call("/api/landing?part=hero");
