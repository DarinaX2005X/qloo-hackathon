import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { qlooRead, resultRows } from "../../src/server/qloo/client";
import { rowPlace, venueEligibility } from "../../src/server/engine/09/eligibility";
import { ROLE_TAGS, venueSignals } from "../../src/server/engine/09/venues-api";
import type { Constraint } from "../../src/shared/contracts-09";

loadEnvFile(".env.local");
const directory = join(tmpdir(), "homing-stage09-private");
const dialogue = JSON.parse(readFileSync(join(directory, "followup-diagnostic.json"), "utf8")).find((r: { summary: { scenario: number; turn: number } }) => r.summary.scenario === 4 && r.summary.turn === 0);
const address = dialogue.events.find((e: { type: string; card?: { kind: string } }) => e.type === "result" && e.card?.kind === "address").card.result;
const state = ExploreState.parse(dialogue.input.state), constraints = dialogue.summary.constraints as Constraint[];
const query = { "filter.type": "urn:entity:place", "filter.location": `POINT(${address.point[0]} ${address.point[1]})`, "filter.location.radius": 800,
  "filter.tags": ROLE_TAGS.daily_life.join(","), "operator.filter.tags": "union", "signal.interests.entities": venueSignals(state, "daily_life").map(l => l.chosen.id).join(","), "feature.explainability": "true", take: 50 };
const results = [];
for (const maximum of [undefined, 2]) {
  const read = await qlooRead("/v2/insights", { ...query, ...(maximum ? { "filter.price_level.max": maximum } : {}) });
  const places = resultRows(read.value, "entities").flatMap(row => rowPlace(row) ?? []);
  const count = (key: (p: typeof places[number]) => string) => Object.fromEntries([...new Set(places.map(key))].map(k => [k, places.filter(p => key(p) === k).length]));
  const eligible = places.filter(p => venueEligibility(p, "daily_life", constraints, { center: address.point, radiusM: 800 }).allowed);
  results.push({ maximum, prices: count(p => String(p.priceLevel)), rejects: count(p => venueEligibility(p, "daily_life", constraints, { center: address.point, radiusM: 800 }).reasons.join(",")), eligible: eligible.map(p => ({ name: p.name, price: p.priceLevel })) });
}
writeFileSync(join(directory, "budget-retrieval-probe.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
