// Diagnostic alternatives, selected before inspecting this run. No city/name weights.
import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest, type ManifestArea } from "../../src/server/engine/09/manifest";
import { weightedSignals, scorePerson, type NativeCell, type WeightedSignal } from "../../src/server/engine/09/ranking";
import { mean, median, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";

loadEnvFile(".env.local");
const capture = installPrivateCapture(true);
const profiles = JSON.parse(readFileSync(join(capture.directory, "profiles.json"), "utf8")) as { name: string; loves: ResolvedLove[] }[];
const report: unknown[] = [];
function folded(cells: NativeCell[]) {
  const groups = new Map<string, NativeCell[]>();
  for (const cell of cells) { const key = cell.h.slice(0, 6), group = groups.get(key) ?? []; group.push(cell); groups.set(key, group); }
  const rows = [...groups].map(([h, items]) => ({ h, affinity: mean(items.map(c => c.affinity)), popularity: mean(items.map(c => c.popularity)) })).filter(c => c.affinity > 0);
  const prior = Math.max(.02, median(rows.map(c => c.popularity)));
  const ranks = percentileRanks(rows.map(c => (c.affinity + prior) / (c.popularity + prior)));
  return new Map(rows.map((c, i) => [c.h, { rank: ranks[i], popularity: c.popularity }]));
}
const methods = ["current", "native-mean", "fold6-mean", "fold6-prior", "fold6-prior-discovery"] as const;
function measure(area: ManifestArea, signals: WeightedSignal[], method: typeof methods[number]) {
  if (method === "current") return scorePerson(area, signals).score;
  const values = signals.map(signal => {
    const coarse = folded(signal.cells);
    const local = area.cells.flatMap(cell => {
      const observed = signal.ranks.get(cell.h), fold = coarse.get(cell.h.slice(0, 6));
      const value = method === "native-mean" ? observed : observed !== undefined ? fold?.rank : undefined;
      return value === undefined ? [] : [{ ...cell, value, popularity: fold?.popularity ?? 0 }];
    });
    const n = new Set(local.map(c => c.h.slice(0, 6))).size;
    const reliability = method.includes("prior") ? n / (n + 3) : 1;
    const total = local.reduce((s, c) => s + c.areaM2, 0);
    return { weight: signal.weight, value: total ? local.reduce((s, c) => s + c.areaM2 * (.5 + reliability * (c.value - .5)) * (method.includes("discovery") ? 1 - .7 * .35 * c.popularity : 1), 0) / total : .5 };
  });
  return values.reduce((s, v) => s + v.value * v.weight, 0) / values.reduce((s, v) => s + v.weight, 0);
}
for (const city of ["Berlin", "Lisbon"]) {
  const { value: manifest } = await withQlooBudget(96, () => cityManifest(city));
  const outputs: { variants: Record<string, { name: string; score: number }[]> }[] = [];
  for (const profile of profiles) {
    const signals = await withQlooBudget(16, () => weightedSignals(manifest, ExploreState.parse({ city, loves: profile.loves }).loves));
    const result = { city, profile: profile.name, variants: Object.fromEntries(methods.map(method => [method, manifest.areas.map(area => ({ name: area.identity.name, score: measure(area, signals, method), support: scorePerson(area, signals).support.quality })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))])) };
    outputs.push(result); report.push(result);
    console.log(JSON.stringify({ city, profile: profile.name, top3: Object.fromEntries(Object.entries(result.variants).map(([method, values]) => [method, values.slice(0, 3)])) }));
  }
  console.log(JSON.stringify({ city, winners: Object.fromEntries(methods.map(method => [method, outputs.reduce((counts, row) => { const name = row.variants[method][0].name; counts[name] = (counts[name] ?? 0) + 1; return counts; }, {} as Record<string, number>)])) }));
}
writeFileSync(join(capture.directory, "d003-method-probe.json"), JSON.stringify({ at: new Date().toISOString(), methods, report, capture: capture.counts() }, null, 2));
console.log(JSON.stringify({ capture: capture.counts() }));
capture.restore();
