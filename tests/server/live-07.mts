import { loadEnvFile } from "node:process";
import { performance } from "node:perf_hooks";
import { ExploreState, HomeResult, SpotResult, DecidesResult, ApiError, type AgentEvent } from "../../src/shared/contracts";
import { searchTaste } from "../../src/server/qloo/search";
import { pickEntity } from "../../src/lib/pick";
import { clearQlooCache } from "../../src/server/qloo/client";
import { clearEvidenceCache } from "../../src/server/engine/evidence";
import { clearGeocodeCache } from "../../src/server/geo/geocode";
import { POST as home } from "../../src/app/api/home/route";
import { POST as spot } from "../../src/app/api/spot/route";
import { POST as decides } from "../../src/app/api/decides/route";
import { runAgent } from "../../src/server/agent/runner";
import { placeBrandKey } from "../../src/server/engine/spot";

loadEnvFile(".env.local");
const spotOnly = process.argv.includes("--spot-only");
const loves = await Promise.all(["Radiohead", "Fleabag", "Wes Anderson", "Patagonia"].map(async (query) => {
  const candidates = await searchTaste(query);
  const chosen = pickEntity(query, candidates);
  if (!chosen) throw new Error(`Could not resolve ${query}`);
  return { query, chosen, candidates: candidates.slice(0, 6), weight: 1 };
}));
const state = ExploreState.parse({ city: "Lisbon", loves });
console.log("Resolved:", loves.map((love) => `${love.chosen.name} (${love.chosen.domain})`).join(", "));

async function check(name: string, handler: (request: Request) => Promise<Response>, body: unknown, summary: (value: unknown) => unknown) {
  clearQlooCache(); clearEvidenceCache(); clearGeocodeCache();
  let result: unknown;
  for (const temperature of ["cold", "warm"]) {
    const start = performance.now();
    const response = await handler(new Request(`http://localhost/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const value: unknown = await response.json();
    const seconds = ((performance.now() - start) / 1000).toFixed(2);
    console.log(`${name} ${temperature}: HTTP ${response.status}, ${seconds}s`);
    if (!response.ok) { console.log(JSON.stringify(ApiError.parse(value))); process.exitCode = 1; break; }
    result = value;
    if (temperature === "cold") console.log(JSON.stringify(summary(value), null, 2));
  }
  return result;
}

if (!spotOnly) await check("home", home, { state, source: { city: "Berlin", neighborhood: "Kreuzberg" }, blend: 0 }, (value) => {
  const result = HomeResult.parse(value);
  return { source: result.source.neighborhood, places: result.source.places.map((p) => p.name), tags: result.source.tags,
    cells: result.field.cells.length, top: result.matches.map((match) => ({ name: result.neighborhoods.find((n) => n.id === match.neighborhoodId)?.name,
      similarity: match.similarity, sharedTags: match.sharedTags, twin: match.twins[0] ? `${match.twins[0].source.name} -> ${match.twins[0].target.name}` : null })) };
});
function spotSummary(value: unknown) {
  const result = SpotResult.parse(value);
  const brands = new Set(result.walk.map(({ place }) => placeBrandKey(place)));
  if (brands.size !== result.walk.length) throw new Error("Duplicate brand in spot walk list");
  return { label: result.label, point: result.point, score: Number(result.score.toFixed(3)), percentile: result.percentile,
    neighborhood: result.neighborhood, counts: result.counts, uniqueBrands: brands.size,
    walk: result.walk.slice(0, spotOnly ? 10 : 3).map((p) => `${p.place.name} (${p.minutes} min)`), verdict: result.verdict };
}
const spotValue = await check("spot", spot, { state, query: "Rua da Rosa 120" }, spotSummary);
if (spotOnly && spotValue) await check("spot-pin", spot, { state, point: SpotResult.parse(spotValue).point }, spotSummary);
if (!spotOnly) await check("decides", decides, state, (value) => DecidesResult.parse(value));

for (const message of spotOnly ? [] : ["I used to live in Kreuzberg, Berlin", "How is Rua da Rosa 120 for me?", "Why is the first one first?"]) {
  const events: string[] = [];
  const start = performance.now();
  try {
    await runAgent({ state, message, history: [] }, (event: AgentEvent) => {
      events.push(event.type === "trace" ? `trace:${event.tool}` : event.type === "card" ? `card:${event.card.kind}` : event.type === "delta" ? `delta:${event.text}` : event.type);
    });
    console.log(`agent ${JSON.stringify(message)} ${((performance.now() - start) / 1000).toFixed(2)}s\n${events.join(" -> ")}`);
  } catch (error) {
    const parsed = ApiError.safeParse((error as { body?: unknown }).body ?? error);
    console.log(`agent ${JSON.stringify(message)} failed: ${parsed.success ? parsed.data.error.message : "Unknown failure"}`);
    console.log(events.join(" -> ")); process.exitCode = 1;
  }
}
